"use strict";

const models = require("../models");
const { AppError, NotFoundError, ValidationError } = require("../utils/errors");

function branchError(code, message, status = 403) {
  return new AppError(message, status, code);
}

async function requireOperationalBranch({ companyId, branchId, transaction = null }) {
  if (!branchId) throw branchError("BRANCH_CONTEXT_REQUIRED", "An explicit active branch is required for this operational command.", 422);
  const branch = await models.Branch.findOne({
    where: { id: String(branchId), companyId, isActive: true }, transaction,
  });
  if (!branch) throw branchError("BRANCH_SCOPE_INVALID", "The selected branch is invalid, inactive, or outside the company.");
  return branch;
}

function assertRequestedBranchMatches(requestedBranchId, effectiveBranchId) {
  if (requestedBranchId !== undefined && requestedBranchId !== null && requestedBranchId !== "" && String(requestedBranchId) !== String(effectiveBranchId)) {
    throw branchError("BRANCH_SCOPE_FORBIDDEN", "Client branch scope does not match the authenticated effective branch.");
  }
}

async function assertBranchCustomer({ companyId, branchId, customerId, transaction = null, lock = false }) {
  const row = await models.BranchCustomer.findOne({
    where: { companyId, branchId, customerId, isActive: true },
    transaction,
    lock: lock && transaction ? transaction.LOCK.UPDATE : undefined,
  });
  if (!row) throw new NotFoundError("Customer is not available in the effective branch.");
  return row;
}

function assertSameBranch(resource, branchId, resourceName = "Resource") {
  if (!resource || !resource.branchId) {
    throw new ValidationError(`${resourceName} requires a branch attribution before it can be used operationally.`);
  }
  if (String(resource.branchId) !== String(branchId)) {
    throw branchError("BRANCH_SCOPE_FORBIDDEN", `${resourceName} belongs to another branch.`);
  }
  return resource;
}

async function createBranchCustomer({ companyId, branchId, customerId, transaction = null }) {
  await requireOperationalBranch({ companyId, branchId, transaction });
  return models.BranchCustomer.findOrCreate({
    where: { companyId, branchId, customerId },
    defaults: {
      id: `BCR-${companyId}-${branchId}-${customerId}`,
      companyId, branchId, customerId, balance: 0, purchases: 0, loyaltyPoints: 0, isActive: true,
    }, transaction,
  });
}

module.exports = {
  requireOperationalBranch,
  assertRequestedBranchMatches,
  assertBranchCustomer,
  assertSameBranch,
  createBranchCustomer,
};
