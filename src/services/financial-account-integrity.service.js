"use strict";

const { AppError } = require("../utils/errors");
const { ACCOUNT_ROLE_CATALOG } = require("./financial-account-catalog.service");
const {
  evaluateMappingAccountCompatibility,
} = require("./financial-mapping-compatibility.service");

const SEMANTIC_FIELDS = Object.freeze([
  "type",
  "nature",
  "statementClassification",
  "isPosting",
  "isActive",
  "parentId",
]);

function semanticError(reasonCode, field = "account", context = {}) {
  const fieldErrors = {
    field: [field],
    reasonCode: [reasonCode],
  };
  if (context.stableRole) fieldErrors.stableRole = [context.stableRole];
  if (context.mappingRole) fieldErrors.mappingRole = [context.mappingRole];
  return new AppError(
    "The financial account update is incompatible with protected accounting configuration.",
    422,
    "FINANCIAL_ACCOUNT_SEMANTIC_CHANGE_INCOMPATIBLE",
    fieldErrors,
  );
}

function changed(currentAccount, proposedAccount, field) {
  return String(currentAccount?.[field] ?? "") !== String(proposedAccount?.[field] ?? "");
}

function validateFinancialAccountProposedState({
  companyId,
  currentAccount,
  proposedAccount,
  stableRoleBindings = [],
  activeMappings = [],
  childAccounts = [],
  parentAccount = null,
  journalReferenceCount = 0,
}) {
  if (!currentAccount || !proposedAccount ||
      String(currentAccount.companyId || "") !== String(companyId || "") ||
      String(proposedAccount.companyId || "") !== String(companyId || "")) {
    throw semanticError("ACCOUNT_COMPANY_INVALID", "companyId");
  }

  if (childAccounts.length && proposedAccount.isPosting === true) {
    throw semanticError("ACCOUNT_WITH_CHILDREN_POSTING", "isPosting");
  }
  if (parentAccount) {
    if (String(parentAccount.companyId || "") !== String(companyId || "")) {
      throw semanticError("ACCOUNT_COMPANY_INVALID", "parentId");
    }
    if (parentAccount.isPosting === true) {
      throw semanticError("POSTING_PARENT_FORBIDDEN", "parentId");
    }
    if (parentAccount.type !== proposedAccount.type ||
        parentAccount.statementClassification !== proposedAccount.statementClassification) {
      throw semanticError("ACCOUNT_PARENT_SEMANTICS_INCOMPATIBLE", "parentId");
    }
  }

  if (Number(journalReferenceCount) > 0) {
    const changedField = SEMANTIC_FIELDS.find((field) => changed(currentAccount, proposedAccount, field));
    if (changedField) {
      throw semanticError("JOURNAL_REFERENCED_SEMANTIC_CHANGE", changedField);
    }
  }

  for (const binding of stableRoleBindings) {
    const roleCode = String(binding.roleCode || "").trim().toUpperCase();
    const role = ACCOUNT_ROLE_CATALOG[roleCode];
    if (!role) throw semanticError("STABLE_ROLE_UNKNOWN", "stableRole", { stableRole: roleCode });
    if (proposedAccount.isActive !== true) {
      throw semanticError("ACCOUNT_INACTIVE", "isActive", { stableRole: roleCode });
    }
    if (proposedAccount.isPosting !== role.isPosting) {
      throw semanticError("ACCOUNT_NOT_POSTING", "isPosting", { stableRole: roleCode });
    }
    if (proposedAccount.type !== role.type ||
        proposedAccount.nature !== role.nature ||
        proposedAccount.statementClassification !== role.statementClassification) {
      throw semanticError("STABLE_ROLE_INCOMPATIBLE", "accountSemantics", { stableRole: roleCode });
    }
  }

  for (const mapping of activeMappings) {
    const roleCodes = stableRoleBindings
      .filter((binding) => String(binding.branchId || "") === String(mapping.branchId || ""))
      .map((binding) => binding.roleCode);
    const result = evaluateMappingAccountCompatibility({
      companyId,
      branchId: mapping.branchId,
      mappingType: mapping.mappingType,
      account: proposedAccount,
      roleCodes,
    });
    if (!result.compatible) {
      throw semanticError(result.reasonCode, "accountSemantics", { mappingRole: result.mappingType });
    }
  }
  return proposedAccount;
}

module.exports = {
  SEMANTIC_FIELDS,
  semanticError,
  validateFinancialAccountProposedState,
};
