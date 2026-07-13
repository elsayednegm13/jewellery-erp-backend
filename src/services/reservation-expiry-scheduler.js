// Phase 32.6-Fix C — reservation automatic-expiry scheduler.
//
// A single lightweight recurring tick that delegates to the reusable
// reservationService.processDueExpirations() operation. There is no grace
// period: a reservation is eligible the moment its exact expiry time passes,
// and the next scheduler cycle processes it. The heavy lifting (row locking
// via FOR UPDATE SKIP LOCKED, cancellation reuse, asset release, audit) lives
// in the service so deterministic verification can call it directly without
// waiting for the timer.
//
// The scheduler is intentionally isolated in test/verifier mode so automated
// runs never mutate real records on a timer.

const reservationService = require("./reservation.service");
const logger = require("../utils/logger");

let timer = null;

function schedulerDisabled() {
  if (String(process.env.DISABLE_RESERVATION_EXPIRY_SCHEDULER || "").toLowerCase() === "true") return true;
  if (String(process.env.NODE_ENV || "").toLowerCase() === "test") return true;
  // Never auto-run the scheduler while a gated live verifier drives expiry itself.
  if (String(process.env.VERIFY_RESERVATION_LIFECYCLE_LIVE || "").toLowerCase() === "true") return true;
  return false;
}

function intervalMs() {
  const raw = Number(process.env.RESERVATION_EXPIRY_INTERVAL_MS);
  if (Number.isFinite(raw) && raw >= 5000) return raw;
  return 60000;
}

async function runTick() {
  try {
    const summary = await reservationService.processDueExpirations({ limit: 100 });
    if (summary.processed > 0 || summary.failed > 0) {
      logger.info(`[ReservationExpiry] tick processed=${summary.processed} skipped=${summary.skipped} failed=${summary.failed}`);
    }
  } catch (error) {
    logger.error(`[ReservationExpiry] scheduler tick failed: ${error.message}`);
  }
  // Approaching-expiry notifications: warn users about reservations nearing expiry.
  try {
    const approaching = await reservationService.processApproachingExpiryNotifications({ limit: 200 });
    if (approaching.notified > 0 || approaching.failed > 0) {
      logger.info(`[ReservationExpiry] approaching-expiry notified=${approaching.notified} skipped=${approaching.skipped} failed=${approaching.failed}`);
    }
  } catch (error) {
    logger.error(`[ReservationExpiry] approaching-expiry notification tick failed: ${error.message}`);
  }
}

function start() {
  if (timer) return { started: false, reason: "already-running" };
  if (schedulerDisabled()) {
    logger.info("[ReservationExpiry] scheduler disabled for this environment.");
    return { started: false, reason: "disabled" };
  }
  const ms = intervalMs();
  timer = setInterval(runTick, ms);
  // Do not keep the event loop alive solely for this timer.
  if (typeof timer.unref === "function") timer.unref();
  logger.info(`[ReservationExpiry] scheduler started (interval ${ms}ms).`);
  return { started: true, intervalMs: ms };
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
    return true;
  }
  return false;
}

module.exports = { start, stop, runTick };
