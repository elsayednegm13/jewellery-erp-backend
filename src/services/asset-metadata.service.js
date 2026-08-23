"use strict";

const auditService = require("./audit.service");
const commandActorContext = require("./command-actor-context.service");
const idempotencyService = require("./idempotency.service");
const { ValidationError, ConflictError } = require("../utils/errors");

const ALLOWLIST = Object.freeze(["name", "description", "category", "brand", "notes", "location"]);

function normalize(body = {}) {
  const unknown = Object.keys(body).filter((key) => key !== "expectedUpdatedAt" && !ALLOWLIST.includes(key));
  if (unknown.length) throw new ValidationError("حقول بيانات الأصل غير مسموحة.", { fields: unknown });
  const updates = {};
  for (const key of ALLOWLIST) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    const value = body[key] === null ? null : String(body[key]).trim();
    if (["name", "category"].includes(key) && !value) throw new ValidationError("اسم الأصل وتصنيفه مطلوبان.");
    const max = ["description", "notes"].includes(key) ? 4000 : 160;
    if (value && value.length > max) throw new ValidationError("بيانات الأصل أطول من الحد المسموح.");
    // Asset.location is a non-null descriptive column in the current model;
    // preserve the empty-string representation used by existing assets.
    updates[key] = value || (key === "location" ? "" : null);
  }
  return updates;
}

async function update({ models, asset, body, req, transaction }) {
  const updates = normalize(body);
  if (!body.expectedUpdatedAt) throw new ValidationError("expectedUpdatedAt مطلوب لحماية التعديل المتزامن.");
  if (new Date(body.expectedUpdatedAt).getTime() !== new Date(asset.updatedAt).getTime()) throw new ConflictError("تم تحديث الأصل؛ أعد تحميل البيانات قبل الحفظ.");
  const before = Object.fromEntries(ALLOWLIST.map((key) => [key, asset[key]]));
  const changed = Object.keys(updates).some((key) => String(before[key] ?? "") !== String(updates[key] ?? ""));
  if (changed) {
    updates.updatedBy = req.user?.id || null;
    await asset.update(updates, { transaction });
    const after = Object.fromEntries(ALLOWLIST.map((key) => [key, asset[key]]));
    await auditService.record(req.companyId, commandActorContext.attachAuditActor(req, {
      action: "inventory_v2.asset_metadata_updated",
      description: "Metadata updated for Asset " + asset.id,
      sourceDocument: asset.id, branch: asset.branch,
      before: JSON.stringify(before), after: JSON.stringify(after),
    }, { requiredPermission: "inventory.adjust", requestedOperation: "inventory_v2.asset_metadata_update", authorizationResult: "allowed" }), { transaction });
  }
  return { changed, before, asset: asset.toJSON() };
}

module.exports = { ALLOWLIST, normalize, update, idempotencyService };
