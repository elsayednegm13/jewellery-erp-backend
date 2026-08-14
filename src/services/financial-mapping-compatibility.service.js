"use strict";

const { AppError } = require("../utils/errors");
const {
  ACCOUNT_ROLE_CATALOG,
  BRANCH_MAPPING_CATALOG,
} = require("./financial-account-catalog.service");

const REASON_CODES = Object.freeze({
  ACCOUNT_INACTIVE: "ACCOUNT_INACTIVE",
  ACCOUNT_NOT_POSTING: "ACCOUNT_NOT_POSTING",
  ACCOUNT_ROLE_MISSING: "ACCOUNT_ROLE_MISSING",
  ACCOUNT_ROLE_INCOMPATIBLE: "ACCOUNT_ROLE_INCOMPATIBLE",
  ACCOUNT_CLASSIFICATION_INCOMPATIBLE: "ACCOUNT_CLASSIFICATION_INCOMPATIBLE",
  ACCOUNT_COMPANY_INVALID: "ACCOUNT_COMPANY_INVALID",
});

function incompatible(mappingType, reasonCode) {
  return { compatible: false, mappingType, reasonCode };
}

function evaluateMappingAccountCompatibility({
  companyId,
  branchId,
  mappingType,
  account,
  roleCodes = [],
}) {
  const normalizedMappingType = String(mappingType || "").trim().toUpperCase();
  const mapping = BRANCH_MAPPING_CATALOG[normalizedMappingType];
  if (!mapping) return incompatible(normalizedMappingType, REASON_CODES.ACCOUNT_ROLE_INCOMPATIBLE);
  if (!account || String(account.companyId || "") !== String(companyId || "")) {
    return incompatible(normalizedMappingType, REASON_CODES.ACCOUNT_COMPANY_INVALID);
  }
  if (account.branchId && String(account.branchId) !== String(branchId || "")) {
    return incompatible(normalizedMappingType, REASON_CODES.ACCOUNT_COMPANY_INVALID);
  }
  if (account.isActive !== true) return incompatible(normalizedMappingType, REASON_CODES.ACCOUNT_INACTIVE);
  if (account.isPosting !== true) return incompatible(normalizedMappingType, REASON_CODES.ACCOUNT_NOT_POSTING);

  const expectedRole = ACCOUNT_ROLE_CATALOG[mapping.accountRoleCode];
  const classificationCompatible = Boolean(
    expectedRole &&
    account.type === expectedRole.type &&
    account.nature === expectedRole.nature &&
    account.statementClassification === expectedRole.statementClassification
  );
  const explicitFamilyCompatible = Boolean(
    expectedRole &&
    account.type === expectedRole.type &&
    account.nature === expectedRole.nature &&
    mapping.allowedStatementClassifications.includes(account.statementClassification)
  );
  if (!classificationCompatible && !explicitFamilyCompatible) {
    return incompatible(normalizedMappingType, REASON_CODES.ACCOUNT_CLASSIFICATION_INCOMPATIBLE);
  }

  const stableRoles = [...new Set(roleCodes.map((roleCode) => String(roleCode || "").trim().toUpperCase()).filter(Boolean))];
  if (stableRoles.includes(mapping.accountRoleCode)) {
    return {
      compatible: true,
      mappingType: normalizedMappingType,
      compatibility: "EXACT_ROLE",
    };
  }
  if (stableRoles.length) {
    return incompatible(normalizedMappingType, REASON_CODES.ACCOUNT_ROLE_INCOMPATIBLE);
  }
  if (explicitFamilyCompatible && mapping.allowedStatementClassifications.length) {
    return {
      compatible: true,
      mappingType: normalizedMappingType,
      compatibility: "EXPLICIT_CLASSIFICATION_FAMILY",
    };
  }
  return incompatible(normalizedMappingType, REASON_CODES.ACCOUNT_ROLE_MISSING);
}

async function inspectMappingAccountCompatibility({
  models,
  companyId,
  branchId,
  mappingType,
  accountId,
  account: suppliedAccount = null,
  roles: suppliedRoles = null,
  transaction = null,
  lock = false,
}) {
  const account = suppliedAccount || await models.Account.findOne({
    where: { id: accountId },
    transaction,
    lock: lock ? transaction?.LOCK.UPDATE : undefined,
  });
  const roles = suppliedRoles || (account ? await models.SystemAccountRole.findAll({
    where: {
      companyId,
      branchId,
      accountId: account.id,
    },
    attributes: ["roleCode"],
    transaction,
    lock: lock ? transaction?.LOCK.UPDATE : undefined,
  }) : []);
  const result = evaluateMappingAccountCompatibility({
    companyId,
    branchId,
    mappingType,
    account,
    roleCodes: roles.map((row) => row.roleCode),
  });
  return { account, result };
}

function compatibilityError(result) {
  return new AppError(
    "The selected account is not compatible with this financial mapping role.",
    422,
    "FINANCIAL_MAPPING_ACCOUNT_INCOMPATIBLE",
    {
      mappingRole: [result.mappingType],
      reasonCode: [result.reasonCode],
    },
  );
}

async function assertMappingAccountCompatibility(input) {
  const inspected = await inspectMappingAccountCompatibility(input);
  if (!inspected.result.compatible) throw compatibilityError(inspected.result);
  return inspected.account;
}

async function listEligibleAccounts({
  models,
  companyId,
  branchId,
  mappingType,
  transaction = null,
}) {
  const normalizedMappingType = String(mappingType || "").trim().toUpperCase();
  if (!BRANCH_MAPPING_CATALOG[normalizedMappingType]) {
    throw compatibilityError(incompatible(normalizedMappingType, REASON_CODES.ACCOUNT_ROLE_INCOMPATIBLE));
  }
  const [accounts, roles] = await Promise.all([
    models.Account.findAll({
      where: { companyId },
      attributes: [
        "id", "companyId", "code", "name", "nameAr", "type", "nature", "statementClassification",
        "isActive", "isPosting", "branchId",
      ],
      order: [["code", "ASC"]],
      transaction,
    }),
    models.SystemAccountRole.findAll({
      where: { companyId, branchId },
      attributes: ["accountId", "roleCode"],
      transaction,
    }),
  ]);
  const rolesByAccount = new Map();
  for (const role of roles) {
    const accountRoles = rolesByAccount.get(role.accountId) || [];
    accountRoles.push(role.roleCode);
    rolesByAccount.set(role.accountId, accountRoles);
  }
  return accounts.filter((account) => evaluateMappingAccountCompatibility({
    companyId,
    branchId,
    mappingType: normalizedMappingType,
    account,
    roleCodes: rolesByAccount.get(account.id) || [],
  }).compatible);
}

module.exports = {
  REASON_CODES,
  evaluateMappingAccountCompatibility,
  inspectMappingAccountCompatibility,
  assertMappingAccountCompatibility,
  listEligibleAccounts,
};
