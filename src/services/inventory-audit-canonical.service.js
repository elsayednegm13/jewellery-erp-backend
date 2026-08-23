"use strict";

const { Op } = require("sequelize");
const { ValidationError, NotFoundError, ConflictError } = require("../utils/errors");
const inventoryV2Runtime = require("./inventory-v2-runtime.service");

const METHODS = new Set(["MANUAL_COUNT", "BARCODE_SCAN", "RFID_SCAN"]);

function requireMethod(value) {
  const method = String(value || "").trim().toUpperCase();
  if (!METHODS.has(method)) throw new ValidationError("Inventory audit method is invalid.");
  return method;
}

async function findScopedAudit({ models, companyId, branchId, auditId, transaction }) {
  const audit = await models.StockAudit.findOne({
    where: { id: auditId, companyId, branchId },
    transaction,
    lock: true,
  });
  if (!audit) throw new NotFoundError("Inventory audit not found.");
  return audit;
}

async function createAudit({ models, companyId, branchId, auditNumber, auditMethod, locationId, notes = null, actor = {}, transaction, recordAudit = null }) {
  const number = String(auditNumber || "").trim();
  if (!number) throw new ValidationError("Inventory auditNumber is required for durable replay.");
  const method = requireMethod(auditMethod);
  const existing = await models.StockAudit.findOne({ where: { companyId, auditNumber: number }, transaction, lock: true });
  if (existing) {
    if (existing.branchId !== branchId || existing.auditMethod !== method || String(existing.locationId || "") !== String(locationId || "")) throw new ConflictError("Audit number body conflict.");
    return { audit: existing, replayed: true };
  }
  if (!locationId) throw new ValidationError("Inventory Count location is required.");
  const active = await models.StockAudit.findOne({
    where: { companyId, branchId, locationId, status: { [Op.in]: ["draft", "in-progress"] } },
    transaction,
    lock: true,
  });
  if (active) throw new ConflictError("An active Inventory Count already exists for this location.");
  const audit = await models.StockAudit.create({
    id: inventoryV2Runtime.newId("IMAUD"), companyId, branchId, status: "draft",
    createdBy: actor.id || actor.name || null, auditNumber: number,
    auditDate: new Date().toISOString().slice(0, 10), auditMethod: method,
    locationId, notes,
  }, { transaction });
  if (recordAudit) await recordAudit(audit, method);
  return { audit, replayed: false };
}

async function startAudit({ models, companyId, branchId, auditId, transaction }) {
  const audit = await findScopedAudit({ models, companyId, branchId, auditId, transaction });
  if (audit.status === "in-progress") return { audit, replayed: true, expectedCount: await models.StockAuditItem.count({ where: { stockAuditId: audit.id }, transaction }) };
  if (audit.status !== "draft") throw new ConflictError("Only a DRAFT audit can start.");
  const assets = await models.Asset.findAll({
    where: { companyId, branchId, locationId: audit.locationId, operationalStatus: { [Op.notIn]: ["SOLD", "MELTED", "MISSING"] } },
    transaction,
    order: [["id", "ASC"]],
  });
  for (const asset of assets) {
    await models.StockAuditItem.create({
      id: inventoryV2Runtime.newId("IMAUDITEM"), stockAuditId: audit.id, assetId: asset.id,
      expectedBranchId: branchId, status: "missing", result: null,
    }, { transaction });
  }
  await audit.update({ status: "in-progress" }, { transaction });
  return { audit, replayed: false, expectedCount: assets.length };
}

async function observeAudit({ models, companyId, branchId, auditId, assetIds = [], barcodes = [], rfidNumbers = [], method = null, transaction }) {
  const audit = await findScopedAudit({ models, companyId, branchId, auditId, transaction });
  if (audit.status !== "in-progress") throw new ConflictError("Only an IN_PROGRESS audit can accept observations.");
  const requested = [...new Set([...assetIds, ...barcodes, ...rfidNumbers].map((value) => String(value || "").trim()).filter(Boolean))];
  if (!requested.length) throw new ValidationError("At least one Asset ID, barcode, or RFID number is required.");
  const scanMethod = requireMethod(method || audit.auditMethod);
  const assets = await models.Asset.findAll({
    where: { companyId, [Op.or]: [{ id: requested }, { barcode: requested }, { rfid: requested }] },
    transaction,
    lock: true,
  });
  const identifierMatches = new Set(assets.flatMap((asset) => [asset.id, asset.barcode, asset.rfid].filter(Boolean).map(String)));
  const unknown = requested.find((identifier) => !identifierMatches.has(identifier));
  if (unknown) throw new ValidationError(`Scanned Asset identity was not found: ${unknown}`);
  const byId = new Map(assets.map((asset) => [String(asset.id), asset]));
  const scopedAssets = [];
  for (const asset of assets) {
    if (["SOLD", "MELTED", "MISSING"].includes(String(asset.operationalStatus || "").toUpperCase())) throw new ConflictError("Scanned Asset is not count-eligible.");
    if (String(asset.branchId) !== String(branchId) || String(asset.locationId || "") !== String(audit.locationId || "")) throw new ConflictError("Scanned Asset is outside the Count location scope.");
    if (!byId.has(String(asset.id))) throw new ValidationError("Scanned Asset identity is invalid.");
    scopedAssets.push(asset);
  }
  if (!scopedAssets.length) throw new ValidationError("No scanned Inventory Asset was found.");
  const observed = [];
  for (const asset of scopedAssets) {
    const expected = await models.StockAuditItem.findOne({ where: { stockAuditId: audit.id, assetId: asset.id }, transaction, lock: true });
    if (!expected) throw new ConflictError("Scanned Asset is not part of the frozen expected set.");
    const replayed = expected.status === "matched" && expected.result === "MATCHED";
    await expected.update({ status: "matched", result: "MATCHED", observedAt: new Date(), scanMethod, scannedBranchId: branchId }, { transaction });
    observed.push({ assetId: asset.id, result: "MATCHED", replayed });
  }
  return { audit, observed };
}

async function completeAudit({ models, companyId, branchId, auditId, transaction }) {
  const audit = await findScopedAudit({ models, companyId, branchId, auditId, transaction });
  if (audit.status === "completed") return { audit, replayed: true };
  if (audit.status !== "in-progress") throw new ConflictError("Only an IN_PROGRESS audit can complete.");
  await models.StockAuditItem.update({ status: "missing", result: "MISSING", observedAt: new Date() }, { where: { stockAuditId: audit.id, result: null }, transaction });
  await audit.update({ status: "completed", completedAt: new Date().toISOString() }, { transaction });
  return { audit, replayed: false };
}

async function closeAudit({ models, companyId, branchId, auditId, actor = {}, transaction }) {
  const audit = await findScopedAudit({ models, companyId, branchId, auditId, transaction });
  if (audit.status === "closed") return { audit, replayed: true };
  if (audit.status !== "completed") throw new ConflictError("Only a COMPLETED audit can close.");
  await audit.update({ status: "closed", closedAt: new Date(), closedBy: actor.id || null }, { transaction });
  return { audit, replayed: false };
}

module.exports = { createAudit, startAudit, observeAudit, completeAudit, closeAudit };
