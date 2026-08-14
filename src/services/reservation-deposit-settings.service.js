"use strict";

const models = require("../models");
const { Op } = require("sequelize");
const { AppError, ValidationError } = require("../utils/errors");
const { TYPES, normalizeChannel } = require("./reservation-financial-resolver.service");

function configurationError(code, message, status = 422) {
  return new AppError(message, status, code);
}

function newId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function assertPostingAccount({ companyId, branchId, accountId, type, nature, transaction }) {
  const account = await models.Account.findOne({
    where: { id: accountId, companyId, isActive: true, [Op.or]: [{ branchId: null }, { branchId }] }, transaction, lock: transaction?.LOCK.UPDATE
  });
  if (!account || account.type !== type || account.nature !== nature) {
    throw configurationError("DEPOSIT_MAPPING_ACCOUNT_INVALID", "The selected active posting account is not owned by this branch.");
  }
  return account;
}

async function read({ companyId, branchId, transaction = null }) {
  const [mappings, liabilityAccounts, treasuryAccounts] = await Promise.all([
    models.BranchFinancialMapping.findAll({
    where: { companyId, branchId },
    include: [{ model: models.Account, as: "account", required: false }],
    order: [["mappingType", "ASC"], ["channel", "ASC"], ["createdAt", "ASC"]],
    transaction
    }),
    models.Account.findAll({ where: { companyId, isActive: true, type: "liability", nature: "credit", [Op.or]: [{ branchId: null }, { branchId }] }, attributes: ["id", "code", "name", "nameAr"], order: [["code", "ASC"]], transaction }),
    models.Account.findAll({ where: { companyId, isActive: true, type: "asset", nature: "debit", [Op.or]: [{ branchId: null }, { branchId }] }, attributes: ["id", "code", "name", "nameAr"], order: [["code", "ASC"]], transaction })
  ]);
  const active = mappings.filter((mapping) => mapping.isActive);
  const byType = (mappingType, channel = undefined) => active.find((mapping) => mapping.mappingType === mappingType && (channel === undefined ? !mapping.channel : mapping.channel === channel)) || null;
  const channels = active.filter((mapping) => mapping.mappingType === TYPES.PAYMENT_CHANNEL).map((mapping) => mapping.channel);
  return {
    branchId,
    reservationAdvanceLiability: byType(TYPES.RESERVATION_ADVANCE_LIABILITY),
    cashTreasury: byType(TYPES.CASH_TREASURY),
    paymentChannels: active.filter((mapping) => mapping.mappingType === TYPES.PAYMENT_CHANNEL),
    allowedReceiptMethods: [byType(TYPES.CASH_TREASURY) ? "cash" : null, ...channels].filter(Boolean),
    allowedRefundMethods: [byType(TYPES.CASH_TREASURY) ? "cash" : null, ...channels].filter(Boolean),
    eligibleLiabilityAccounts: liabilityAccounts,
    eligibleTreasuryAccounts: treasuryAccounts,
    health: {
      liabilityConfigured: Boolean(byType(TYPES.RESERVATION_ADVANCE_LIABILITY)),
      cashConfigured: Boolean(byType(TYPES.CASH_TREASURY)),
      channelCount: channels.length
    }
  };
}

async function replaceActiveMapping({ companyId, branchId, mappingType, channel = null, accountId, actor, transaction }) {
  const normalizedChannel = channel === null ? null : normalizeChannel(channel);
  const expected = mappingType === TYPES.RESERVATION_ADVANCE_LIABILITY
    ? { type: "liability", nature: "credit" }
    : { type: "asset", nature: "debit" };
  await assertPostingAccount({ companyId, branchId, accountId, ...expected, transaction });
  const where = { companyId, branchId, mappingType, isActive: true, channel: normalizedChannel };
  const current = await models.BranchFinancialMapping.findAll({ where, transaction, lock: transaction.LOCK.UPDATE });
  await Promise.all(current.map((row) => row.update({ isActive: false, updatedBy: actor }, { transaction })));
  return models.BranchFinancialMapping.create({
    id: newId("BFM"), companyId, branchId, mappingType, channel: normalizedChannel,
    accountId, isActive: true, createdBy: actor, updatedBy: actor
  }, { transaction });
}

async function save({ companyId, branchId, body = {}, actor }) {
  const transaction = await models.sequelize.transaction();
  try {
    const branch = await models.Branch.findOne({ where: { id: branchId, companyId, isActive: true }, transaction, lock: transaction.LOCK.UPDATE });
    if (!branch) throw configurationError("DEPOSIT_BRANCH_REQUIRED", "The operational branch is invalid.", 403);
    if (body.reservationAdvanceLiabilityAccountId !== undefined) {
      await replaceActiveMapping({ companyId, branchId, mappingType: TYPES.RESERVATION_ADVANCE_LIABILITY, accountId: body.reservationAdvanceLiabilityAccountId, actor, transaction });
    }
    if (body.cashTreasuryAccountId !== undefined) {
      await replaceActiveMapping({ companyId, branchId, mappingType: TYPES.CASH_TREASURY, accountId: body.cashTreasuryAccountId, actor, transaction });
    }
    if (body.paymentChannels !== undefined) {
      if (!Array.isArray(body.paymentChannels)) throw new ValidationError("paymentChannels must be an array");
      const currentChannels = await models.BranchFinancialMapping.findAll({
        where: { companyId, branchId, mappingType: TYPES.PAYMENT_CHANNEL, isActive: true }, transaction, lock: transaction.LOCK.UPDATE
      });
      await Promise.all(currentChannels.map((row) => row.update({ isActive: false, updatedBy: actor }, { transaction })));
      const seen = new Set();
      for (const raw of body.paymentChannels) {
        const channel = normalizeChannel(raw?.channel);
        if (channel === "cash" || !raw?.accountId) throw new ValidationError("Each non-cash payment channel requires a channel and accountId");
        if (seen.has(channel)) throw configurationError("DEPOSIT_CHANNEL_DUPLICATE", "A payment channel may only be configured once per branch.");
        seen.add(channel);
        await replaceActiveMapping({ companyId, branchId, mappingType: TYPES.PAYMENT_CHANNEL, channel, accountId: raw.accountId, actor, transaction });
      }
    }
    const result = await read({ companyId, branchId, transaction });
    await transaction.commit();
    return result;
  } catch (error) {
    try { await transaction.rollback(); } catch (_) {}
    throw error;
  }
}

module.exports = { read, save };
