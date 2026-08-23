const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");
const { AppError } = require("../utils/errors");

function immutableSnapshotError() {
  throw new AppError("CGP pricing snapshots are immutable", 409, "CGP_PRICING_SNAPSHOT_IMMUTABLE");
}

const CgpPricingSnapshot = sequelize.define("CgpPricingSnapshot", {
  id: { type: DataTypes.STRING, primaryKey: true },
  companyId: { type: DataTypes.STRING, allowNull: false, field: "company_id" },
  branchId: { type: DataTypes.STRING, allowNull: false, field: "branch_id" },
  cgpDocumentId: { type: DataTypes.STRING, allowNull: false, field: "cgp_document_id" },
  cgpItemId: { type: DataTypes.STRING, allowNull: false, field: "cgp_item_id" },
  priceSource: { type: DataTypes.STRING(128), allowNull: false, field: "price_source" },
  priceVersion: { type: DataTypes.STRING(64), allowNull: false, field: "price_version" },
  priceTimestamp: { type: DataTypes.DATE, allowNull: false, field: "price_timestamp" },
  approvedPriceId: { type: DataTypes.INTEGER, allowNull: true, field: "approved_price_id" },
  approvedPriceStatus: { type: DataTypes.STRING(24), allowNull: true, field: "approved_price_status" },
  approvedPriceAt: { type: DataTypes.DATE, allowNull: true, field: "approved_price_at" },
  approvedPriceBy: { type: DataTypes.STRING, allowNull: true, field: "approved_price_by" },
  approvedPriceSource: { type: DataTypes.STRING(64), allowNull: true, field: "approved_price_source" },
  pricingMode: { type: DataTypes.STRING(24), allowNull: true, field: "pricing_mode" },
  provider: { type: DataTypes.STRING(32), allowNull: true },
  marketQuoteId: { type: DataTypes.STRING(128), allowNull: true, field: "market_quote_id" },
  providerQuoteId: { type: DataTypes.STRING(128), allowNull: true, field: "provider_quote_id" },
  marketQuoteTimestamp: { type: DataTypes.DATE, allowNull: true, field: "market_quote_timestamp" },
  marketReceivedAt: { type: DataTypes.DATE, allowNull: true, field: "market_received_at" },
  quoteCurrency: { type: DataTypes.STRING(3), allowNull: true, field: "quote_currency" },
  quoteUnit: { type: DataTypes.STRING(24), allowNull: true, field: "quote_unit" },
  baseQuoteType: { type: DataTypes.STRING(8), allowNull: true, field: "base_quote_type" },
  baseMarketRate: { type: DataTypes.DECIMAL(20, 8), allowNull: true, field: "base_market_rate" },
  karatMarketRate: { type: DataTypes.DECIMAL(20, 8), allowNull: true, field: "karat_market_rate" },
  adjustmentType: { type: DataTypes.STRING(24), allowNull: true, field: "adjustment_type" },
  adjustmentValue: { type: DataTypes.DECIMAL(20, 8), allowNull: true, field: "adjustment_value" },
  policyId: { type: DataTypes.STRING(128), allowNull: true, field: "policy_id" },
  policyVersion: { type: DataTypes.INTEGER, allowNull: true, field: "policy_version" },
  policyScope: { type: DataTypes.STRING(16), allowNull: true, field: "policy_scope" },
  finalEffectiveRate: { type: DataTypes.DECIMAL(20, 4), allowNull: true, field: "final_effective_rate" },
  calculatedAt: { type: DataTypes.DATE, allowNull: true, field: "calculated_at" },
  ratePrecision: { type: DataTypes.JSONB, allowNull: true, field: "rate_precision" },
  derivationMethod: { type: DataTypes.STRING(64), allowNull: true, field: "derivation_method" },
  currency: { type: DataTypes.STRING(3), allowNull: false },
  karat: { type: DataTypes.DECIMAL(8, 6), allowNull: false },
  purityFactor: { type: DataTypes.DECIMAL(10, 6), allowNull: false, field: "purity_factor" },
  grossWeight: { type: DataTypes.DECIMAL(20, 6), allowNull: false, field: "gross_weight" },
  stoneWeight: { type: DataTypes.DECIMAL(20, 6), allowNull: false, field: "stone_weight" },
  netWeight: { type: DataTypes.DECIMAL(20, 6), allowNull: false, field: "net_weight" },
  pureGoldWeight: { type: DataTypes.DECIMAL(20, 6), allowNull: false, field: "pure_gold_weight" },
  approvedKaratRate: { type: DataTypes.DECIMAL(20, 4), allowNull: false, field: "approved_karat_rate" },
  rateBasis: { type: DataTypes.STRING(32), allowNull: false, field: "rate_basis" },
  lineGoldValue: { type: DataTypes.DECIMAL(20, 4), allowNull: false, field: "line_gold_value" },
  calculationVersion: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1, field: "calculation_version" },
  createdBy: { type: DataTypes.STRING, allowNull: true, field: "created_by" },
}, {
  tableName: "cgp_pricing_snapshots",
  timestamps: true,
  underscored: true,
  updatedAt: false,
  hooks: {
    beforeUpdate: immutableSnapshotError,
    beforeDestroy: immutableSnapshotError,
    beforeBulkUpdate: immutableSnapshotError,
    beforeBulkDestroy: immutableSnapshotError,
  },
});

module.exports = CgpPricingSnapshot;
