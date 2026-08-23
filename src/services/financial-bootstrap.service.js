"use strict";

const crypto = require("crypto");
const { AppError } = require("../utils/errors");
const {
  BOOTSTRAP_VERSION,
  ACCOUNT_ROLE_CATALOG,
  getSemanticAccountRoleDefinition,
  BRANCH_MAPPING_CATALOG,
  POSTING_ACCOUNT_CATALOG,
} = require("./financial-account-catalog.service");
const {
  evaluateMappingAccountCompatibility,
  inspectMappingAccountCompatibility,
} = require("./financial-mapping-compatibility.service");

const id = (prefix) => `${prefix}-${crypto.randomUUID()}`;
const readinessError = () =>
  new AppError("Required financial configuration is incomplete.", 422, "FINANCIAL_READINESS_REQUIRED");

function resolveRequiredRoleDefinitions(requiredRoleCodes = null) {
  const requested = requiredRoleCodes == null
    ? Object.keys(ACCOUNT_ROLE_CATALOG)
    : [...new Set([...Object.keys(ACCOUNT_ROLE_CATALOG), ...requiredRoleCodes.map((code) => String(code).trim().toUpperCase())])];
  return requested.map((roleCode) => {
    const definition = getSemanticAccountRoleDefinition(roleCode);
    if (!definition) throw readinessError();
    return [roleCode, definition];
  });
}

// A branch mapping is historical when it is inactive.  Historical rows are
// deliberately retained for audit, but must never compete with the one active
// mapping that is authoritative for posting and reconciliation.
function currentMappingAuthority(rows = []) {
  const activeRows = rows.filter((row) => row.isActive === true);
  if (activeRows.length > 1) throw readinessError();
  // A historical-only mapping is not a usable current authority.  Fail closed
  // instead of silently reactivating history or creating a second authority.
  if (activeRows.length === 0 && rows.length > 0) throw readinessError();
  return activeRows[0] || null;
}

async function accountForRole(models, companyId, branchId, roleCode, definition, actorId, transaction, report) {
  const rows = await models.SystemAccountRole.findAll({
    where: { companyId, branchId, roleCode },
    transaction,
    lock: transaction?.LOCK.UPDATE,
  });
  if (rows.length > 1) throw readinessError();
  if (rows.length === 1) {
    const account = await models.Account.findOne({
      where: { id: rows[0].accountId, companyId, isActive: true },
      transaction,
      lock: transaction?.LOCK.UPDATE,
    });
    if (!account || account.type !== definition.type || account.nature !== definition.nature) throw readinessError();
    if (account.branchId !== null) await account.update({ branchId: null }, { transaction });
    report.preservedRoles += 1;
    return account;
  }

  let account = await models.Account.findOne({
    where: { companyId, code: definition.code },
    transaction,
    lock: transaction?.LOCK.UPDATE,
  });
  if (!account) {
    account = await models.Account.create({
      id: id("ACC"),
      companyId,
      branchId: null,
      code: definition.code,
      name: definition.name,
      nameAr: definition.nameAr,
      type: definition.type,
      nature: definition.nature,
      parentId: null,
      balance: 0,
      isActive: true,
      isPosting: true,
      statementClassification: definition.statementClassification,
      bootstrapVersion: BOOTSTRAP_VERSION,
      level: 1,
    }, { transaction });
    report.createdAccounts += 1;
  } else {
    await account.update({
      branchId: null,
      isActive: true,
      isPosting: true,
      statementClassification: definition.statementClassification,
      bootstrapVersion: BOOTSTRAP_VERSION,
    }, { transaction });
  }
  await models.SystemAccountRole.create({
    id: id("SAR"),
    companyId,
    branchId,
    roleCode,
    accountId: account.id,
    createdBy: actorId,
    updatedBy: actorId,
  }, { transaction });
  report.createdRoles += 1;
  return account;
}

async function ensurePostingCatalog(models, companyId, transaction, report) {
  const byCode = new Map();
  const ordered = Object.entries(POSTING_ACCOUNT_CATALOG).sort((a, b) => a[1].level - b[1].level);
  for (const [code, definition] of ordered) {
    let account = await models.Account.findOne({ where: { companyId, code }, transaction, lock: transaction?.LOCK.UPDATE });
    if (!account) {
      account = await models.Account.create({
        id: id("ACC"),
        companyId,
        branchId: null,
        code,
        name: definition.name,
        nameAr: definition.nameAr,
        type: definition.type,
        nature: definition.nature,
        parentId: definition.parent ? byCode.get(definition.parent)?.id || null : null,
        balance: 0,
        isActive: true,
        isPosting: definition.isPosting,
        statementClassification: definition.statementClassification,
        bootstrapVersion: BOOTSTRAP_VERSION,
        level: definition.level,
      }, { transaction });
      report.createdAccounts += 1;
    } else {
      await account.update({
        branchId: null,
        parentId: definition.parent ? byCode.get(definition.parent)?.id || null : null,
        isActive: true,
        isPosting: definition.isPosting,
        statementClassification: definition.statementClassification,
        bootstrapVersion: BOOTSTRAP_VERSION,
        level: definition.level,
      }, { transaction });
    }
    byCode.set(code, account);
  }
}

async function reconcile({ models, companyId, branchId, actorId = "financial-bootstrap", transaction: suppliedTransaction, dryRun = false, requiredRoleCodes = null }) {
  const run = async (transaction) => {
    if (!companyId || !branchId) throw readinessError();
    const [company, branch] = await Promise.all([
      models.Company.findOne({ where: { id: companyId }, transaction }),
      models.Branch.findOne({ where: { id: branchId, companyId, isActive: true }, transaction }),
    ]);
    if (!company || !branch) throw readinessError();
    await models.sequelize.query("SELECT pg_advisory_xact_lock(hashtext(:scope))", {
      replacements: { scope: `financial-bootstrap:${companyId}:${branchId}` },
      transaction,
    });
    const report = {
      version: BOOTSTRAP_VERSION,
      dryRun,
      createdAccounts: 0,
      createdRoles: 0,
      createdMappings: 0,
      preservedRoles: 0,
    };
    if (dryRun) return { ...report, status: (await evaluateReadiness({ models, companyId, branchId, transaction, requiredRoleCodes })).status };

    await ensurePostingCatalog(models, companyId, transaction, report);
    const accounts = {};
    for (const [roleCode, definition] of resolveRequiredRoleDefinitions(requiredRoleCodes)) {
      accounts[roleCode] = await accountForRole(models, companyId, branchId, roleCode, definition, actorId, transaction, report);
    }
    for (const [mappingType, definition] of Object.entries(BRANCH_MAPPING_CATALOG)) {
      const existingRows = await models.BranchFinancialMapping.findAll({
        where: { companyId, branchId, mappingType, channel: null },
        transaction,
        lock: transaction?.LOCK.UPDATE,
      });
      const existing = currentMappingAuthority(existingRows);
      const account = accounts[definition.accountRoleCode];
      if (!existing) {
        await models.BranchFinancialMapping.create({
          id: id("BFM"),
          companyId,
          branchId,
          mappingType,
          channel: null,
          accountId: account.id,
          isActive: true,
          createdBy: actorId,
          updatedBy: actorId,
        }, { transaction });
        report.createdMappings += 1;
      } else {
        const inspected = await inspectMappingAccountCompatibility({
          models,
          companyId,
          branchId,
          mappingType,
          accountId: existing.accountId,
          transaction,
          lock: true,
        });
        if (!inspected.result.compatible) {
          await existing.update({ accountId: account.id, isActive: true, updatedBy: actorId }, { transaction });
        }
      }
    }
    const readiness = await evaluateReadiness({ models, companyId, branchId, transaction, requiredRoleCodes });
    if (readiness.status !== "READY") throw readinessError();
    return { ...report, status: readiness.status };
  };
  return suppliedTransaction ? run(suppliedTransaction) : models.sequelize.transaction(run);
}

async function evaluateReadiness({ models, companyId, branchId, transaction = null, requiredRoleCodes = null }) {
  if (!companyId || !branchId) return { status: "BLOCKED", blockers: [{ code: "FINANCIAL_CONTEXT_REQUIRED" }] };
  const roles = await models.SystemAccountRole.findAll({ where: { companyId, branchId }, transaction });
  const mappings = await models.BranchFinancialMapping.findAll({ where: { companyId, branchId, isActive: true }, transaction });
  const missingRoles = [];
  const invalidRoles = [];
  for (const [roleCode, definition] of resolveRequiredRoleDefinitions(requiredRoleCodes)) {
    const matches = roles.filter((row) => row.roleCode === roleCode);
    if (matches.length !== 1) {
      missingRoles.push(roleCode);
      continue;
    }
    const account = await models.Account.findOne({ where: { id: matches[0].accountId, companyId, isActive: true }, transaction });
    if (!account || account.type !== definition.type || account.nature !== definition.nature ||
        account.statementClassification !== definition.statementClassification ||
        account.isPosting === false || (account.branchId && String(account.branchId) !== String(branchId))) {
      invalidRoles.push(roleCode);
      continue;
    }
  }
  const missingMappings = [];
  const invalidMappings = [];
  for (const mappingType of Object.keys(BRANCH_MAPPING_CATALOG)) {
    const matches = mappings.filter((row) => row.channel === null && row.mappingType === mappingType);
    if (matches.length !== 1) {
      missingMappings.push(mappingType);
      continue;
    }
    const account = await models.Account.findOne({ where: { id: matches[0].accountId }, transaction });
    const roleCodes = roles
      .filter((row) => String(row.accountId) === String(matches[0].accountId))
      .map((row) => row.roleCode);
    const compatibility = evaluateMappingAccountCompatibility({
      companyId,
      branchId,
      mappingType,
      account,
      roleCodes,
    });
    if (!compatibility.compatible) invalidMappings.push(mappingType);
  }
  return {
    status: missingRoles.length || invalidRoles.length || missingMappings.length || invalidMappings.length ? "BLOCKED" : "READY",
    version: BOOTSTRAP_VERSION,
    missingRoles,
    invalidRoles,
    missingMappings,
    invalidMappings,
  };
}

module.exports = { reconcile, evaluateReadiness, readinessError, currentMappingAuthority, resolveRequiredRoleDefinitions };
