"use strict";

const models = require("../models");
const { AppError } = require("../utils/errors");
const { resolveRequiredBranchFinancialAccount } = require("./financial-account-resolver.service");

const TYPES = Object.freeze({
  RESERVATION_ADVANCE_LIABILITY: "RESERVATION_ADVANCE_LIABILITY",
  CASH_TREASURY: "CASH_TREASURY",
  BANK_ACCOUNT: "BANK_ACCOUNT",
  PAYMENT_CHANNEL: "PAYMENT_CHANNEL",
});

function fail(code, message, status = 422) { return new AppError(message, status, code); }
function normalizeChannel(value) { return String(value || "cash").trim().toLowerCase(); }

function assertNoRawFinancialAuthority(body = {}) {
  const forbidden = ["treasuryAccountCode", "treasuryAccountId", "liabilityAccountCode", "liabilityAccountId", "cashRegisterId", "cashSessionId", "bankAccountId"];
  if (forbidden.some((key) => body[key] !== undefined && body[key] !== null && body[key] !== "")) {
    throw fail("RAW_FINANCIAL_AUTHORITY_FORBIDDEN", "Raw financial account, register, or session authority is not accepted.", 400);
  }
}

async function branchRow(companyId, branchId, transaction) {
  if (!branchId) throw fail("DEPOSIT_BRANCH_REQUIRED", "An operational branch is required.");
  const branch = await models.Branch.findOne({ where: { id: branchId, companyId, isActive: true }, transaction, lock: transaction?.LOCK.UPDATE });
  if (!branch) throw fail("DEPOSIT_BRANCH_REQUIRED", "The operational branch is invalid.");
  return branch;
}

async function mapping(companyId, branchId, mappingType, channel, transaction) {
  const where = { companyId, branchId, mappingType, isActive: true };
  if (channel !== undefined) where.channel = channel;
  const rows = await models.BranchFinancialMapping.findAll({ where, transaction, lock: transaction?.LOCK.UPDATE });
  const prefix = mappingType === TYPES.RESERVATION_ADVANCE_LIABILITY ? "DEPOSIT_LIABILITY" : "TREASURY";
  if (!rows.length) throw fail(`${prefix}_MAPPING_MISSING`, "Required branch financial mapping is missing.");
  if (rows.length !== 1) throw fail(`${prefix}_MAPPING_AMBIGUOUS`, "Required branch financial mapping is ambiguous.");
  const account = await models.Account.findOne({ where: { id: rows[0].accountId, companyId, isActive: true }, transaction, lock: transaction?.LOCK.UPDATE });
  if (account?.branchId && String(account.branchId) !== String(branchId)) throw fail(`${prefix}_MAPPING_MISSING`, "Mapped financial account is outside the branch.");
  if (!account) throw fail(`${prefix}_MAPPING_MISSING`, "Mapped financial account is inactive or outside the branch.");
  return { mapping: rows[0], account };
}

async function resolveForReservation({ reservation, companyId, channel, transaction, requireSession = true, requireTreasury = true }) {
  if (!reservation?.branchId) throw fail("LEGACY_BRANCHLESS_RESERVATION_MANUAL_REVIEW", "Branchless legacy reservations require manual review.", 409);
  if (String(reservation.companyId) !== String(companyId)) throw fail("DEPOSIT_BRANCH_REQUIRED", "Reservation company scope is invalid.", 403);
  await branchRow(companyId, reservation.branchId, transaction);
  const liabilityAccount = await resolveRequiredBranchFinancialAccount({
    companyId,
    branchId: reservation.branchId,
    mappingRole: TYPES.RESERVATION_ADVANCE_LIABILITY,
    transaction,
  });
  if (!requireTreasury) {
    return { branchId: reservation.branchId, channel: null, liabilityAccount, treasuryAccount: null, cashSession: null };
  }
  const normalized = normalizeChannel(channel);
  if (normalized === "cash") {
    const treasuryAccount = await resolveRequiredBranchFinancialAccount({
      companyId,
      branchId: reservation.branchId,
      mappingRole: TYPES.CASH_TREASURY,
      transaction,
    });
    let session = null;
    if (requireSession) {
      session = await models.CashRegisterSession.findOne({ where: { companyId, branchId: reservation.branchId, cashAccountCode: treasuryAccount.code, status: "OPEN" }, transaction, lock: transaction?.LOCK.UPDATE });
      if (!session) throw fail("CASH_REGISTER_SESSION_REQUIRED", "Open the branch cash register before recording a cash reservation deposit.", 409);
    }
    return { branchId: reservation.branchId, channel: normalized, liabilityAccount, treasuryAccount, cashSession: session };
  }
  if (normalized === "bank") {
    const treasuryAccount = await resolveRequiredBranchFinancialAccount({
      companyId,
      branchId: reservation.branchId,
      mappingRole: TYPES.BANK_ACCOUNT,
      transaction,
    });
    return { branchId: reservation.branchId, channel: normalized, liabilityAccount, treasuryAccount, cashSession: null };
  }
  const treasury = await mapping(companyId, reservation.branchId, TYPES.PAYMENT_CHANNEL, normalized, transaction).catch((error) => {
    if (error.errorCode === "TREASURY_MAPPING_MISSING") throw fail("PAYMENT_CHANNEL_UNAUTHORIZED", "The payment channel is not authorized for this branch.");
    throw error;
  });
  if (treasury.account.type !== "asset" || treasury.account.nature !== "debit") throw fail("TREASURY_MAPPING_MISSING", "Payment channel mapping is not a posting asset account.");
  return { branchId: reservation.branchId, channel: normalized, liabilityAccount, treasuryAccount: treasury.account, cashSession: null };
}

module.exports = { TYPES, assertNoRawFinancialAuthority, normalizeChannel, resolveForReservation };
