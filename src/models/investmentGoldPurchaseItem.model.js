const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

module.exports = sequelize.define("InvestmentGoldPurchaseItem", {
  id: { type: DataTypes.STRING, primaryKey: true },
  companyId: { type: DataTypes.STRING, allowNull: false, field: "company_id" },
  documentId: { type: DataTypes.STRING, allowNull: false, field: "document_id" },
  lineNumber: { type: DataTypes.INTEGER, allowNull: false, field: "line_number" },
  investmentType: { type: DataTypes.ENUM("physical", "bullion"), allowNull: false, field: "investment_type" },
  bullionIdentityType: { type: DataTypes.ENUM("serialized_unit", "bullion_lot"), field: "bullion_identity_type" },
  goldType: { type: DataTypes.STRING, allowNull: false, field: "gold_type" },
  serialNumber: { type: DataTypes.STRING, field: "serial_number" },
  lotNumber: { type: DataTypes.STRING, field: "lot_number" },
  quantity: { type: DataTypes.DECIMAL(20, 6), allowNull: false, defaultValue: 1 },
  karat: { type: DataTypes.DECIMAL(8, 6), allowNull: false },
  fineness: { type: DataTypes.DECIMAL(10, 6), allowNull: false },
  purityFactor: { type: DataTypes.DECIMAL(10, 6), allowNull: false, field: "purity_factor" },
  grossWeight: { type: DataTypes.DECIMAL(20, 6), allowNull: false, field: "gross_weight" },
  stoneWeight: { type: DataTypes.DECIMAL(20, 6), allowNull: false, field: "stone_weight" },
  netWeight: { type: DataTypes.DECIMAL(20, 6), allowNull: false, field: "net_weight" },
  pureGoldWeight: { type: DataTypes.DECIMAL(20, 6), allowNull: false, field: "pure_gold_weight" },
  proposedPurchaseRate: { type: DataTypes.DECIMAL(20, 4), field: "proposed_purchase_rate" },
  referenceMarketRate: { type: DataTypes.DECIMAL(20, 4), field: "reference_market_rate" },
  proposedCharges: { type: DataTypes.DECIMAL(20, 4), field: "proposed_charges" },
  proposedDiscount: { type: DataTypes.DECIMAL(20, 4), field: "proposed_discount" },
  taxModeMetadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: "tax_mode_metadata" },
  notes: { type: DataTypes.TEXT },
  version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 }
}, { tableName: "investment_gold_purchase_items", timestamps: true, underscored: true, paranoid: true });
