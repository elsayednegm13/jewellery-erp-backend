"use strict";

const crypto = require("crypto");
const { AppError } = require("../utils/errors");
const {
  BOOTSTRAP_VERSION,
  ACCOUNT_ROLE_CATALOG,
  BRANCH_MAPPING_CATALOG,
  POSTING_ACCOUNT_CATALOG,
} = require("./financial-account-catalog.service");

const id = (prefix) => `${prefix}-${crypto.randomUUID()}`;
const readinessError = () =>
  new AppError("Required financial configuration is incomplete.", 422, "FINANCIAL_READINESS_REQUIRED");

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

async function reconcile({ models, companyId, branchId, actorId = "financial-bootstrap", transaction: suppliedTransaction, dryRun = false }) {
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
    if (dryRun) return { ...report, status: (await evaluateReadiness({ models, companyId, branchId, transaction })).status };

    await ensurePostingCatalog(models, companyId, transaction, report);
    const accounts = {};
    for (const [roleCode, definition] of Object.entries(ACCOUNT_ROLE_CATALOG)) {
      accounts[roleCode] = await accountForRole(models, companyId, branchId, roleCode, definition, actorId, transaction, report);
    }
    for (const [mappingType, definition] of Object.entries(BRANCH_MAPPING_CATALOG)) {
      const existing = await models.BranchFinancialMapping.findAll({
        where: { companyId, branchId, mappingType, channel: null },
        transaction,
        lock: transaction?.LOCK.UPDATE,
      });
      if (existing.length > 1) throw readinessError();
      const account = accounts[definition.accountRoleCode];
      if (!existing.length) {
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
      } else if (existing[0].accountId !== account.id || !existing[0].isActive) {
        await existing[0].update({ accountId: account.id, isActive: true, updatedBy: actorId }, { transaction });
      }
    }
    const readiness = await evaluateReadiness({ models, companyId, branchId, transaction });
    if (readiness.status !== "READY") throw readinessError();
    return { ...report, status: readiness.status };
  };
  return suppliedTransaction ? run(suppliedTransaction) : models.sequelize.transaction(run);
}

async function evaluateReadiness({ models, companyId, branchId, transaction = null }) {
  if (!companyId || !branchId) return { status: "BLOCKED", blockers: [{ code: "FINANCIAL_CONTEXT_REQUIRED" }] };
  const roles = await models.SystemAccountRole.findAll({ where: { companyId, branchId }, transaction });
  const mappings = await models.BranchFinancialMapping.findAll({ where: { companyId, branchId, isActive: true }, transaction });
  const missingRoles = [];
  const invalidRoles = [];
  const resolvedRoleAccounts = new Map();
  for (const [roleCode, definition] of Object.entries(ACCOUNT_ROLE_CATALOG)) {
    const matches = roles.filter((row) => row.roleCode === roleCode);
    if (matches.length !== 1) {
      missingRoles.push(roleCode);
      continue;
    }
    const account = await models.Account.findOne({ where: { id: matches[0].accountId, companyId, isActive: true }, transaction });
    if (!account || account.type !== definition.type || account.nature !== definition.nature ||
        account.isPosting === false || (account.branchId && String(account.branchId) !== String(branchId))) {
      invalidRoles.push(roleCode);
      continue;
    }
    resolvedRoleAccounts.set(roleCode, account.id);
  }
  const missingMappings = [];
  const invalidMappings = [];
  for (const [mappingType, definition] of Object.entries(BRANCH_MAPPING_CATALOG)) {
    const matches = mappings.filter((row) => row.channel === null && row.mappingType === mappingType);
    if (matches.length !== 1) {
      missingMappings.push(mappingType);
      continue;
    }
    if (matches[0].accountId !== resolvedRoleAccounts.get(definition.accountRoleCode)) invalidMappings.push(mappingType);
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

module.exports = { reconcile, evaluateReadiness, readinessError };
