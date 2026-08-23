"use strict";

const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

// This is a technical saga aggregate only.  It records a reversal hold and
// deliberately has no financial, Treasury, Gold Center, or CRM authority.
module.exports = sequelize.define("CgpReversalRequest", {
  id: { type: DataTypes.STRING, primaryKey: true },
  companyId: { type: DataTypes.STRING, allowNull: false, field: "company_id" },
  branchId: { type: DataTypes.STRING, allowNull: false, field: "branch_id" },
  cgpDocumentId: { type: DataTypes.STRING, allowNull: false, field: "cgp_document_id" },
  postedEventId: { type: DataTypes.STRING(128), allowNull: false, field: "posted_event_id" },
  status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "REQUESTED" },
  reason: { type: DataTypes.TEXT, allowNull: false },
  idempotencyKey: { type: DataTypes.STRING(191), allowNull: false, field: "idempotency_key" },
  requestHash: { type: DataTypes.STRING(64), allowNull: false, field: "request_hash" },
  correlationId: { type: DataTypes.STRING(128), allowNull: false, field: "correlation_id" },
  causationId: { type: DataTypes.STRING(128), allowNull: true, field: "causation_id" },
  requestedBy: { type: DataTypes.STRING, allowNull: false, field: "requested_by" },
  requestedAt: { type: DataTypes.DATE, allowNull: false, field: "requested_at" },
  heldAt: { type: DataTypes.DATE, allowNull: true, field: "held_at" },
  compensationEventId: { type: DataTypes.STRING(128), allowNull: true, field: "compensation_event_id" },
  completedAt: { type: DataTypes.DATE, allowNull: true, field: "completed_at" },
  completedBy: { type: DataTypes.STRING, allowNull: true, field: "completed_by" },
  metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
}, { tableName: "cgp_reversal_requests", timestamps: true, underscored: true });
