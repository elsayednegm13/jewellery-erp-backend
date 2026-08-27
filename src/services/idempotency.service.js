const crypto = require("crypto");

/**
 * Central idempotency service (Phase 21.3-Fix).
 *
 * Race-safe by construction: `claim` inserts a `processing` row using the UNIQUE
 * (company_id, scope, key) index inside the caller's business transaction. A
 * concurrent duplicate either blocks on the unique key (then replays once the
 * winner commits) or fails the insert (→ caller rolls back and resolves the
 * existing row). Before commit the caller calls `succeed` to store the response
 * for replay; if the business transaction rolls back, the `processing` row is
 * rolled back with it, so a genuine retry can proceed.
 */

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h; supports future TTL cleanup via expires_at

/** Deterministic, key-independent stringify (stable key order). */
function stableStringify(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(value[k])).join(",") + "}";
}

/**
 * sha256 over the canonical { scope, params, body } — excluding the idempotency
 * key itself so the same logical request always hashes the same. A different
 * payload produces a different hash (→ 409 on key reuse).
 */
function hashRequest(scope, body = {}, params = {}) {
  const src = (body && typeof body === "object" && !Array.isArray(body)) ? { ...body } : { value: body };
  delete src.idempotencyKey;
  delete src["idempotency-key"];
  const canonical = stableStringify({ scope, params: params || {}, body: src });
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

/** Attempt to claim the key by inserting a processing row in the caller's tx. */
async function claim({ models, companyId, scope, key, requestHash, transaction, ttlMs = DEFAULT_TTL_MS }) {
  try {
    const request = await models.IdempotencyRequest.create({
      companyId,
      scope,
      key: String(key),
      requestHash,
      status: "processing",
      expiresAt: new Date(Date.now() + ttlMs)
    }, { transaction });
    return { claimed: true, request };
  } catch (err) {
    if (err && err.name === "SequelizeUniqueConstraintError") return { claimed: false };
    throw err;
  }
}

/**
 * Resolve an existing row (fresh query, NO transaction — used after the caller
 * rolls back the aborted claim transaction). Returns the replay/conflict verdict.
 */
async function resolveExisting({ models, companyId, scope, key, requestHash }) {
  const existing = await models.IdempotencyRequest.findOne({ where: { companyId, scope, key: String(key) } });
  if (!existing) {
    return { state: "conflict", statusCode: 409, message: "تعذّر التحقق من مفتاح منع التكرار، حاول بمفتاح جديد" };
  }
  if (existing.requestHash !== requestHash) {
    return { state: "conflict", statusCode: 409, message: "تم استخدام مفتاح منع التكرار (Idempotency-Key) لطلب مختلف" };
  }
  if (existing.status === "succeeded") {
    return { state: "replay", statusCode: existing.statusCode || 200, responseBody: existing.responseBody };
  }
  if (existing.status === "processing") {
    return { state: "processing", statusCode: 409, message: "طلب مطابق قيد المعالجة بالفعل، يرجى الانتظار ثم إعادة المحاولة" };
  }
  return { state: "conflict", statusCode: 409, message: "فشل طلب سابق بنفس المفتاح، استخدم مفتاح منع تكرار جديداً" };
}

/** Mark the claimed row succeeded and store the response for replay (in tx). */
async function succeed({ request, statusCode, responseBody, transaction }) {
  await request.update({ status: "succeeded", statusCode, responseBody }, { transaction });
}

module.exports = { hashRequest, stableStringify, claim, resolveExisting, succeed };
