const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

// Branch-owned financial authority.  A row is intentionally never company-only:
// reservation deposits must not fall back to another branch's cash, bank, or
// liability account.
const BranchFinancialMapping = sequelize.define("BranchFinancialMapping", {
  id: { type: DataTypes.STRING, primaryKey: true },
  companyId: { type: DataTypes.STRING, allowNull: false, field: "company_id" },
  branchId: { type: DataTypes.STRING, allowNull: false, field: "branch_id" },
  mappingType: { type: DataTypes.STRING, allowNull: false, field: "mapping_type" },
  channel: { type: DataTypes.STRING, allowNull: true },
  accountId: { type: DataTypes.STRING, allowNull: false, field: "account_id" },
  isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "is_active" },
  createdBy: { type: DataTypes.STRING, allowNull: true, field: "created_by" },
  updatedBy: { type: DataTypes.STRING, allowNull: true, field: "updated_by" },
}, { tableName: "branch_financial_mappings", timestamps: true, underscored: true });

module.exports = BranchFinancialMapping;
