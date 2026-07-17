const { CashRegisterSession, sequelize } = require("../models");
const auditService = require("./audit.service");
const accountBalanceService = require("./account-balance.service");
const { AppError, ConflictError, ValidationError } = require("../utils/errors");

const CASH_ACCOUNT_CODE = "1110";
const round = (value) => Math.round((Number(value) || 0) * 100) / 100;

function actorFromRequest(req) {
  const user = req?.user || {};
  const operator = req?.operatorContext || {};
  return {
    userId: user.id || null,
    employeeId: operator.employeeId || null,
    name: operator.employeeName || `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email || "System"
  };
}

function isCashAffected(account, toAccount) {
  return String(account || "").toLowerCase() === "cash" || String(toAccount || "").toLowerCase() === "cash";
}

async function currentOpen({ companyId, branchId, transaction = null }) {
  return CashRegisterSession.findOne({
    where: { companyId, branchId, cashAccountCode: CASH_ACCOUNT_CODE, status: "OPEN" },
    order: [["opened_at", "DESC"]],
    transaction
  });
}

async function listSessions({ companyId, branchId = null, limit = 50, transaction = null }) {
  const where = { companyId };
  if (branchId) where.branchId = branchId;
  return CashRegisterSession.findAll({
    where,
    order: [["created_at", "DESC"]],
    limit,
    transaction
  });
}

async function calculateExpected(session, options = {}) {
  if (!session) return null;
  const movement = await accountBalanceService.calculateMovementSince({
    companyId: session.companyId,
    branchId: session.branchId,
    accountCode: session.cashAccountCode || CASH_ACCOUNT_CODE,
    since: session.openedAt,
    transaction: options.transaction || null
  });
  return round(Number(session.openingCountedAmount || 0) + movement);
}

async function requireOpenForCashMutation({ companyId, branchId, account, toAccount = null, transaction = null }) {
  if (!isCashAffected(account, toAccount)) return null;
  const session = await currentOpen({ companyId, branchId, transaction });
  if (!session) {
    throw new AppError("Open the branch cash register before recording cash movements.", 409, "CASH_REGISTER_REQUIRED");
  }
  return session;
}

async function openRegister({ companyId, branchId, openingCountedAmount, idempotencyKey = null, actor, transaction = null }) {
  if (!companyId || !branchId) throw new Error("openRegister requires companyId and branchId");
  const opening = Number(openingCountedAmount);
  if (!Number.isFinite(opening) || opening < 0) {
    throw new ValidationError("Opening counted amount must be a valid non-negative number.");
  }
  const execute = async (t) => {
    if (idempotencyKey) {
      const existingByKey = await CashRegisterSession.findOne({ where: { companyId, openIdempotencyKey: idempotencyKey }, transaction: t });
      if (existingByKey) return existingByKey;
    }
    const existing = await currentOpen({ companyId, branchId, transaction: t });
    if (existing) throw new ConflictError("A cash register is already open for this branch.");
    const now = new Date();
    const row = await CashRegisterSession.create({
      id: `CRS-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      companyId,
      branchId,
      cashAccountCode: CASH_ACCOUNT_CODE,
      status: "OPEN",
      openedAt: now,
      openingCountedAmount: round(opening),
      openedByUserId: actor?.userId || null,
      openedByEmployeeId: actor?.employeeId || null,
      openedByName: actor?.name || "System",
      openIdempotencyKey: idempotencyKey || null,
    }, { transaction: t });
    await auditService.record(companyId, {
      action: "treasury.register.open",
      description: `Cash register opened for branch ${branchId}`,
      user: actor?.name || "System",
      userId: actor?.userId || null,
      employeeId: actor?.employeeId || null,
      branch: branchId,
      place: branchId,
      sourceDocument: row.id,
      severity: "info",
      after: JSON.stringify(row.toJSON())
    }, { transaction: t });
    return row;
  };
  return transaction ? execute(transaction) : sequelize.transaction(execute);
}

async function closeRegister({ companyId, branchId, countedAmount, varianceReason = null, idempotencyKey = null, actor, transaction = null }) {
  const counted = Number(countedAmount);
  if (!Number.isFinite(counted) || counted < 0) {
    throw new ValidationError("Closing counted amount must be a valid non-negative number.");
  }
  const execute = async (t) => {
    if (idempotencyKey) {
      const existingByKey = await CashRegisterSession.findOne({ where: { companyId, closeIdempotencyKey: idempotencyKey }, transaction: t });
      if (existingByKey) return existingByKey;
    }
    const row = await currentOpen({ companyId, branchId, transaction: t });
    if (!row) throw new AppError("No open cash register exists for this branch.", 409, "CASH_REGISTER_NOT_OPEN");
    const expected = await calculateExpected(row, { transaction: t });
    const variance = round(counted - expected);
    if (Math.abs(variance) >= 0.01 && !String(varianceReason || "").trim()) {
      throw new ValidationError("Variance reason is required when counted cash differs from expected cash.");
    }
    const before = row.toJSON();
    await row.update({
      status: "CLOSED",
      closedAt: new Date(),
      closedByUserId: actor?.userId || null,
      closedByEmployeeId: actor?.employeeId || null,
      closedByName: actor?.name || "System",
      closingCountedAmount: round(counted),
      systemExpectedAmount: expected,
      variance,
      varianceReason: String(varianceReason || "").trim() || null,
      closeIdempotencyKey: idempotencyKey || null,
    }, { transaction: t });
    await auditService.record(companyId, {
      action: "treasury.register.close",
      description: `Cash register closed for branch ${branchId} with variance ${variance}`,
      user: actor?.name || "System",
      userId: actor?.userId || null,
      employeeId: actor?.employeeId || null,
      branch: branchId,
      place: branchId,
      sourceDocument: row.id,
      severity: Math.abs(variance) < 0.01 ? "info" : "warning",
      before: JSON.stringify(before),
      after: JSON.stringify(row.toJSON())
    }, { transaction: t });
    return row;
  };
  return transaction ? execute(transaction) : sequelize.transaction(execute);
}

module.exports = {
  CASH_ACCOUNT_CODE,
  actorFromRequest,
  calculateExpected,
  closeRegister,
  currentOpen,
  isCashAffected,
  listSessions,
  openRegister,
  requireOpenForCashMutation,
};
