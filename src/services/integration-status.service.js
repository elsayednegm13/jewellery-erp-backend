const crypto = require("crypto");
const models = require("../models");
const { ConflictError, ValidationError } = require("../utils/errors");
const { SERVER_CONTROLLED_CONSUMERS } = require("./processed-event.service");
const { sanitizeError, retryAvailableAt } = require("./outbox.service");

const INTEGRATION_STATUS = Object.freeze({
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  SUCCEEDED: "SUCCEEDED",
  RETRYABLE_FAILED: "RETRYABLE_FAILED",
});

function required(value, field) {
  const result = String(value || "").trim();
  if (!result) throw new ValidationError(`${field} is required`, { [field]: ["required"] });
  return result;
}

function requireTransaction(transaction) {
  if (!transaction) throw new ValidationError("Integration status operation requires a caller transaction", { transaction: ["required"] });
  return transaction;
}

function requireConsumer(value) {
  const consumer = required(value, "consumerName");
  if (!SERVER_CONTROLLED_CONSUMERS.includes(consumer)) throw new ValidationError("consumerName is not server-controlled", { consumerName: ["unsupported_consumer"] });
  return consumer;
}

async function ensureIntegrationStatus({ transaction, sourceEventId, aggregateType, aggregateId, consumerName, correlationId, model = models.IntegrationStatus } = {}) {
  requireTransaction(transaction);
  const consumer = requireConsumer(consumerName);
  const existing = await model.findOne({ where: { sourceEventId: required(sourceEventId, "sourceEventId"), consumerName: consumer }, transaction });
  if (existing) return { created: false, status: existing };
  const savepoint = await transaction.sequelize.transaction({ transaction });
  try {
    const status = await model.create({
      id: `IST:${crypto.randomUUID()}`,
      sourceEventId: required(sourceEventId, "sourceEventId"),
      aggregateType: required(aggregateType, "aggregateType"),
      aggregateId: required(aggregateId, "aggregateId"),
      consumerName: consumer,
      status: INTEGRATION_STATUS.PENDING,
      correlationId: required(correlationId, "correlationId"),
    }, { transaction: savepoint });
    await savepoint.commit();
    return { created: true, status };
  } catch (error) {
    await savepoint.rollback();
    if (error?.name === "SequelizeUniqueConstraintError") return { created: false, status: null };
    throw error;
  }
}

function assertTransition(current, next) {
  const legal = {
    // A synchronous consumer may complete or fail within the transaction that
    // created its tracking row; an asynchronous worker normally enters
    // PROCESSING first. Both paths preserve one durable status record.
    PENDING: [INTEGRATION_STATUS.PROCESSING, INTEGRATION_STATUS.SUCCEEDED, INTEGRATION_STATUS.RETRYABLE_FAILED],
    PROCESSING: [INTEGRATION_STATUS.SUCCEEDED, INTEGRATION_STATUS.RETRYABLE_FAILED],
    RETRYABLE_FAILED: [INTEGRATION_STATUS.PENDING, INTEGRATION_STATUS.PROCESSING],
    SUCCEEDED: [],
  };
  if (!legal[current]?.includes(next)) throw new ConflictError(`Illegal integration status transition ${current} -> ${next}`);
}

async function transitionIntegrationStatus({ transaction, status, nextStatus, error = null, now = new Date() } = {}) {
  requireTransaction(transaction);
  if (!status) throw new ValidationError("Integration status is required", { status: ["required"] });
  assertTransition(status.status, nextStatus);
  const at = new Date(now);
  const patch = { status: nextStatus, updatedAt: at };
  if (nextStatus === INTEGRATION_STATUS.PROCESSING) {
    patch.attemptCount = Number(status.attemptCount || 0) + 1;
    patch.firstAttemptAt = status.firstAttemptAt || at;
    patch.lastAttemptAt = at;
    patch.lastError = null;
    patch.nextRetryAt = null;
  } else if (nextStatus === INTEGRATION_STATUS.SUCCEEDED) {
    patch.succeededAt = at;
    patch.lastError = null;
    patch.nextRetryAt = null;
  } else if (nextStatus === INTEGRATION_STATUS.RETRYABLE_FAILED) {
    patch.lastAttemptAt = at;
    patch.lastError = sanitizeError(error);
    patch.nextRetryAt = retryAvailableAt(at, Number(status.attemptCount || 1));
  }
  await status.update(patch, { transaction });
  return status;
}

module.exports = { INTEGRATION_STATUS, ensureIntegrationStatus, transitionIntegrationStatus, assertTransition };
