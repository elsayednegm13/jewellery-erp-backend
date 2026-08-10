const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const GoldMarketQuote = sequelize.define("GoldMarketQuote", {
  id: { type: DataTypes.STRING(128), primaryKey: true },
  companyId: { type: DataTypes.STRING, allowNull: false, field: "company_id" },
  provider: { type: DataTypes.STRING(32), allowNull: false },
  metal: { type: DataTypes.STRING(8), allowNull: false, defaultValue: "XAU" },
  currency: { type: DataTypes.STRING(3), allowNull: false },
  unit: { type: DataTypes.STRING(24), allowNull: false, defaultValue: "PER_GRAM", field: "unit" },
  basePurity: { type: DataTypes.DECIMAL(8, 4), allowNull: true, field: "base_purity" },
  quoteTimestamp: { type: DataTypes.DATE, allowNull: false, field: "quote_timestamp" },
  receivedAt: { type: DataTypes.DATE, allowNull: false, field: "received_at" },
  spot: { type: DataTypes.DECIMAL(20, 8), allowNull: true },
  bid: { type: DataTypes.DECIMAL(20, 8), allowNull: true },
  ask: { type: DataTypes.DECIMAL(20, 8), allowNull: true },
  karat18Rate: { type: DataTypes.DECIMAL(20, 8), allowNull: true, field: "karat_18_rate" },
  karat21Rate: { type: DataTypes.DECIMAL(20, 8), allowNull: true, field: "karat_21_rate" },
  karat22Rate: { type: DataTypes.DECIMAL(20, 8), allowNull: true, field: "karat_22_rate" },
  karat24Rate: { type: DataTypes.DECIMAL(20, 8), allowNull: true, field: "karat_24_rate" },
  karatRateSource: { type: DataTypes.STRING(32), allowNull: true, field: "karat_rate_source" },
  providerQuoteId: { type: DataTypes.STRING(128), allowNull: true, field: "provider_quote_id" },
  rawPayloadHash: { type: DataTypes.STRING(128), allowNull: true, field: "raw_payload_hash" },
  status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "VALID" },
  quality: { type: DataTypes.STRING(24), allowNull: true },
}, { tableName: "gold_market_quotes", timestamps: true, underscored: true });

module.exports = GoldMarketQuote;
