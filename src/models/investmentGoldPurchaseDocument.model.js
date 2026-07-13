const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

module.exports = sequelize.define("InvestmentGoldPurchaseDocument", {
  id: { type: DataTypes.STRING, primaryKey: true },
  companyId: { type: DataTypes.STRING, allowNull: false, field: "company_id" },
  branchId: { type: DataTypes.STRING, allowNull: false, field: "branch_id" },
  draftNumber: { type: DataTypes.STRING, allowNull: false, field: "draft_number" },
  supplierId: { type: DataTypes.STRING, allowNull: false, field: "supplier_id" },
  supplierReference: { type: DataTypes.STRING, field: "supplier_reference" },
  purchaseDate: { type: DataTypes.DATEONLY, allowNull: false, field: "purchase_date" },
  currency: { type: DataTypes.STRING(3), allowNull: false },
  exchangeRate: { type: DataTypes.DECIMAL(24, 8), allowNull: false, field: "exchange_rate" },
  status: { type: DataTypes.ENUM("draft", "validated"), allowNull: false, defaultValue: "draft" },
  version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  notes: { type: DataTypes.TEXT },
  createdBy: { type: DataTypes.STRING, field: "created_by" },
  updatedBy: { type: DataTypes.STRING, field: "updated_by" },
  validatedAt: { type: DataTypes.DATE, field: "validated_at" },
  validatedBy: { type: DataTypes.STRING, field: "validated_by" },
  voidedAt: { type: DataTypes.DATE, field: "voided_at" },
  voidedBy: { type: DataTypes.STRING, field: "voided_by" },
  voidReason: { type: DataTypes.TEXT, field: "void_reason" }
}, { tableName: "investment_gold_purchase_documents", timestamps: true, underscored: true });
