const crypto = require("crypto");
const { QueryTypes } = require("sequelize");
const models = require("../models");
const { AppError, ConflictError, ValidationError } = require("../utils/errors");

const OUTBOX_STATUS = Object.freeze({
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  PUBLISHED: "PUBLISHED",
  RETRYABLE_FAILED: "RETRYABLE_FAILED",
});
const DEFAULT_RETRY_BASE_MS = 1000;
const MAX_ERROR_LENGTH = 500;

function requiredText(value, field, maxLength = 128) {
  const result = String(value || "").trim();
  if (!result || result.length > maxLength) throw new ValidationError(`${field} is required`, { [field]: ["required"] });
  return result;
}

function requiredTransaction(transaction) {
  if (!transaction) throw new ValidationError("Durable event operation requires a caller transaction", { transaction: ["required"] });
  return transaction;
}

function asDate(value, field) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) throw new ValidationError(`${field} is invalid`, { [field]: ["invalid"] });
  return date;
}

function assertSafePayload(value, path = "payload") {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new ValidationError("Outbox payload must be an object", { payload: ["object_required"] });
  }
  for (const [key, nested] of Object.entries(value)) {
    if (/(password|secret|token|authorization|cookie)/i.test(key)) {
      throw new ValidationError("Outbox payload contains a forbidden sensitive field", { [path]: ["sensitive_field_forbidden"] });
    }
    if (nested && typeof nested === "object" && !Array.isArray(nested)) assertSafePayload(nested, `${path}.${key}`);
  }
}

function immutablePayload(payload) {
  assertSafePayload(payload);
  return JSON.parse(JSON.stringify(payload));
}

function sanitizeError(error) {
  const raw = String(error?.message || error || "dispatch failed")
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[redacted-db-url]")
    .replace(/bearer\s+[a-z0-9._~+\/-]+=*/gi, "Bearer [redacted]")
    .replace(/(password|token|secret)\s*[=:]\s*[^\s,;]+/gi, "$1=[redacted]");
  return raw.slice(0, MAX_ERROR_LENGTH);
}

function retryAvailableAt(now, nextAttemptCount) {
  const exponent = Math.min(Math.max(nextAttemptCount - 1, 0), 8);
  return new Date(now.getTime() + (DEFAULT_RETRY_BASE_MS * (2 ** exponent)));
}

function buildOutboxEvent(input = {}) {
  const eventId = requiredText(input.eventId || `EVT:${crypto.randomUUID()}`, "eventId");
  const eventType = requiredText(input.eventType, "eventType");
  if (!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(eventType)) {
    throw new ValidationError("eventType is invalid", { eventType: ["invalid"] });
  }
  const eventVersion = input.eventVersion === undefined ? 1 : Number(input.eventVersion);
  if (!Number.isInteger(eventVersion) || eventVersion < 1) {
    throw new ValidationError("eventVersion is invalid", { eventVersion: ["invalid"] });
  }
  const occurredAt = asDate(input.occurredAt, "occurredAt");
  return {
    id: `OUT:${crypto.randomUUID()}`,
    eventId,
    eventType,
    eventVersion,
    aggregateType: requiredText(input.aggregateType, "aggregateType"),
    aggregateId: requiredText(input.aggregateId, "aggregateId"),
    payload: immutablePayload(input.payload),
    occurredAt,
    availableAt: asDate(input.availableAt || occurredAt, "availableAt"),
    status: OUTBOX_STATUS.PENDING,
    attemptCount: 0,
    correlationId: requiredText(input.correlationId || eventId, "correlationId"),
    causationId: input.causationId ? requiredText(input.causationId, "causationId") : null,
  };
}

async function enqueueEvent({ transaction, event, model = models.OutboxEvent } = {}) {
  requiredTransaction(transaction);
  return model.create(buildOutboxEvent(event), { transaction });
}

async function claimDueEvents({ transaction, workerId, now = new Date(), limit = 25, sequelize = models.sequelize } = {}) {
  requiredTransaction(transaction);
  const claimant = requiredText(workerId, "workerId");
  const batchLimit = Number(limit);
  if (!Number.isInteger(batchLimit) || batchLimit < 1 || batchLimit > 100) {
    throw new ValidationError("limit must be between 1 and 100", { limit: ["out_of_range"] });
  }
  const claimedAt = asDate(now, "now");
  return sequelize.query(`
    WITH candidates AS (
      SELECT id
      FROM outbox_events
      WHERE status IN (:pending, :retryable)
        AND available_at <= :now
      ORDER BY available_at ASC, created_at ASC, id ASC
      LIMIT :limit
      FOR UPDATE SKIP LOCKED
    )
    UPDATE outbox_events AS event
       SET status = :processing,
           claimed_at = :claimedAt,
           claimed_by = :workerId,
           updated_at = :claimedAt
      FROM candidates
     WHERE event.id = candidates.id
    RETURNING event.*
  `, {
    replacements: {
      pending: OUTBOX_STATUS.PENDING,
      retryable: OUTBOX_STATUS.RETRYABLE_FAILED,
      processing: OUTBOX_STATUS.PROCESSING,
      now: claimedAt,
      claimedAt,
      workerId: claimant,
      limit: batchLimit,
    },
    type: QueryTypes.SELECT,
    transaction,
  });
}

async function markPublished({ transaction, eventId, workerId, now = new Date(), sequelize = models.sequelize } = {}) {
  requiredTransaction(transaction);
  const result = await sequelize.query(`
    UPDATE outbox_events
       SET status = :published, published_at = :now, updated_at = :now
     WHERE event_id = :eventId AND status = :processing AND claimed_by = :workerId
    RETURNING *
  `, { replacements: { eventId: requiredText(eventId, "eventId"), workerId: requiredText(workerId, "workerId"), processing: OUTBOX_STATUS.PROCESSING, published: OUTBOX_STATUS.PUBLISHED, now: asDate(now, "now") }, type: QueryTypes.SELECT, transaction });
  if (!result.length) throw new ConflictError("Outbox event is not claimed by this worker");
  return result[0];
}

async function markRetryableFailure({ transaction, eventId, workerId, error, now = new Date(), sequelize = models.sequelize } = {}) {
  requiredTransaction(transaction);
  const event = await sequelize.query(`SELECT attempt_count FROM outbox_events WHERE event_id = :eventId AND status = :processing AND claimed_by = :workerId FOR UPDATE`, {
    replacements: { eventId: requiredText(eventId, "eventId"), workerId: requiredText(workerId, "workerId"), processing: OUTBOX_STATUS.PROCESSING },
    type: QueryTypes.SELECT,
    transaction,
  });
  if (!event.length) throw new ConflictError("Outbox event is not claimed by this worker");
  const failedAt = asDate(now, "now");
  const nextAttemptCount = Number(event[0].attempt_count) + 1;
  const updated = await sequelize.query(`
    UPDATE outbox_events
       SET status = :status, attempt_count = :attemptCount, last_error = :lastError,
           available_at = :availableAt, claimed_at = NULL, claimed_by = NULL, updated_at = :now
     WHERE event_id = :eventId
    RETURNING *
  `, { replacements: { eventId: requiredText(eventId, "eventId"), status: OUTBOX_STATUS.RETRYABLE_FAILED, attemptCount: nextAttemptCount, lastError: sanitizeError(error), availableAt: retryAvailableAt(failedAt, nextAttemptCount), now: failedAt }, type: QueryTypes.SELECT, transaction });
  return updated[0];
}

async function dispatchClaimedEvent({ event, handlers = {} } = {}) {
  if (!event || event.status !== OUTBOX_STATUS.PROCESSING) {
    throw new ValidationError("Only a claimed outbox event can be dispatched", { event: ["not_claimed"] });
  }
  const handler = handlers[event.eventType]?.[String(event.event_version ?? event.eventVersion)] || handlers[event.eventType];
  if (typeof handler !== "function") {
    throw new AppError("No supported handler is registered for this event version", 422, "OUTBOX_EVENT_VERSION_UNSUPPORTED");
  }
  return handler(event);
}

module.exports = {
  OUTBOX_STATUS,
  DEFAULT_RETRY_BASE_MS,
  buildOutboxEvent,
  enqueueEvent,
  claimDueEvents,
  markPublished,
  markRetryableFailure,
  dispatchClaimedEvent,
  sanitizeError,
  retryAvailableAt,
};
