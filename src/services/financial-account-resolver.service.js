"use strict";

const models = require("../models");
const { AppError } = require("../utils/errors");
const {
  POSTING_CODE_ROLE,
  ACCOUNT_ROLE_CATALOG,
  BRANCH_MAPPING_CATALOG,
  getSemanticAccountRoleDefinition,
} = require("./financial-account-catalog.service");
const {
  assertMappingAccountCompatibility,
} = require("./financial-mapping-compatibility.service");

function fail(code, message) {
  return new AppError(message, 422, code);
}

async function resolveRequiredBranchFinancialAccount({
  companyId,
  branchId,
  mappingRole,
  transaction,
  modelSet = models,
  compatibility = assertMappingAccountCompatibility,
}) {
  if (!companyId) throw fail("FINANCIAL_CONTEXT_REQUIRED", "A Company context is required for posting.");
  if (!branchId) throw fail("FINANCIAL_BRANCH_REQUIRED", "An operational Branch is required for posting.");

  const mappingType = String(mappingRole || "").trim().toUpperCase();
  if (!BRANCH_MAPPING_CATALOG[mappingType]) {
    throw fail("FINANCIAL_MAPPING_REQUIRED", "The required financial mapping is not configured.");
  }
  const mappings = await modelSet.BranchFinancialMapping.findAll({
    where: { companyId, branchId, mappingType, channel: null, isActive: true },
    transaction,
    lock: transaction?.LOCK.UPDATE,
  });
  if (mappings.length !== 1) {
    throw fail("FINANCIAL_MAPPING_REQUIRED", "The required Branch financial mapping is missing or ambiguous.");
  }
  return compatibility({
    models: modelSet,
    companyId,
    branchId,
    mappingType,
    accountId: mappings[0].accountId,
    transaction,
    lock: true,
  });
}

// Resolves a stable accounting semantic role without treating an account name,
// chart code, or arbitrary liability as runtime authority.  This is separate
// from BranchFinancialMapping because some future financial capabilities need
// a role→account mapping but do not create a generic branch mapping type.
async function resolveRequiredSemanticAccount({
  companyId,
  branchId,
  roleCode,
  transaction,
  modelSet = models,
}) {
  if (!companyId) throw fail("FINANCIAL_CONTEXT_REQUIRED", "A Company context is required for posting.");
  if (!branchId) throw fail("FINANCIAL_BRANCH_REQUIRED", "An operational Branch is required for posting.");

  const normalizedRoleCode = String(roleCode || "").trim().toUpperCase();
  const definition = getSemanticAccountRoleDefinition(normalizedRoleCode);
  if (!definition) throw fail("FINANCIAL_MAPPING_REQUIRED", "The required financial mapping is not configured.");

  const mappings = await modelSet.SystemAccountRole.findAll({
    where: { companyId, branchId, roleCode: normalizedRoleCode },
    transaction,
    lock: transaction?.LOCK.UPDATE,
  });
  if (mappings.length !== 1) {
    throw fail("FINANCIAL_MAPPING_REQUIRED", "The required financial mapping is missing or ambiguous.");
  }
  const account = await modelSet.Account.findOne({
    where: { id: mappings[0].accountId, companyId, isActive: true },
    transaction,
    lock: transaction?.LOCK.UPDATE,
  });
  if (!account || String(account.companyId) !== String(companyId) || account.isActive !== true || account.isPosting === false || account.type !== definition.type ||
      account.nature !== definition.nature || account.statementClassification !== definition.statementClassification ||
      (account.branchId && String(account.branchId) !== String(branchId))) {
    throw fail("FINANCIAL_ACCOUNT_INVALID", "The resolved account is inactive, missing, or incompatible.");
  }
  return account;
}

async function resolvePostingAccount({
  companyId,
  branchId,
  accountCode,
  accountId,
  mappingRole,
  transaction,
}) {
  if (!companyId) throw fail("FINANCIAL_CONTEXT_REQUIRED", "A Company context is required for posting.");

  let account = null;
  if (accountId) {
    account = await models.Account.findOne({
      where: { id: accountId, companyId, isActive: true },
      transaction,
      lock: transaction?.LOCK.UPDATE,
    });
  } else if (mappingRole) {
    account = await resolveRequiredBranchFinancialAccount({
      companyId,
      branchId,
      mappingRole,
      transaction,
    });
  } else {
    const normalizedCode = String(accountCode || "").trim().toUpperCase();
    const roleCode = POSTING_CODE_ROLE[normalizedCode] ||
      Object.entries(ACCOUNT_ROLE_CATALOG).find(([, definition]) => definition.code === normalizedCode)?.[0];
    if (roleCode) {
      if (!branchId) throw fail("FINANCIAL_BRANCH_REQUIRED", "An operational Branch is required for posting.");
      const mappingType = Object.entries(BRANCH_MAPPING_CATALOG)
        .find(([, definition]) => definition.accountRoleCode === roleCode)?.[0];
      if (!mappingType) throw fail("FINANCIAL_MAPPING_REQUIRED", "The required financial mapping is not configured.");
      account = await resolveRequiredBranchFinancialAccount({
        companyId,
        branchId,
        mappingRole: mappingType,
        transaction,
      });
    } else {
      account = await models.Account.findOne({
        where: { companyId, code: normalizedCode, isActive: true },
        transaction,
        lock: transaction?.LOCK.UPDATE,
      });
    }
  }

  if (!account || account.isPosting === false) {
    throw fail("FINANCIAL_ACCOUNT_INVALID", "The resolved account is inactive, missing, or not posting-enabled.");
  }
  if (account.branchId && String(account.branchId) !== String(branchId || "")) {
    throw fail("FINANCIAL_ACCOUNT_SCOPE_INVALID", "The resolved account is outside the operational Branch.");
  }
  return account;
}

module.exports = {
  resolvePostingAccount,
  resolveRequiredBranchFinancialAccount,
  resolveRequiredSemanticAccount,
};
