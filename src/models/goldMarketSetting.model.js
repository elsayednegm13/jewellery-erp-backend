const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const GoldMarketSetting = sequelize.define("GoldMarketSetting", {
  id: { type: DataTypes.STRING(128), primaryKey: true },
  companyId: { type: DataTypes.STRING, allowNull: false, field: "company_id" },
  pricingMode: { type: DataTypes.STRING(24), allowNull: false, defaultValue: "MANUAL_APPROVED", field: "pricing_mode" },
  activeProvider: { type: DataTypes.STRING(32), allowNull: true, field: "active_provider" },
  marketCurrency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: "AED", field: "market_currency" },
  refreshIntervalSeconds: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 30, field: "refresh_interval_seconds" },
  staleAfterSeconds: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 120, field: "stale_after_seconds" },
  enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  updatedBy: { type: DataTypes.STRING, allowNull: true, field: "updated_by" },
  version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
}, { tableName: "gold_market_settings", timestamps: true, underscored: true });

module.exports = GoldMarketSetting;
