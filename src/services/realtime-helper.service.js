const eventsService = require("./events.service");

function normalizePayload(companyId, payload = {}) {
  return {
    type: "entity.changed",
    companyId,
    entity: payload.entity,
    action: payload.action || "update",
    id: payload.id || null,
    branchId: payload.branchId || null,
    related: payload.related || {}
  };
}

function emitEntityChanged(companyId, payload = {}) {
  if (!companyId || !payload.entity) return;
  eventsService.emitNamed(companyId, "entity.changed", normalizePayload(companyId, payload));
}

module.exports = { emitEntityChanged, normalizePayload };
