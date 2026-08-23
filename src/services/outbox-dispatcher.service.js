const { ValidationError } = require("../utils/errors");
const { claimDueEvents, dispatchClaimedEvent, markPublished, markRetryableFailure } = require("./outbox.service");

function createHandlerRegistry() {
  const handlers = Object.create(null);
  return {
    register({ eventType, eventVersion, handler }) {
      if (!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(String(eventType || "")) || !Number.isInteger(Number(eventVersion)) || Number(eventVersion) < 1 || typeof handler !== "function") {
        throw new ValidationError("Invalid durable event handler registration", { handler: ["invalid"] });
      }
      handlers[eventType] ||= Object.create(null);
      if (handlers[eventType][String(eventVersion)]) {
        throw new ValidationError("Durable event handler is already registered", { handler: ["duplicate"] });
      }
      handlers[eventType][String(eventVersion)] = handler;
    },
    snapshot() { return handlers; },
  };
}

async function dispatchClaimedBatch({ transaction, workerId, handlerRegistry, now = new Date(), limit = 25 } = {}) {
  if (!handlerRegistry || typeof handlerRegistry.snapshot !== "function") {
    throw new ValidationError("An explicit handler registry is required", { handlerRegistry: ["required"] });
  }
  const claimed = await claimDueEvents({ transaction, workerId, now, limit });
  const results = [];
  for (const event of claimed) {
    try {
      await dispatchClaimedEvent({ event, handlers: handlerRegistry.snapshot() });
      results.push({ eventId: event.event_id, state: "handled" });
    } catch (error) {
      // This service deliberately leaves transaction ownership and final state
      // transition with the caller; it cannot auto-start or auto-deliver any
      // business workflow during CGP-IMP-02.
      results.push({ eventId: event.event_id, state: "failed", error });
    }
  }
  return results;
}

module.exports = { createHandlerRegistry, dispatchClaimedBatch, markPublished, markRetryableFailure };
