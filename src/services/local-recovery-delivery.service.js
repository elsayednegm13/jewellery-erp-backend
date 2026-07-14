const fs = require("fs");
const path = require("path");

const sinkPath = path.resolve(__dirname, "../../tmp/local-recovery-delivery.jsonl");

function writeLocalDelivery(event) {
  if (process.env.NODE_ENV === "production") return null;
  fs.mkdirSync(path.dirname(sinkPath), { recursive: true });
  const payload = {
    id: event.id,
    kind: event.kind,
    email: event.email,
    userId: event.userId,
    token: event.token,
    createdAt: new Date().toISOString(),
    expiresAt: event.expiresAt
  };
  fs.appendFileSync(sinkPath, `${JSON.stringify(payload)}\n`);
  return { path: sinkPath, id: event.id };
}

module.exports = { writeLocalDelivery, sinkPath };
