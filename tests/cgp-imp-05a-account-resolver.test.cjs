"use strict";

const assert = require("node:assert/strict");
const { resolveRequiredSemanticAccount } = require("../src/services/financial-account-resolver.service");

const companyId = "COMPANY";
const branchId = "BRANCH";
const validAccount = Object.freeze({
  id: "ACCOUNT", companyId, branchId: null, isActive: true, isPosting: true,
  type: "liability", nature: "credit", statementClassification: "liability",
});

function models(roleRows, account = validAccount) {
  return {
    SystemAccountRole: { findAll: async () => roleRows },
    Account: { findOne: async () => account },
  };
}

async function rejects(code, callback) {
  await assert.rejects(callback, (error) => error?.errorCode === code);
}

async function main() {
  const valid = await resolveRequiredSemanticAccount({
    companyId, branchId, roleCode: "CUSTOMER_CREDITOR",
    modelSet: models([{ accountId: "ACCOUNT" }]),
  });
  assert.equal(valid.id, "ACCOUNT");

  await rejects("FINANCIAL_MAPPING_REQUIRED", () => resolveRequiredSemanticAccount({
    companyId, branchId, roleCode: "CUSTOMER_CREDITOR", modelSet: models([]),
  }));
  await rejects("FINANCIAL_MAPPING_REQUIRED", () => resolveRequiredSemanticAccount({
    companyId, branchId, roleCode: "CUSTOMER_CREDITOR", modelSet: models([{ accountId: "ACCOUNT" }, { accountId: "ACCOUNT-2" }]),
  }));
  await rejects("FINANCIAL_ACCOUNT_INVALID", () => resolveRequiredSemanticAccount({
    companyId, branchId, roleCode: "CUSTOMER_CREDITOR", modelSet: models([{ accountId: "ACCOUNT" }], { ...validAccount, isActive: false }),
  }));
  await rejects("FINANCIAL_ACCOUNT_INVALID", () => resolveRequiredSemanticAccount({
    companyId, branchId, roleCode: "CUSTOMER_CREDITOR", modelSet: models([{ accountId: "ACCOUNT" }], { ...validAccount, companyId: "OTHER" }),
  }));
  await rejects("FINANCIAL_MAPPING_REQUIRED", () => resolveRequiredSemanticAccount({
    companyId, branchId, roleCode: "UNKNOWN_ROLE", modelSet: models([{ accountId: "ACCOUNT" }]),
  }));

  console.log("CGP_IMP_05A_SEMANTIC_RESOLVER_TEST: PASS");
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
