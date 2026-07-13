const { Op } = require("sequelize");
const logger = require("../utils/logger");
const { NotFoundError, ValidationError } = require("../utils/errors");
const { emitEntityChanged } = require("../services/realtime-helper.service");

// Sentinel values used by front-end filter dropdowns to mean "no filter"
// (e.g. an "All" option, or an empty selection). They must never reach the
// SQL where-clause — mirrors the front-end local repository behaviour.
const SENTINEL_FILTER_VALUES = new Set(["all", ""]);

function isSentinelFilterValue(value) {
  return value === undefined || value === null || SENTINEL_FILTER_VALUES.has(value);
}

// Sequelize numeric column types whose where-clauses must receive numbers.
const NUMERIC_TYPE_NAMES = new Set([
  "INTEGER", "BIGINT", "FLOAT", "REAL", "DOUBLE", "DECIMAL", "NUMBER"
]);

// Invoice lifecycle fields. These are owned by the dedicated invoice lifecycle
// endpoints (draft/post/cancel) and must NEVER be set or changed through the
// generic CRUD routes — not even postingStatus:"posted" (let the column default
// fill it). Both camelCase and snake_case are listed so a request cannot slip a
// value through under the DB column name.
const INVOICE_LIFECYCLE_FIELDS = [
  "postingStatus", "posting_status",
  "postedAt", "posted_at",
  "cancelledAt", "cancelled_at",
  "cancelReason", "cancel_reason"
];

function invoiceLifecycleFieldInBody(body = {}) {
  return INVOICE_LIFECYCLE_FIELDS.some((f) => Object.prototype.hasOwnProperty.call(body, f));
}

function isNumericAttribute(attribute) {
  return !!(attribute && attribute.type && NUMERIC_TYPE_NAMES.has(attribute.type.constructor.name));
}

// True when the value can be safely cast to a SQL numeric type. Guards numeric
// columns so a stray string never triggers a Postgres numeric-cast 500.
function isFiniteNumber(value) {
  if (value === "" || value === null || value === undefined) return false;
  return Number.isFinite(Number(value));
}

function toFiniteNumber(value, fallback = 0) {
  return isFiniteNumber(value) ? Number(value) : fallback;
}

function getPurityFromKarat(karat) {
  const numericKarat = Number(karat);
  if (numericKarat === 24) return 1;
  if (numericKarat === 22) return 0.916;
  if (numericKarat === 21) return 0.875;
  if (numericKarat === 18) return 0.75;
  return null;
}

async function normalizeAssetCreatePayload(payload, req) {
  if (req.body.type && !payload.type) payload.type = req.body.type;
  if (!payload.type) payload.type = "gold-piece";

  const grossWeight = toFiniteNumber(payload.grossWeight, 0);
  const netWeight = toFiniteNumber(payload.netWeight, grossWeight);
  const price = toFiniteNumber(payload.price, 0);
  const cost = toFiniteNumber(payload.cost, Math.round(price * 0.72));
  const purity = payload.purity ?? getPurityFromKarat(payload.karat);

  payload.grossWeight = grossWeight;
  payload.netWeight = netWeight;
  payload.goldWeight = payload.goldWeight ?? (purity ? grossWeight * Number(purity) : grossWeight);
  payload.price = price;
  payload.cost = cost;
  payload.branch = payload.branch || req.branchId || "Main Branch";
  payload.location = payload.location || "Showroom";
  payload.status = payload.status || "available";
  payload.source = payload.source || "Manual entry";
  if (purity !== null && purity !== undefined) payload.purity = purity;

  // Phase 32.1-Fix: final stored barcode identity is allocated only by the
  // backend from company-scoped editable taxonomy rows. Client-supplied final
  // barcode/component values are overwritten, never trusted.
  const barcodeIdentityService = require("../services/barcode-identity.service");
  const identity = await barcodeIdentityService.generateBarcodeForAsset({
    companyId: req.companyId,
    assetType: payload.type,
    inventoryCode: payload.inventoryCode,
    itemCode: payload.itemCode,
    karat: payload.karat,
    inventorySubtype: payload.inventorySubtype,
  });
  Object.assign(payload, identity);
  payload.metadataSchemaVersion = payload.metadataSchemaVersion || 1;
  payload.metadata = payload.metadata || {};

  return payload;
}

const ASSET_IDENTITY_FIELDS = Object.freeze({
  type: "type",
  karat: "karat",
  inventoryCode: "inventoryCode",
  inventory_code: "inventoryCode",
  itemCode: "itemCode",
  item_code: "itemCode",
  karatCode: "karatCode",
  karat_code: "karatCode",
  barcodeSerial: "barcodeSerial",
  barcode_serial: "barcodeSerial",
  barcode: "barcode",
  barcodeGeneratedAt: "barcodeGeneratedAt",
  barcode_generated_at: "barcodeGeneratedAt",
  barcodeRevision: "barcodeRevision",
  barcode_revision: "barcodeRevision",
});

function changedAssetIdentityField(item, body = {}) {
  for (const [requestField, modelField] of Object.entries(ASSET_IDENTITY_FIELDS)) {
    if (!Object.prototype.hasOwnProperty.call(body, requestField)) continue;
    const current = item[modelField];
    const requested = body[requestField];
    const currentComparable = current instanceof Date ? current.toISOString() : String(current ?? "");
    const requestedComparable = requested instanceof Date ? requested.toISOString() : String(requested ?? "");
    if (currentComparable !== requestedComparable) return requestField;
  }
  return null;
}

const GENERATED_ID_FORMATS = {
  Customer: { prefix: "CUS", width: 4 },
  Supplier: { prefix: "SUP", width: 3 },
};

const GENERATED_ID_CREATE_ATTEMPTS = 3;

function isUniqueConstraintError(error) {
  return error?.name === "SequelizeUniqueConstraintError";
}

async function generateScopedSequentialId(model, companyId) {
  const format = GENERATED_ID_FORMATS[model.name];
  if (!format) {
    return `${model.name.substring(0, 3).toUpperCase()}-${Date.now()}`;
  }

  const where = {
    id: { [Op.like]: `${format.prefix}-%` },
  };
  if (companyId) {
    where.companyId = companyId;
  }

  const rows = await model.findAll({
    attributes: ["id"],
    where,
    paranoid: false,
    raw: true,
  });

  const pattern = new RegExp(`^${format.prefix}-(\\d+)$`);
  const max = rows.reduce((currentMax, row) => {
    const match = pattern.exec(String(row.id || ""));
    if (!match) return currentMax;
    return Math.max(currentMax, Number(match[1]) || 0);
  }, 0);

  return `${format.prefix}-${String(max + 1).padStart(format.width, "0")}`;
}

class ErpController {
  constructor(model, searchFields = ["name"]) {
    this.model = model;
    this.searchFields = searchFields;
  }

  /**
   * Helper to write audit logs
   */
  async logAudit(req, action, recordId, oldValue = null, newValue = null) {
    try {
      // Route ALL audit writes through the centralized append-only service so
      // they join the tamper-evident hash chain. Writing AuditLog.create()
      // directly here (as this previously did) produced rows with no
      // prevHash/hash, which broke verifyChain() for the whole company.
      const auditService = require("../services/audit.service");
      const actorName = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
      const actorId = req.user ? req.user.id : "USR-SYSTEM";

      await auditService.record(req.companyId || "CMP-DEMO", {
        id: `AUD-${this.model.name.toUpperCase()}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        action,
        description: `${this.model.name} action ${action} on ID ${recordId} by ${actorName}`,
        user: actorName,
        userId: actorId,
        place: req.branchId || "Head Office",
        branch: req.branchId || "Head Office",
        before: oldValue ? JSON.stringify(oldValue) : null,
        after: newValue ? JSON.stringify(newValue) : null,
        device: "API Server",
        correlationId: req.headers["x-correlation-id"] || `COR-${this.model.name.toUpperCase()}-${recordId}`,
        sourceDocument: recordId,
        severity: "info"
      });
    } catch (err) {
      logger.error("Failed to log audit event:", err);
    }
  }

  list = async (req, res, next) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const pageSize = parseInt(req.query.pageSize) || 25;
      const search = req.query.search || "";
      const sortBy = req.query.sortBy || "createdAt";
      const sortDirection = (req.query.sortDirection || "desc").toUpperCase();

      const offset = (page - 1) * pageSize;

      // Base query scoped to tenant companyId
      const whereClause = {
        companyId: req.companyId
      };

      // Branch scope filtering — only when EXPLICITLY requested via ?branch=.
      // The active-branch header/default is context (used for create & audit),
      // not a hard list filter, otherwise lists silently hide all other branches.
      const branchVal = req.query.branch;
      if (branchVal && this.model.rawAttributes.branch) {
        whereClause.branch = branchVal;
      }

      // Apply search term across configured search fields
      if (search && this.searchFields.length > 0) {
        whereClause[Op.or] = this.searchFields.map((field) => ({
          [field]: { [Op.iLike]: `%${search}%` }
        }));
      }

      // Parse JSON filters if provided
      if (req.query.filters) {
        try {
          const parsedFilters = typeof req.query.filters === "string"
            ? JSON.parse(req.query.filters)
            : req.query.filters;

          Object.keys(parsedFilters).forEach((key) => {
            const attribute = this.model.rawAttributes[key];
            if (!attribute) return;

            const value = parsedFilters[key];

            // Treat dropdown defaults ("all") and empty selections as "no filter"
            // instead of matching them literally.
            if (isSentinelFilterValue(value)) return;

            // Suppliers' "due" dropdown sends semantic range values — "due"
            // (has outstanding dues) / "clear" (none). They target the numeric
            // `due` column, so translate them to a numeric range here, BEFORE
            // the numeric guard below would otherwise drop them as non-numeric.
            // A non-positive balance (incl. negatives) counts as "no dues".
            if (this.model.name === "Supplier" && key === "due" && (value === "due" || value === "clear")) {
              whereClause[key] = value === "due" ? { [Op.gt]: 0 } : { [Op.lte]: 0 };
              return;
            }

            // Journal entries expose two simplified UI status groups. Keep
            // array/IN handling scoped to this field so generic filter
            // semantics remain unchanged for every other resource.
            if (this.model.name === "JournalEntry" && key === "status" && Array.isArray(value)) {
              const allowedStatuses = ["draft", "balanced", "posted", "pending", "reversed"];
              const statuses = value.filter((status) => allowedStatuses.includes(status));
              if (statuses.length > 0) {
                whereClause[key] = { [Op.in]: statuses };
              }
              return;
            }

            // Never let a non-numeric value reach a numeric/decimal column —
            // Postgres throws "invalid input syntax for type numeric" otherwise.
            if (isNumericAttribute(attribute) && !isFiniteNumber(value)) return;

            whereClause[key] = value;
          });
        } catch (e) {
          logger.warn("Failed to parse query filters:", e.message);
        }
      }

      // Invoices: by default the list returns ONLY posted invoices, so drafts
      // and cancelled drafts never leak into financial lists / report + dashboard
      // aggregates that are computed from this endpoint. Drafts stay reachable on
      // demand: ?postingStatus=draft|posted|cancelled, or ?postingStatus=all /
      // ?includeDrafts=true to see every lifecycle state. An explicit
      // filters={postingStatus:...} (handled above) also wins.
      if (this.model.name === "Invoice" && whereClause.postingStatus === undefined) {
        const requested = req.query.postingStatus;
        if (["draft", "posted", "cancelled"].includes(requested)) {
          whereClause.postingStatus = requested;
        } else if (requested === "all" || req.query.includeDrafts === "true") {
          // no lifecycle filter — caller explicitly wants every state
        } else {
          whereClause.postingStatus = "posted";
        }
      }

      // Assets: opt-in "standalone only" filter for the inventory main list,
      // which shows top-level serialized assets (no parent). Sub/child assets
      // (parentAssetId set) are excluded ONLY when ?standaloneOnly=true is sent,
      // so total/totalPages stay correct under server-side pagination. Default
      // behaviour is unchanged, and this does not alter generic null-filter
      // semantics for any other resource.
      if (this.model.name === "Asset" && req.query.standaloneOnly === "true") {
        whereClause.parentAssetId = { [Op.is]: null };
      }

      // Audit logs: optional createdAt date-range (?from / ?to). Validated
      // strictly — a malformed date throws (→ 400) rather than silently
      // returning unfiltered results, so the caller never thinks the filter was
      // applied. Scoped to AuditLog; does not change generic filter semantics.
      if (this.model.name === "AuditLog") {
        const parseBound = (value, label) => {
          if (value === undefined || value === "") return null;
          const d = new Date(value);
          if (Number.isNaN(d.getTime())) {
            throw new ValidationError(`Invalid '${label}' date for audit log range.`);
          }
          return d;
        };
        const fromD = parseBound(req.query.from, "from");
        const toD = parseBound(req.query.to, "to");
        if (fromD || toD) {
          whereClause.createdAt = {};
          if (fromD) whereClause.createdAt[Op.gte] = fromD;
          if (toD) whereClause.createdAt[Op.lte] = toD;
        }
      }

      // Build sorting options
      const order = [];
      if (this.model.rawAttributes[sortBy]) {
        order.push([sortBy, sortDirection]);
      } else {
        order.push(["createdAt", "DESC"]);
      }

      const queryOptions = {
        where: whereClause,
        order,
        limit: pageSize,
        offset
      };

      if (this.model.name === "Invoice" && this.model.associations.items) {
        queryOptions.include = [{ association: "items" }];
        queryOptions.distinct = true;
      }

      const { count, rows } = await this.model.findAndCountAll(queryOptions);

      const totalPages = Math.ceil(count / pageSize);

      // Hybrid envelope for complete front-end compatibility
      return res.status(200).json({
        success: true,
        items: rows, // Direct TanStack binding
        page,
        pageSize,
        total: count,
        totalPages,
        data: {
          items: rows, // Contract specification
          page,
          pageSize,
          total: count,
          totalPages
        }
      });
    } catch (error) {
      next(error);
    }
  };

  getById = async (req, res, next) => {
    try {
      const queryOptions = {
        where: {
          id: req.params.id,
          companyId: req.companyId
        }
      };

      if (this.model.name === "Invoice" && this.model.associations.items) {
        queryOptions.include = [{ association: "items" }];
      }

      const item = await this.model.findOne(queryOptions);

      if (!item) {
        throw new NotFoundError(`${this.model.name} record not found.`);
      }

      return res.status(200).json({
        success: true,
        data: item
      });
    } catch (error) {
      next(error);
    }
  };

  create = async (req, res, next) => {
    try {
      // Journal entries require balanced debit/credit lines and a dedicated
      // draft workflow. The generic CRUD endpoint only creates a header row,
      // so reject it before payload construction, auditing, or any DB write.
      if (this.model.name === "JournalEntry") {
        throw new ValidationError(
          "Manual journal entry creation requires a dedicated balanced draft endpoint."
        );
      }

      // Invoices are financial documents: creating one must also create the
      // matching stock movements, treasury transactions and accounting postings.
      // The generic create only writes a header row and — via the column default
      // (postingStatus:"posted") — would produce a POSTED invoice with none of
      // those side effects. Block it entirely. Invoices are created only through
      // the lifecycle endpoints: POS checkout (/pos/checkout) or the sales draft
      // flow (/sales/invoices/drafts → /sales/invoices/:id/post).
      if (this.model.name === "Invoice") {
        return res.status(403).json({
          success: false,
          message: "Invoices cannot be created through generic CRUD. Use POS checkout or the sales draft/post lifecycle endpoints."
        });
      }

      const payload = {
        ...req.body,
        companyId: req.companyId
      };

      // Phase 10M: Supplier.due is system-managed (frozen) and must never be set
      // from a request body. Strip it so a new supplier starts at the column
      // default (0); the supplier statement is the source of truth for balance.
      if (this.model.name === "Supplier") {
        delete payload.due;
      }

      // Phase 10R: Customer.balance is maintained by business flows (sales/
      // payments/exchange/gold-pool), never by manual CRUD. Strip it from the
      // create body so a new customer starts at the column default (0); the
      // customer statement is the source of truth for the computed balance.
      if (this.model.name === "Customer") {
        delete payload.balance;
      }

      if (this.model.name === "Asset") {
        await normalizeAssetCreatePayload(payload, req);
      }

      // Ensure primary key is present if frontend generates IDs (like AST-2026-..., CUS-..., SUP-...)
      const shouldGenerateStringId =
        !payload.id &&
        this.model.rawAttributes.id &&
        this.model.rawAttributes.id.type.constructor.name === "STRING";

      let newItem;
      const attempts = shouldGenerateStringId ? GENERATED_ID_CREATE_ATTEMPTS : 1;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        if (shouldGenerateStringId) {
          payload.id = await generateScopedSequentialId(this.model, req.companyId);
        }

        try {
          newItem = await this.model.create(payload);
          break;
        } catch (error) {
          if (!shouldGenerateStringId || !isUniqueConstraintError(error)) {
            throw error;
          }
          if (attempt === attempts) {
            throw new ValidationError(`Could not generate a unique ${this.model.name} ID. Please retry.`, {
              id: ["Could not generate a unique ID"],
            });
          }
          delete payload.id;
        }
      }
      
      logger.info(`${this.model.name} created: ${newItem.id}`);
      await this.logAudit(req, "CREATE", newItem.id, null, newItem.toJSON());

      if (this.model.name === "Invoice") {
        const models = require("../models");
        const { recalculateCustomerNetPurchases } = require("../services/customer-purchases.service");
        await recalculateCustomerNetPurchases(models, req.companyId, newItem.customerId);
        emitEntityChanged(req.companyId, {
          entity: "Invoice",
          action: "create",
          id: newItem.id,
          related: { customerId: newItem.customerId }
        });
      } else {
        emitEntityChanged(req.companyId, { entity: this.model.name, action: "create", id: newItem.id });
      }

      return res.status(201).json({
        success: true,
        data: newItem
      });
    } catch (error) {
      next(error);
    }
  };

  update = async (req, res, next) => {
    try {
      const item = await this.model.findOne({
        where: {
          id: req.params.id,
          companyId: req.companyId
        }
      });

      if (!item) {
        throw new NotFoundError(`${this.model.name} record not found.`);
      }

      // Posted/cancelled invoices are financial records; generic CRUD cannot edit
      // them (there is no stock/treasury/accounting reversal here). Only DRAFT
      // invoices may be updated through generic CRUD, and even then the lifecycle
      // fields stay owned by the dedicated post/cancel endpoints.
      if (this.model.name === "Invoice") {
        if (item.postingStatus !== "draft") {
          return res.status(409).json({
            success: false,
            message: "Posted invoices cannot be modified through generic CRUD. Use the invoice lifecycle endpoints (post/cancel) or sales returns/exchanges."
          });
        }
        if (invoiceLifecycleFieldInBody(req.body)) {
          return res.status(403).json({
            success: false,
            message: "Invoice lifecycle fields can only be changed through invoice lifecycle endpoints"
          });
        }
      }

      const originalState = item.toJSON();

      // A barcode is the permanent operational identity. Existing legacy rows
      // also carry a barcode, so they receive the same protection even though
      // their new component columns remain NULL until a future approved phase.
      if (this.model.name === "Asset" && item.barcode) {
        const changedIdentityField = changedAssetIdentityField(item, req.body || {});
        if (changedIdentityField) {
          throw new ValidationError(
            "Barcode identity fields cannot be changed after generation. Create a new taxonomy code instead; historical barcodes remain immutable.",
            { [changedIdentityField]: ["Used barcode identity is locked"] }
          );
        }
      }

      // Phase 10M: Supplier.due is system-managed (frozen) — silently ignore any
      // `due` in the body so it can never be edited via generic CRUD.
      // Phase 10R: Customer.balance is likewise maintained only by business
      // flows — silently ignore any `balance` in the body.
      let updateBody = req.body;
      if (this.model.name === "Supplier" && Object.prototype.hasOwnProperty.call(req.body || {}, "due")) {
        updateBody = { ...updateBody };
        delete updateBody.due;
      }
      if (this.model.name === "Customer" && Object.prototype.hasOwnProperty.call(req.body || {}, "balance")) {
        updateBody = { ...updateBody };
        delete updateBody.balance;
      }
      await item.update(updateBody);

      logger.info(`${this.model.name} updated: ${item.id}`);
      await this.logAudit(req, "UPDATE", item.id, originalState, item.toJSON());

      if (this.model.name === "Invoice") {
        const models = require("../models");
        const { recalculateCustomerNetPurchases } = require("../services/customer-purchases.service");
        if (originalState.customerId && originalState.customerId !== item.customerId) {
          await recalculateCustomerNetPurchases(models, req.companyId, originalState.customerId);
        }
        await recalculateCustomerNetPurchases(models, req.companyId, item.customerId);
        emitEntityChanged(req.companyId, {
          entity: "Invoice",
          action: "update",
          id: item.id,
          related: { customerId: item.customerId }
        });
      } else {
        emitEntityChanged(req.companyId, { entity: this.model.name, action: "update", id: item.id });
      }

      // Specialized sub-resource event emissions
      if (this.model.name === "Customer" && req.body.kycDetails) {
        emitEntityChanged(req.companyId, {
          entity: "KYC",
          action: "update",
          id: item.id,
          related: { customerId: item.id }
        });
      }

      if (this.model.name === "Customer" && req.body.attachments) {
        const oldAttach = originalState.attachments || [];
        const newAttach = item.attachments || [];
        if (newAttach.length > oldAttach.length) {
          const added = newAttach.find(na => !oldAttach.some(oa => oa.id === na.id));
          if (added) {
            emitEntityChanged(req.companyId, {
              entity: "Attachment",
              action: "upload",
              id: added.id,
              related: { customerId: item.id }
            });
          }
        } else if (newAttach.length < oldAttach.length) {
          const removed = oldAttach.find(oa => !newAttach.some(na => na.id === oa.id));
          if (removed) {
            emitEntityChanged(req.companyId, {
              entity: "Attachment",
              action: "delete",
              id: removed.id,
              related: { customerId: item.id }
            });
          }
        }
      }

      return res.status(200).json({
        success: true,
        data: item
      });
    } catch (error) {
      next(error);
    }
  };

  deactivate = async (req, res, next) => {
    try {
      const item = await this.model.findOne({
        where: {
          id: req.params.id,
          companyId: req.companyId
        }
      });

      if (!item) {
        throw new NotFoundError(`${this.model.name} record not found.`);
      }

      // Invoices have no deactivate/reactivate lifecycle; their financial state is
      // owned by the post/cancel endpoints (and "inactive" is not a valid invoice
      // status). Block it via generic CRUD.
      if (this.model.name === "Invoice") {
        return res.status(409).json({
          success: false,
          message: "Invoices cannot be deactivated through generic CRUD. Use the invoice lifecycle endpoints."
        });
      }

      const originalState = item.toJSON();

      // Update status/active values
      const updates = {};
      if (this.model.rawAttributes.status) {
        updates.status = "inactive";
      }
      if (this.model.rawAttributes.isActive) {
        updates.isActive = false;
      }
      if (req.body.reason && this.model.rawAttributes.deactivateReason) {
        updates.deactivateReason = req.body.reason;
      }

      await item.update(updates);

      logger.info(`${this.model.name} deactivated: ${item.id}`);
      await this.logAudit(req, "DEACTIVATE", item.id, originalState, item.toJSON());

      if (this.model.name === "Invoice") {
        const models = require("../models");
        const { recalculateCustomerNetPurchases } = require("../services/customer-purchases.service");
        await recalculateCustomerNetPurchases(models, req.companyId, item.customerId);
        emitEntityChanged(req.companyId, {
          entity: "Invoice",
          action: "deactivate",
          id: item.id,
          related: { customerId: item.customerId }
        });
      } else {
        emitEntityChanged(req.companyId, { entity: this.model.name, action: "deactivate", id: item.id });
      }

      return res.status(200).json({
        success: true,
        data: item
      });
    } catch (error) {
      next(error);
    }
  };

  reactivate = async (req, res, next) => {
    try {
      const item = await this.model.findOne({
        where: {
          id: req.params.id,
          companyId: req.companyId
        }
      });

      if (!item) {
        throw new NotFoundError(`${this.model.name} record not found.`);
      }

      // Invoices have no deactivate/reactivate lifecycle (see deactivate above).
      if (this.model.name === "Invoice") {
        return res.status(409).json({
          success: false,
          message: "Invoices cannot be reactivated through generic CRUD. Use the invoice lifecycle endpoints."
        });
      }

      const originalState = item.toJSON();

      const updates = {};
      if (this.model.rawAttributes.status) {
        updates.status = "active";
      }
      if (this.model.rawAttributes.isActive) {
        updates.isActive = true;
      }

      await item.update(updates);

      logger.info(`${this.model.name} reactivated: ${item.id}`);
      await this.logAudit(req, "REACTIVATE", item.id, originalState, item.toJSON());

      if (this.model.name === "Invoice") {
        const models = require("../models");
        const { recalculateCustomerNetPurchases } = require("../services/customer-purchases.service");
        await recalculateCustomerNetPurchases(models, req.companyId, item.customerId);
        emitEntityChanged(req.companyId, {
          entity: "Invoice",
          action: "reactivate",
          id: item.id,
          related: { customerId: item.customerId }
        });
      } else {
        emitEntityChanged(req.companyId, { entity: this.model.name, action: "reactivate", id: item.id });
      }

      return res.status(200).json({
        success: true,
        data: item
      });
    } catch (error) {
      next(error);
    }
  };

  delete = async (req, res, next) => {
    try {
      // Journal entries must never be removed through generic CRUD: that would
      // hard-delete a POSTED entry without reversing its Account.balance impact,
      // breaking the ledger. Drafts are removed via the dedicated cancel
      // endpoint; posted entries are corrected via reversal. Reject here before
      // any lookup or delete.
      if (this.model.name === "JournalEntry") {
        throw new ValidationError(
          "Journal entries cannot be deleted via generic CRUD. Use the manual draft cancel or reversal workflows."
        );
      }

      const item = await this.model.findOne({
        where: {
          id: req.params.id,
          companyId: req.companyId
        }
      });

      if (!item) {
        throw new NotFoundError(`${this.model.name} record not found.`);
      }

      // Posted/cancelled invoices are financial records: a generic (soft-)delete
      // would remove them without reversing the stock/treasury/accounting impact.
      // Only DRAFT invoices (no posted side effects) may be deleted here; posted
      // documents must be corrected via a lifecycle cancel/reversal route.
      if (this.model.name === "Invoice" && item.postingStatus !== "draft") {
        return res.status(409).json({
          success: false,
          message: "Posted invoices cannot be deleted through generic CRUD. Use the invoice lifecycle cancel/reversal route."
        });
      }

      const originalState = item.toJSON();
      await item.destroy(); // Performs soft-delete if paranoid mode is active

      logger.info(`${this.model.name} deleted: ${item.id}`);
      await this.logAudit(req, "DELETE", item.id, originalState, null);

      if (this.model.name === "Invoice") {
        const models = require("../models");
        const { recalculateCustomerNetPurchases } = require("../services/customer-purchases.service");
        await recalculateCustomerNetPurchases(models, req.companyId, item.customerId);
        emitEntityChanged(req.companyId, {
          entity: "Invoice",
          action: "delete",
          id: item.id,
          related: { customerId: item.customerId }
        });
      } else {
        emitEntityChanged(req.companyId, { entity: this.model.name, action: "delete", id: item.id });
      }

      return res.status(200).json({
        success: true,
        data: { message: "Record deleted successfully" }
      });
    } catch (error) {
      next(error);
    }
  };
}

module.exports = ErpController;
