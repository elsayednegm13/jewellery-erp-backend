const crypto = require("crypto");
const models = require("../models");
const { ValidationError } = require("../utils/errors");

const SERVER_CONTROLLED_CONSUMERS = Object.freeze([
  "INVENTORY",
  "ACCOUNTING",
  "GOLD_CENTER",
  "AUDIT_DURABILITY",
  "CRM",
  "GOLD_CENTER_READ_PROJECTION",
  "AUDIT_READ_INDEX",
]);

function requireTransaction(transaction) {
  if (!transaction) throw new ValidationError("Processed event operation requires a caller transaction", { transaction: ["required"] });
  return transaction;
}

function requireConsumer(consumerName) {
  const value = String(consumerName || "").trim();
  if (!SERVER_CONTROLLED_CONSUMERS.includes(value)) {
    throw new ValidationError("consumerName is not server-controlled", { consumerName: ["unsupported_consumer"] });
  }
  return value;
}

function requireEvent(event) {
  if (!event?.eventId || !event?.eventType || !event?.eventVersion || !event?.correlationId) {
    throw new ValidationError("Processed event receipt requires canonical event metadata", { event: ["metadata_required"] });
  }
  return event;
}

async function recordProcessedEvent({ transaction, consumerName, event, model = models.ProcessedEvent } = {}) {
  requireTransaction(transaction);
  const consumer = requireConsumer(consumerName);
  const source = requireEvent(event);
  const existing = await model.findOne({ where: { consumerName: consumer, eventId: source.eventId }, transaction });
  if (existing) return { claimed: false, receipt: existing };

  // A savepoint contains a unique-race error so the caller's transaction can
  // safely become a duplicate no-op instead of becoming poisoned by PostgreSQL.
  const savepoint = await transaction.sequelize.transaction({ transaction });
  try {
    const receipt = await model.create({
      id: `PEV:${crypto.randomUUID()}`,
      consumerName: consumer,
      eventId: source.eventId,
      eventType: source.eventType,
      eventVersion: Number(source.eventVersion),
      status: "SUCCEEDED",
      correlationId: source.correlationId,
      processedAt: new Date(),
    }, { transaction: savepoint });
    await savepoint.commit();
    return { claimed: true, receipt };
  } catch (error) {
    await savepoint.rollback();
    if (error?.name === "SequelizeUniqueConstraintError") return { claimed: false, receipt: null };
    throw error;
  }
}

async function consumeExactlyOnce({ transaction, consumerName, event, effect } = {}) {
  const claim = await recordProcessedEvent({ transaction, consumerName, event });
  if (!claim.claimed) return { processed: false, receipt: claim.receipt };
  if (typeof effect !== "function") throw new ValidationError("Consumer effect must be a function", { effect: ["required"] });
  // The receipt and effect share the same outer transaction; either both
  // commit or both disappear on rollback.
  await effect();
  return { processed: true, receipt: claim.receipt };
}

module.exports = { SERVER_CONTROLLED_CONSUMERS, recordProcessedEvent, consumeExactlyOnce };
