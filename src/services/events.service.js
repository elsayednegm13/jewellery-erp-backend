const logger = require("../utils/logger");

/**
 * Realtime events service (Server-Sent Events).
 *
 * Holds the set of connected SSE clients and broadcasts mutation events to the
 * clients that belong to the same company. The frontend listens and refreshes
 * its data automatically — no manual refresh needed.
 */
const clients = new Map(); // id -> { res, companyId }
let nextId = 1;

function addClient(companyId, res) {
  const id = nextId++;
  clients.set(id, { res, companyId });
  logger.info(`[SSE] client ${id} connected (company ${companyId}). Total: ${clients.size}`);
  return id;
}

function removeClient(id) {
  if (clients.delete(id)) {
    logger.info(`[SSE] client ${id} disconnected. Total: ${clients.size}`);
  }
}

/**
 * Broadcast an event to every client of a company.
 * @param {string} companyId
 * @param {string} resource  e.g. "Asset", "Invoice", "Payslip"
 * @param {string} action    e.g. "create" | "update" | "delete"
 * @param {object} payload   extra fields (id, etc.)
 */
function emit(companyId, resource, action, payload = {}) {
  if (clients.size === 0) return;

  // 1. Map generic resource names to standard entity names
  let entity = resource;
  if (resource === "CustomerGoldPool") entity = "Invoice";
  if (resource === "Setting") entity = "Settings";
  if (resource === "StockAudit") entity = "Asset";

  // 2. Map actions to standard actions
  let stdAction = action;
  if (action === "deposit") stdAction = "create";
  if (action === "use-in-sale") stdAction = "update";
  if (action === "return") stdAction = "cancel";
  if (action === "exchange") stdAction = "cancel";
  if (action === "complete" || action === "process" || action === "changed") stdAction = "update";

  const body = JSON.stringify({
    type: "entity.changed",
    entity,
    action: stdAction,
    id: payload.id || (payload.ids && payload.ids[0]) || null,
    companyId,
    branchId: payload.branchId || null,
    related: payload.related || {},
    ts: Date.now()
  });

  for (const { res, companyId: cid } of clients.values()) {
    if (cid && companyId && cid !== companyId) continue;
    try {
      res.write(`event: change\ndata: ${body}\n\n`);
    } catch (err) {
      logger.warn(`[SSE] write failed: ${err.message}`);
    }
  }
}

function emitNamed(companyId, eventName, payload = {}) {
  if (clients.size === 0) return;
  const body = JSON.stringify({ ...payload, ts: Date.now() });
  for (const { res, companyId: cid } of clients.values()) {
    if (cid && companyId && cid !== companyId) continue;
    try {
      res.write(`event: ${eventName}\ndata: ${body}\n\n`);
    } catch (err) {
      logger.warn(`[SSE] write failed: ${err.message}`);
    }
  }
}

function clientCount() {
  return clients.size;
}

module.exports = { addClient, removeClient, emit, emitNamed, clientCount };
