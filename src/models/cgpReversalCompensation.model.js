"use strict";
const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");
const { AppError } = require("../utils/errors");

function immutableCompensationError() {
  throw new AppError("CGP reversal compensation evidence is immutable", 409, "CGP_REVERSAL_COMPENSATION_IMMUTABLE");
}

module.exports = sequelize.define("CgpReversalCompensation", {
  id: { type: DataTypes.STRING, primaryKey: true },
  reversalRequestId: { type: DataTypes.STRING, allowNull: false, field: "reversal_request_id" },
  domain: { type: DataTypes.STRING(32), allowNull: false },
  compensationEventId: { type: DataTypes.STRING(128), allowNull: false, field: "compensation_event_id" },
  journalEntryId: { type: DataTypes.STRING, allowNull: true, field: "journal_entry_id" },
  goldCoreEventId: { type: DataTypes.STRING, allowNull: true, field: "gold_core_event_id" },
  amount: { type: DataTypes.DECIMAL(20, 4), allowNull: false },
  status: { type: DataTypes.STRING(16), allowNull: false },
  metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
}, {
  tableName: "cgp_reversal_compensations", timestamps: true, underscored: true,
  hooks: {
    beforeUpdate: immutableCompensationError,
    beforeDestroy: immutableCompensationError,
    beforeBulkUpdate: immutableCompensationError,
    beforeBulkDestroy: immutableCompensationError,
  },
});
