"use strict";

const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

module.exports = sequelize.define("FinancialSettlementAllocation", {
  id: { type: DataTypes.STRING, primaryKey: true },
  settlementId: { type: DataTypes.STRING, allowNull: false, field: "settlement_id" },
  customerFinancialLiabilityId: { type: DataTypes.STRING, allowNull: false, field: "customer_financial_liability_id" },
  amount: { type: DataTypes.DECIMAL(20, 4), allowNull: false },
}, { tableName: "financial_settlement_allocations", timestamps: true, underscored: true });
