const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const runtime = fs.readFileSync(path.join(root, "src/services/cgp-runtime-dispatcher.service.js"), "utf8");
const outbox = fs.readFileSync(path.join(root, "src/services/outbox.service.js"), "utf8");
const server = fs.readFileSync(path.join(root, "src/server.js"), "utf8");

function must(pattern, label) {
  if (!pattern.test(runtime) && !pattern.test(outbox) && !pattern.test(server)) {
    throw new Error(`missing ${label}`);
  }
}

must(/CustomerGoldPurchasePostedEvent/, "explicit CGP event type");
must(/CGP_RUNTIME_DISPATCH_MIN_CREATED_AT/, "activation watermark");
must(/enabled:\s*false/, "default disabled configuration");
must(/created_at\s*>=\s*:minCreatedAt/, "watermark claim filter");
must(/FOR\s+UPDATE\s+SKIP\s+LOCKED/i, "atomic skip-locked claim");
must(/eventVersion:\s*EVENT_VERSION/, "explicit event version registry");
must(/inventory\.consumePostedEvent[\s\S]*accounting\.consumePostedEvent[\s\S]*goldCenter\.consumePostedEvent[\s\S]*availability\.evaluateAvailability[\s\S]*crm\.consumePostedEvent/, "canonical consumer order");
if (/\bprocessEveryEvent\b|\bGLOBAL_DISPATCH_ENABLED\s*=\s*true\b/.test(server)) throw new Error("generic global dispatcher enabled");
if (/outbox-dispatcher\.service\.start\s*\(/.test(server)) throw new Error("generic outbox dispatcher started by server");
if (/event[_-]?id\s*[:=]\s*\[[^\]]+\]/i.test(runtime)) throw new Error("backlog event IDs hardcoded");
if (/handlerName|payload\.(?:handler|consumer)/i.test(runtime)) throw new Error("client-controlled handler selection");
if (/watermark\s*[:=]\s*new Date\(\)/.test(runtime)) throw new Error("watermark derived from process start");

console.log("CGP_RUNTIME_DISPATCHER_STATIC_VERIFIER: PASS");
