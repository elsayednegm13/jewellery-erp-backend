"use strict";

const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

module.exports = sequelize.define("FinancialSettlementLeg", {
  id: { type: DataTypes.STRING, primaryKey: true },
  settlementId: { type: DataTypes.STRING, allowNull: false, field: "settlement_id" },
  method: { type: DataTypes.STRING(32), allowNull: false },
  amount: { type: DataTypes.DECIMAL(20, 4), allowNull: false },
  accountId: { type: DataTypes.STRING, allowNull: false, field: "account_id" },
  cashRegisterSessionId: { type: DataTypes.STRING, allowNull: true, field: "cash_register_session_id" },
  bankReference: { type: DataTypes.STRING(191), allowNull: true, field: "bank_reference" },
  cashTransactionId: { type: DataTypes.STRING, allowNull: true, field: "cash_transaction_id" },
  metadata: { type: DataTypes.JSONB, allowNull: true },
}, { tableName: "financial_settlement_legs", timestamps: true, underscored: true });
