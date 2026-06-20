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

function generateBarcode() {
  return String(Date.now()).slice(-13).padStart(13, "6");
}

function normalizeAssetCreatePayload(payload, req) {
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
  payload.barcode = payload.barcode || generateBarcode();
  payload.source = payload.source || "Manual entry";
  if (purity !== null && purity !== undefined) payload.purity = purity;

  return payload;
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
      // Invoice lifecycle fields are owned by the dedicated lifecycle endpoints,
      // not generic CRUD. Reject ANY lifecycle field in the body (incl.
      // postingStatus:"posted") — the column default fills posted automatically.
      if (this.model.name === "Invoice" && invoiceLifecycleFieldInBody(req.body)) {
        return res.status(403).json({
          success: false,
          message: "Invoice lifecycle fields can only be changed through invoice lifecycle endpoints"
        });
      }

      const payload = {
        ...req.body,
        companyId: req.companyId
      };

      // Ensure primary key is present if frontend generates IDs (like AST-2026-..., CUS-..., SUP-...)
      if (!payload.id && this.model.rawAttributes.id) {
        // If integer autoIncrement, let db handle it. Otherwise set string ID.
        if (this.model.rawAttributes.id.type.constructor.name === "STRING") {
          payload.id = `${this.model.name.substring(0, 3).toUpperCase()}-${Date.now()}`;
        }
      }

      if (this.model.name === "Asset") {
        normalizeAssetCreatePayload(payload, req);
      }

      const newItem = await this.model.create(payload);
      
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

      // Block changing any invoice lifecycle field via generic CRUD; only the
      // dedicated lifecycle endpoints may transition draft/posted/cancelled and
      // stamp postedAt/cancelledAt/cancelReason.
      if (this.model.name === "Invoice" && invoiceLifecycleFieldInBody(req.body)) {
        return res.status(403).json({
          success: false,
          message: "Invoice lifecycle fields can only be changed through invoice lifecycle endpoints"
        });
      }

      const originalState = item.toJSON();
      await item.update(req.body);

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
      const item = await this.model.findOne({
        where: {
          id: req.params.id,
          companyId: req.companyId
        }
      });

      if (!item) {
        throw new NotFoundError(`${this.model.name} record not found.`);
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
