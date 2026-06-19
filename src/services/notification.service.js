const { Notification } = require("../models");
const eventsService = require("./events.service");
const { emitEntityChanged } = require("./realtime-helper.service");

async function createNotification(companyId, payload, opts = {}) {
  const notification = await Notification.create({
    id: `NOTIF-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    companyId,
    userId: payload.userId || null,
    roleId: payload.roleId || null,
    title: payload.title,
    message: payload.message,
    type: payload.type || "info",
    entityType: payload.entityType || null,
    entityId: payload.entityId || null,
    isRead: false
  }, { transaction: opts.transaction });
  if (opts.transaction) {
    opts.transaction.afterCommit(() => {
      emitEntityChanged(companyId, { entity: "Notification", action: "create", id: notification.id });
      eventsService.emitNamed(companyId, "notification", notification.toJSON());
    });
  } else {
    emitEntityChanged(companyId, { entity: "Notification", action: "create", id: notification.id });
    eventsService.emitNamed(companyId, "notification", notification.toJSON());
  }
  return notification;
}

module.exports = { createNotification };
