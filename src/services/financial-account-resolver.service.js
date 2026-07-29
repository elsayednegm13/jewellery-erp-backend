"use strict";

const models = require("../models");
const { AppError } = require("../utils/errors");
const {
  POSTING_CODE_ROLE,
  ACCOUNT_ROLE_CATALOG,
  BRANCH_MAPPING_CATALOG,
} = require("./financial-account-catalog.service");

function fail(code, message) {
  return new AppError(message, 422, code);
}

async function resolvePostingAccount({
  companyId,
  branchId,
  accountCode,
  accountId,
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
  } else {
    const normalizedCode = String(accountCode || "").trim().toUpperCase();
    const roleCode = POSTING_CODE_ROLE[normalizedCode] ||
      Object.entries(ACCOUNT_ROLE_CATALOG).find(([, definition]) => definition.code === normalizedCode)?.[0];
    if (roleCode) {
      if (!branchId) throw fail("FINANCIAL_BRANCH_REQUIRED", "An operational Branch is required for posting.");
      const mappingType = Object.entries(BRANCH_MAPPING_CATALOG)
        .find(([, definition]) => definition.accountRoleCode === roleCode)?.[0];
      if (!mappingType) throw fail("FINANCIAL_MAPPING_REQUIRED", "The required financial mapping is not configured.");
      const mappings = await models.BranchFinancialMapping.findAll({
        where: { companyId, branchId, mappingType, channel: null, isActive: true },
        transaction,
        lock: transaction?.LOCK.UPDATE,
      });
      if (mappings.length !== 1) throw fail("FINANCIAL_MAPPING_REQUIRED", "The required Branch financial mapping is missing or ambiguous.");
      account = await models.Account.findOne({
        where: { id: mappings[0].accountId, companyId, isActive: true },
        transaction,
        lock: transaction?.LOCK.UPDATE,
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

module.exports = { resolvePostingAccount };
