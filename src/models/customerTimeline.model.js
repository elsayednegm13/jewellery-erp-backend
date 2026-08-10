"use strict";
const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");
module.exports = sequelize.define("CustomerTimeline", {
  id: { type: DataTypes.STRING, primaryKey: true }, companyId: { type: DataTypes.STRING, allowNull: false, field: "company_id" }, branchId: { type: DataTypes.STRING, allowNull: false, field: "branch_id" }, customerId: { type: DataTypes.STRING, allowNull: false, field: "customer_id" }, eventType: { type: DataTypes.STRING, allowNull: false, field: "event_type" }, sourceDocumentType: { type: DataTypes.STRING, allowNull: false, field: "source_document_type" }, sourceDocumentId: { type: DataTypes.STRING, allowNull: false, field: "source_document_id" }, sourceEventId: { type: DataTypes.STRING, allowNull: false, field: "source_event_id" }, occurredAt: { type: DataTypes.DATE, allowNull: false, field: "occurred_at" }, summary: { type: DataTypes.TEXT, allowNull: false }, metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
}, { tableName: "customer_timelines", timestamps: true, underscored: true });
