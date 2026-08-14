const TTL_MS = 30 * 60 * 1000;
const mailbox = new Map();

function writeLocalDelivery(event) {
  if (process.env.NODE_ENV === "production") return null;
  const now = new Date();
  const payload = {
    id: event.id,
    kind: event.kind,
    email: event.email,
    userId: event.userId,
    token: event.token,
    createdAt: now.toISOString(),
    expiresAt: event.expiresAt
  };
  mailbox.set(event.id, payload);
  cleanupExpired();
  return { transport: "memory", id: event.id, expiresAt: event.expiresAt };
}

function cleanupExpired() {
  const now = Date.now();
  for (const [id, event] of mailbox.entries()) {
    const expiresAt = event.expiresAt ? new Date(event.expiresAt).getTime() : event.createdAt ? new Date(event.createdAt).getTime() + TTL_MS : now;
    if (!Number.isFinite(expiresAt) || expiresAt <= now) mailbox.delete(id);
  }
}

function listLocalDeliveries() {
  if (process.env.NODE_ENV === "production") return [];
  cleanupExpired();
  return [...mailbox.values()].map((event) => ({ ...event }));
}

function clearLocalDeliveries() {
  mailbox.clear();
}

module.exports = { writeLocalDelivery, listLocalDeliveries, clearLocalDeliveries };
