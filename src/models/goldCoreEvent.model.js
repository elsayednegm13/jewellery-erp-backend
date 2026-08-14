"use strict";

const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");
const { AppError } = require("../utils/errors");

function immutableEventError() {
  throw new AppError("Gold Center core economic events are immutable", 409, "GOLD_CORE_EVENT_IMMUTABLE");
}

const GoldCoreEvent = sequelize.define("GoldCoreEvent", {
  id: { type: DataTypes.STRING, primaryKey: true },
  eventType: { type: DataTypes.STRING(128), allowNull: false, field: "event_type" },
  eventVersion: { type: DataTypes.INTEGER, allowNull: false, field: "event_version" },
  sourceEventId: { type: DataTypes.STRING(128), allowNull: false, field: "source_event_id" },
  sourceEventType: { type: DataTypes.STRING(128), allowNull: false, field: "source_event_type" },
  sourceEventVersion: { type: DataTypes.INTEGER, allowNull: false, field: "source_event_version" },
  sourceDocumentId: { type: DataTypes.STRING, allowNull: false, field: "source_document_id" },
  sourceDocumentNumber: { type: DataTypes.STRING(128), allowNull: false, field: "source_document_number" },
  postingReference: { type: DataTypes.STRING(128), allowNull: false, field: "posting_reference" },
  companyId: { type: DataTypes.STRING, allowNull: false, field: "company_id" },
  branchId: { type: DataTypes.STRING, allowNull: false, field: "branch_id" },
  sourcePartyType: { type: DataTypes.STRING(32), allowNull: false, field: "source_party_type" },
  sourcePartyId: { type: DataTypes.STRING, allowNull: false, field: "source_party_id" },
  currency: { type: DataTypes.STRING(3), allowNull: false },
  payload: { type: DataTypes.JSONB, allowNull: false },
  occurredAt: { type: DataTypes.DATE, allowNull: false, field: "occurred_at" },
  correlationId: { type: DataTypes.STRING(128), allowNull: false, field: "correlation_id" },
  causationId: { type: DataTypes.STRING(128), allowNull: true, field: "causation_id" },
}, {
  tableName: "gold_core_events", timestamps: true, underscored: true,
  hooks: { beforeUpdate: immutableEventError, beforeDestroy: immutableEventError, beforeBulkUpdate: immutableEventError, beforeBulkDestroy: immutableEventError },
});

module.exports = GoldCoreEvent;
