"use strict";

const express = require("express");
const { Op } = require("sequelize");
const { authMiddleware } = require("../middleware/auth.middleware");
const { requireBusinessPermission } = require("../middleware/business-permission.middleware");
const models = require("../models");
const idempotencyService = require("../services/idempotency.service");
const inventoryV2Runtime = require("../services/inventory-v2-runtime.service");
const transferPolicy = require("../services/transfer-policy.service");
const notificationService = require("../services/notification.service");
const { emitEntityChanged } = require("../services/realtime-helper.service");
const { AppError, ValidationError, NotFoundError, ConflictError } = require("../utils/errors");

const router = express.Router();
const permissions = transferPolicy.TRANSFER_PERMISSIONS;

function actorName(req) {
  return req.user ? [req.user.firstName, req.user.lastName].filter(Boolean).join(" ") || "System" : "System";
}

function transferId() {
  return "TR-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}

function itemId(transferIdValue, assetId) {
  return "TRI-" + transferIdValue + "-" + assetId;
}

async function readItems(transferIdValue, companyId, transaction, lock = false) {
  const sql = [
    "SELECT id, transfer_id AS \"transferId\", asset_id AS \"assetId\", company_id AS \"companyId\",",
    "from_branch_id AS \"fromBranchId\", to_branch_id AS \"toBranchId\",",
    "from_location_id AS \"fromLocationId\", to_location_id AS \"toLocationId\", status,",
    "dispatched_at AS \"dispatchedAt\", dispatched_by AS \"dispatchedBy\",",
    "received_at AS \"receivedAt\", received_by AS \"receivedBy\",",
    "created_at AS \"createdAt\", updated_at AS \"updatedAt\"",
    "FROM transfer_items WHERE transfer_id=:transferId AND company_id=:companyId",
    "ORDER BY created_at, id" + (lock ? " FOR UPDATE" : ""),
  ].join(" ");
  return models.sequelize.query(sql, {
    replacements: { transferId: transferIdValue, companyId },
    transaction,
    type: models.sequelize.QueryTypes.SELECT,
  });
}

function view(transfer, items) {
  const data = transfer.toJSON ? transfer.toJSON() : { ...transfer };
  return {
    ...data,
    assetIds: items.map((item) => item.assetId),
    fromLocationId: items[0]?.fromLocationId || null,
    toLocationId: items[0]?.toLocationId || null,
    items,
  };
}

function requireBranch(req, expectedBranchId, operation) {
  return transferPolicy.assertTransferBranchContext(req, expectedBranchId, operation);
}

async function claim(req, transaction, scope, body, params = {}) {
  const key = String(req.headers["idempotency-key"] || "").trim();
  if (!key) throw new ValidationError("Idempotency-Key is required for transfer mutations.");
  const requestHash = idempotencyService.hashRequest(scope, body, params);
  const result = await idempotencyService.claim({
    models,
    companyId: req.companyId,
    scope,
    key,
    requestHash,
    transaction,
  });
  if (result.claimed) return { key, claim: result };
  await transaction.rollback();
  const previous = await idempotencyService.resolveExisting({
    models,
    companyId: req.companyId,
    scope,
    key,
    requestHash,
  });
  if (previous.state === "replay") {
    return { replay: true, statusCode: previous.statusCode || 200, response: previous.responseBody };
  }
  throw new ConflictError(previous.message || "Idempotency-Key body conflict.");
}

async function location(id, companyId, branchId, transaction, field) {
  const row = await models.InventoryLocation.findOne({
    where: { id, companyId, branchId, isActive: true },
    transaction,
  });
  if (!row) throw new ValidationError(field + " must be an active DB Location in the selected Branch.");
  return row;
}

async function assertNoActiveTransfer(assetIds, companyId, transaction) {
  const rows = await models.sequelize.query([
    "SELECT asset_id FROM transfer_items",
    "WHERE company_id=:companyId AND asset_id IN (:assetIds)",
    "AND status IN ('PENDING','APPROVED','IN_TRANSIT')",
    "LIMIT 1 FOR UPDATE",
  ].join(" "), {
    replacements: { companyId, assetIds },
    transaction,
    type: models.sequelize.QueryTypes.SELECT,
  });
  if (rows.length) throw new ConflictError("One or more Assets already belong to an active Transfer.");
}

async function assertParity(transfer, items) {
  if (!items.length || items.length !== transfer.assetIds.length) {
    throw new AppError("Transfer item/header Asset parity is invalid.", 409, "TRANSFER_ITEM_HEADER_PARITY_INVALID");
  }
  const ids = new Set(transfer.assetIds.map(String));
  if (items.some((item) => !ids.has(String(item.assetId)))) {
    throw new AppError("Transfer item/header Asset parity is invalid.", 409, "TRANSFER_ITEM_HEADER_PARITY_INVALID");
  }
  if (items.some((item) => !item.fromLocationId || !item.toLocationId)) {
    throw new AppError("Transfer item Location evidence is incomplete.", 409, "TRANSFER_LOCATION_EVIDENCE_INVALID");
  }
}

function lifecycleGuard(req, res, next) {
  const permissionByStatus = {
    approved: permissions.approve,
    "in-transit": permissions.dispatch,
    received: permissions.receive,
    cancelled: permissions.cancel,
  };
  const permission = permissionByStatus[String(req.body?.status || "")];
  if (!permission) return next(new ValidationError("A valid transfer lifecycle status is required."));
  return requireBusinessPermission(permission, { touch: true })(req, res, next);
}

router.get("/", authMiddleware, requireBusinessPermission(permissions.read), async (req, res, next) => {
  try {
    requireBranch(req, req.branchId, "read");
    const rows = await models.Transfer.findAll({
      where: {
        companyId: req.companyId,
        [Op.or]: [{ fromBranchId: req.branchId }, { toBranchId: req.branchId }],
      },
      order: [["createdAt", "DESC"]],
    });
    const itemRows = await Promise.all(rows.map((row) => readItems(row.id, req.companyId)));
    return res.status(200).json({ success: true, data: { items: rows.map((row, index) => view(row, itemRows[index])) } });
  } catch (error) {
    return next(error);
  }
});

router.get("/:id", authMiddleware, requireBusinessPermission(permissions.read), async (req, res, next) => {
  try {
    requireBranch(req, req.branchId, "read");
    const row = await models.Transfer.findOne({ where: { id: req.params.id, companyId: req.companyId } });
    if (!row) throw new NotFoundError("Transfer not found.");
    transferPolicy.assertVisibleTransferBranch(req, row);
    return res.status(200).json({ success: true, data: view(row, await readItems(row.id, req.companyId)) });
  } catch (error) {
    return next(error);
  }
});

router.post("/", authMiddleware, requireBusinessPermission(permissions.create, { touch: true }), async (req, res, next) => {
  let body;
  try {
    body = transferPolicy.normalizeCreateBody(req.body || {});
  } catch (error) {
    return next(error);
  }
  const transaction = await models.sequelize.transaction();
  try {
    requireBranch(req, body.fromBranchId, "create");
    const sourceBranch = await models.Branch.findOne({ where: { id: body.fromBranchId, companyId: req.companyId, isActive: true }, transaction });
    const destinationBranch = await models.Branch.findOne({ where: { id: body.toBranchId, companyId: req.companyId, isActive: true }, transaction });
    if (!sourceBranch || !destinationBranch) throw new ValidationError("Source or destination Branch is invalid or inactive.");
    await location(body.fromLocationId, req.companyId, body.fromBranchId, transaction, "fromLocationId");
    await location(body.toLocationId, req.companyId, body.toBranchId, transaction, "toLocationId");

    const idempotency = await claim(req, transaction, "transfer.create", body);
    if (idempotency.replay) return res.status(idempotency.statusCode).json(idempotency.response);
    await assertNoActiveTransfer(body.assetIds, req.companyId, transaction);

    const assets = await models.Asset.findAll({
      where: {
        id: body.assetIds,
        companyId: req.companyId,
        branchId: body.fromBranchId,
        locationId: body.fromLocationId,
        status: "available",
        operationalStatus: "AVAILABLE",
      },
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (assets.length !== body.assetIds.length) {
      throw new ValidationError("Every selected Asset must be AVAILABLE at the source Branch and source Location.");
    }

    const created = await models.Transfer.create({
      id: transferId(),
      companyId: req.companyId,
      assetIds: body.assetIds,
      fromBranch: sourceBranch.name,
      fromBranchId: body.fromBranchId,
      toBranch: destinationBranch.name,
      toBranchId: body.toBranchId,
      requestedBy: actorName(req),
      requestedAt: new Date().toISOString(),
      status: "pending",
      notes: body.notes,
    }, { transaction });

    for (const asset of assets) {
      await models.sequelize.query([
        "INSERT INTO transfer_items",
        "(id,transfer_id,asset_id,company_id,from_branch_id,to_branch_id,from_location_id,to_location_id,status,created_at,updated_at)",
        "VALUES (:id,:transferId,:assetId,:companyId,:fromBranchId,:toBranchId,:fromLocationId,:toLocationId,'PENDING',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
      ].join(" "), {
        replacements: {
          id: itemId(created.id, asset.id),
          transferId: created.id,
          assetId: asset.id,
          companyId: req.companyId,
          fromBranchId: body.fromBranchId,
          toBranchId: body.toBranchId,
          fromLocationId: body.fromLocationId,
          toLocationId: body.toLocationId,
        },
        transaction,
      });
      await inventoryV2Runtime.transitionAsset({
        models,
        transaction,
        asset,
        context: { companyId: req.companyId, branchId: body.fromBranchId, branchName: sourceBranch.name, actorId: req.user?.id || null, actorName: actorName(req), occurredAt: new Date() },
        toStatus: "PENDING_TRANSFER",
        eventType: "TRANSFER_REQUEST",
        movementType: "TRANSFER_REQUEST",
        sourceType: "TRANSFER",
        sourceId: created.id,
        note: "Transfer requested to " + destinationBranch.name,
        idempotencyKey: idempotency.key + ":" + asset.id,
      });
    }

    const response = { success: true, replayed: false, ...view(created, await readItems(created.id, req.companyId, transaction)) };
    await idempotencyService.succeed({ request: idempotency.claim.request, statusCode: 201, responseBody: response, transaction });
    await transaction.commit();
    emitEntityChanged(req.companyId, { entity: "Transfer", action: "create", id: created.id, branchId: body.fromBranchId, related: { transferId: created.id, assetIds: body.assetIds } });
    await notificationService.createNotification(req.companyId, { title: "طلب تحويل مخزني جديد", message: "تم إنشاء طلب تحويل مخزني جديد.", type: "info", entityType: "Transfer", entityId: created.id });
    return res.status(201).json(response);
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    return next(error);
  }
});

router.patch("/:id", authMiddleware, lifecycleGuard, async (req, res, next) => {
  let body;
  try {
    body = transferPolicy.normalizePatchBody(req.body || {});
  } catch (error) {
    return next(error);
  }
  const scopeByStatus = { approved: "transfer.approve", "in-transit": "transfer.dispatch", received: "transfer.receive", cancelled: "transfer.cancel" };
  const transaction = await models.sequelize.transaction();
  try {
    const idempotency = await claim(req, transaction, scopeByStatus[body.status], body, { transferId: req.params.id });
    if (idempotency.replay) return res.status(idempotency.statusCode).json(idempotency.response);

    const transfer = await models.Transfer.findOne({
      where: { id: req.params.id, companyId: req.companyId },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!transfer) throw new NotFoundError("Transfer not found.");
    const action = transferPolicy.actionForTransition(transfer.status, body.status);
    const requiredBranch = action === "receive" ? transfer.toBranchId : transfer.fromBranchId;
    requireBranch(req, requiredBranch, action);
    const items = await readItems(transfer.id, req.companyId, transaction, true);
    await assertParity(transfer, items);
    if (items.some((item) => item.fromBranchId !== transfer.fromBranchId || item.toBranchId !== transfer.toBranchId)) {
      throw new AppError("Transfer item Branch evidence is inconsistent.", 409, "TRANSFER_BRANCH_EVIDENCE_INVALID");
    }
    const assets = await models.Asset.findAll({ where: { id: items.map((item) => item.assetId), companyId: req.companyId }, lock: transaction.LOCK.UPDATE, transaction });
    if (assets.length !== items.length) throw new AppError("Transfer Asset evidence is incomplete.", 409, "TRANSFER_ASSET_EVIDENCE_INVALID");
    const assetById = new Map(assets.map((asset) => [asset.id, asset]));
    const actor = actorName(req);
    const now = new Date();

    if (action === "approve") {
      await transfer.update({ status: "approved", approvedBy: actor, approvedAt: now.toISOString() }, { transaction });
      await models.sequelize.query("UPDATE transfer_items SET status='APPROVED',updated_at=CURRENT_TIMESTAMP WHERE transfer_id=:transferId", { replacements: { transferId: transfer.id }, transaction });
    } else if (action === "dispatch") {
      await transfer.update({ status: "in-transit" }, { transaction });
      for (const item of items) {
        const asset = assetById.get(item.assetId);
        if (!asset || asset.operationalStatus !== "PENDING_TRANSFER" || asset.branchId !== transfer.fromBranchId || asset.locationId !== item.fromLocationId) throw new ConflictError("Asset is not at the transfer source state.");
        const event = await inventoryV2Runtime.recordAssetEvent({
          models,
          transaction,
          asset: asset.toJSON(),
          context: { companyId: req.companyId, branchId: transfer.fromBranchId, branchName: transfer.fromBranch, actorId: req.user?.id || null, actorName: actor, occurredAt: now },
          eventType: "TRANSFER_OUT",
          oldStatus: "PENDING_TRANSFER",
          newStatus: "PENDING_TRANSFER",
          sourceType: "TRANSFER",
          sourceId: transfer.id,
          note: "Transfer dispatched to " + transfer.toBranch,
          idempotencyKey: idempotency.key + ":" + asset.id,
          oldContextExtra: { branchId: transfer.fromBranchId, locationId: item.fromLocationId },
          newContextExtra: { branchId: transfer.toBranchId, locationId: item.toLocationId },
        });
        await inventoryV2Runtime.recordMovement({
          models,
          transaction,
          asset: asset.toJSON(),
          context: { companyId: req.companyId, actorId: req.user?.id || null, occurredAt: now },
          movementType: "TRANSFER_OUT",
          sourceType: "TRANSFER",
          sourceId: transfer.id,
          eventId: event.id,
          fromBranchId: transfer.fromBranchId,
          toBranchId: transfer.toBranchId,
          fromLocationId: item.fromLocationId,
          toLocationId: item.toLocationId,
        });
      }
      await models.sequelize.query("UPDATE transfer_items SET status='IN_TRANSIT',dispatched_at=:now,dispatched_by=:actor,updated_at=CURRENT_TIMESTAMP WHERE transfer_id=:transferId", { replacements: { now, actor, transferId: transfer.id }, transaction });
    } else if (action === "receive") {
      await transfer.update({ status: "received", receivedBy: actor, receivedAt: now.toISOString() }, { transaction });
      for (const item of items) {
        const asset = assetById.get(item.assetId);
        if (!asset || asset.operationalStatus !== "PENDING_TRANSFER" || asset.branchId !== transfer.fromBranchId || asset.locationId !== item.fromLocationId) throw new ConflictError("Asset is not at the transfer source state.");
        await inventoryV2Runtime.transitionAsset({
          models,
          transaction,
          asset,
          context: { companyId: req.companyId, branchId: transfer.toBranchId, branchName: transfer.toBranch, actorId: req.user?.id || null, actorName: actor, occurredAt: now },
          toStatus: "AVAILABLE",
          eventType: "TRANSFER_IN",
          movementType: "TRANSFER_IN",
          sourceType: "TRANSFER",
          sourceId: transfer.id,
          note: "Transfer received in " + transfer.toBranch,
          idempotencyKey: idempotency.key + ":" + asset.id,
          toBranchId: transfer.toBranchId,
          toLocationId: item.toLocationId,
        });
        await asset.update({ branch: transfer.toBranch }, { transaction });
      }
      await models.sequelize.query("UPDATE transfer_items SET status='RECEIVED',received_at=:now,received_by=:actor,updated_at=CURRENT_TIMESTAMP WHERE transfer_id=:transferId", { replacements: { now, actor, transferId: transfer.id }, transaction });
    } else if (action === "cancel") {
      await transfer.update({ status: "cancelled", cancelReason: body.cancelReason || "Cancelled by user" }, { transaction });
      for (const item of items) {
        const asset = assetById.get(item.assetId);
        if (!asset || asset.operationalStatus !== "PENDING_TRANSFER" || asset.branchId !== transfer.fromBranchId || asset.locationId !== item.fromLocationId) throw new ConflictError("Asset is not at the transfer source state.");
        await inventoryV2Runtime.transitionAsset({
          models,
          transaction,
          asset,
          context: { companyId: req.companyId, branchId: transfer.fromBranchId, branchName: transfer.fromBranch, actorId: req.user?.id || null, actorName: actor, occurredAt: now },
          toStatus: "AVAILABLE",
          eventType: "TRANSFER_CANCELLED",
          movementType: "TRANSFER_CANCEL",
          sourceType: "TRANSFER",
          sourceId: transfer.id,
          note: "Transfer cancelled: " + (body.cancelReason || "Cancelled by user"),
          idempotencyKey: idempotency.key + ":" + asset.id,
        });
      }
      await models.sequelize.query("UPDATE transfer_items SET status='CANCELLED',updated_at=CURRENT_TIMESTAMP WHERE transfer_id=:transferId", { replacements: { transferId: transfer.id }, transaction });
    }

    const response = { success: true, replayed: false, ...view(transfer, await readItems(transfer.id, req.companyId, transaction)) };
    await idempotencyService.succeed({ request: idempotency.claim.request, statusCode: 200, responseBody: response, transaction });
    await transaction.commit();
    emitEntityChanged(req.companyId, { entity: "Transfer", action: body.status, id: transfer.id, branchId: requiredBranch, related: { transferId: transfer.id, assetIds: transfer.assetIds || [] } });
    await notificationService.createNotification(req.companyId, { title: "تحديث حالة التحويل رقم " + transfer.id, message: "تم تغيير حالة التحويل المخزني إلى: " + body.status, type: "info", entityType: "Transfer", entityId: transfer.id });
    return res.status(200).json(response);
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    return next(error);
  }
});

module.exports = router;
