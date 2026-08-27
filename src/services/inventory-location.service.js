const { randomUUID } = require("crypto");
const { Op } = require("sequelize");
const models = require("../models");
const auditService = require("./audit.service");
const { AppError, ValidationError, NotFoundError, ConflictError } = require("../utils/errors");

function normalizeName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizedNameKey(value) {
  return normalizeName(value).toLocaleLowerCase();
}

function normalizeCode(value) {
  return String(value || "").trim().replace(/\s+/g, "-");
}

function normalizeType(value) {
  return String(value || "GENERAL").trim().toUpperCase() || "GENERAL";
}

function serialize(row) {
  if (!row) return null;
  return {
    id: row.id,
    companyId: row.companyId,
    branchId: row.branchId,
    code: row.code,
    name: row.name,
    locationType: row.locationType,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function actorName(user) {
  return [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.email || "Authenticated user";
}

async function requireBranch(companyId, branchId, transaction) {
  if (!companyId) throw new AppError("A company context is required.", 422, "COMPANY_CONTEXT_REQUIRED");
  if (!branchId) throw new AppError("A branch context is required.", 422, "BRANCH_CONTEXT_REQUIRED");
  const branch = await models.Branch.findOne({
    where: { id: branchId, companyId, isActive: true },
    attributes: ["id", "companyId", "name", "isActive"],
    transaction,
  });
  if (!branch) throw new AppError("The selected branch is invalid or outside the company scope.", 403, "BRANCH_SCOPE_INVALID");
  return branch;
}

async function assertNoScopeOverride(payload) {
  if (Object.prototype.hasOwnProperty.call(payload || {}, "companyId") || Object.prototype.hasOwnProperty.call(payload || {}, "branchId")) {
    throw new AppError("Company and branch scope are server-authoritative.", 422, "LOCATION_SCOPE_IMMUTABLE");
  }
}

async function findScoped(id, companyId, branchId, transaction, includeDisabled = true) {
  return models.InventoryLocation.findOne({
    where: { id, companyId, branchId, ...(includeDisabled ? {} : { isActive: true }) },
    transaction,
  });
}

async function assertNoActiveDuplicate({ companyId, branchId, name, code, exceptId, transaction }) {
  const rows = await models.InventoryLocation.findAll({
    where: { companyId, branchId, isActive: true, ...(exceptId ? { id: { [Op.ne]: exceptId } } : {}) },
    transaction,
  });
  const key = normalizedNameKey(name);
  if (rows.some((row) => normalizedNameKey(row.name) === key)) {
    throw new ConflictError("An active location with the same normalized name already exists.");
  }
  if (rows.some((row) => String(row.code).toLocaleLowerCase() === String(code).toLocaleLowerCase())) {
    throw new ConflictError("An active location with the same code already exists.");
  }
}

async function create({ companyId, branchId, payload, user, requestId }) {
  await assertNoScopeOverride(payload);
  return models.sequelize.transaction(async (transaction) => {
    const branch = await requireBranch(companyId, branchId, transaction);
    const name = normalizeName(payload?.name);
    const code = normalizeCode(payload?.code);
    if (!name) throw new ValidationError("Location name is required.", { name: ["Location name is required."] });
    if (!code) throw new ValidationError("Location code is required.", { code: ["Location code is required."] });
    if (code.length > 32) throw new ValidationError("Location code is too long.", { code: ["Maximum length is 32."] });
    if (name.length > 120) throw new ValidationError("Location name is too long.", { name: ["Maximum length is 120."] });
    await assertNoActiveDuplicate({ companyId, branchId, name, code, transaction });
    const row = await models.InventoryLocation.create({
      id: `LOC-${randomUUID()}`,
      companyId,
      branchId,
      name,
      code,
      locationType: normalizeType(payload?.locationType),
      isActive: true,
    }, { transaction });
    await auditService.record(companyId, {
      action: "location.created",
      description: `Inventory location created: ${row.id}`,
      user: actorName(user),
      userId: user?.id,
      place: branch.name,
      branch: branch.name,
      before: null,
      after: JSON.stringify(serialize(row)),
      correlationId: requestId,
      requestedOperation: "inventory.locations.create",
      authorizationResult: "allowed",
    }, { transaction });
    return serialize(row);
  });
}

async function list({ companyId, branchId, includeDisabled = false }) {
  await requireBranch(companyId, branchId);
  const rows = await models.InventoryLocation.findAll({
    where: { companyId, branchId, ...(includeDisabled ? {} : { isActive: true }) },
    order: [["name", "ASC"], ["id", "ASC"]],
  });
  return rows.map(serialize);
}

async function update({ companyId, branchId, id, payload, user, requestId }) {
  await assertNoScopeOverride(payload);
  return models.sequelize.transaction(async (transaction) => {
    const branch = await requireBranch(companyId, branchId, transaction);
    const row = await findScoped(id, companyId, branchId, transaction);
    if (!row) throw new NotFoundError("Inventory location was not found in the selected branch.");
    const before = serialize(row);
    const name = Object.prototype.hasOwnProperty.call(payload || {}, "name") ? normalizeName(payload.name) : row.name;
    const code = Object.prototype.hasOwnProperty.call(payload || {}, "code") ? normalizeCode(payload.code) : row.code;
    if (!name) throw new ValidationError("Location name is required.", { name: ["Location name is required."] });
    if (!code) throw new ValidationError("Location code is required.", { code: ["Location code is required."] });
    if (name.length > 120) throw new ValidationError("Location name is too long.", { name: ["Maximum length is 120."] });
    if (code.length > 32) throw new ValidationError("Location code is too long.", { code: ["Maximum length is 32."] });
    if (row.isActive) await assertNoActiveDuplicate({ companyId, branchId, name, code, exceptId: row.id, transaction });
    row.name = name;
    row.code = code;
    if (Object.prototype.hasOwnProperty.call(payload || {}, "locationType")) row.locationType = normalizeType(payload.locationType);
    await row.save({ transaction });
    await auditService.record(companyId, {
      action: "location.updated",
      description: `Inventory location updated: ${row.id}`,
      user: actorName(user),
      userId: user?.id,
      place: branch.name,
      branch: branch.name,
      before: JSON.stringify(before),
      after: JSON.stringify(serialize(row)),
      correlationId: requestId,
      requestedOperation: "inventory.locations.update",
      authorizationResult: "allowed",
    }, { transaction });
    return serialize(row);
  });
}

async function disable({ companyId, branchId, id, user, requestId }) {
  return models.sequelize.transaction(async (transaction) => {
    const branch = await requireBranch(companyId, branchId, transaction);
    const row = await findScoped(id, companyId, branchId, transaction);
    if (!row) throw new NotFoundError("Inventory location was not found in the selected branch.");
    if (!row.isActive) return serialize(row);
    const before = serialize(row);
    row.isActive = false;
    await row.save({ transaction });
    await auditService.record(companyId, {
      action: "location.disabled",
      description: `Inventory location disabled: ${row.id}`,
      user: actorName(user),
      userId: user?.id,
      place: branch.name,
      branch: branch.name,
      before: JSON.stringify(before),
      after: JSON.stringify(serialize(row)),
      correlationId: requestId,
      requestedOperation: "inventory.locations.disable",
      authorizationResult: "allowed",
    }, { transaction });
    return serialize(row);
  });
}

module.exports = { normalizeName, normalizedNameKey, create, list, update, disable };
