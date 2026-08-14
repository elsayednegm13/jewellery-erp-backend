const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const BranchCustomer = sequelize.define("BranchCustomer", {
  id: { type: DataTypes.STRING, primaryKey: true },
  companyId: { type: DataTypes.STRING, allowNull: false, field: "company_id" },
  branchId: { type: DataTypes.STRING, allowNull: false, field: "branch_id" },
  customerId: { type: DataTypes.STRING, allowNull: false, field: "customer_id" },
  balance: { type: DataTypes.DECIMAL(20, 8), allowNull: false, defaultValue: 0 },
  purchases: { type: DataTypes.DECIMAL(20, 8), allowNull: false, defaultValue: 0 },
  loyaltyPoints: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "loyalty_points" },
  isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "is_active" },
}, { tableName: "branch_customers", timestamps: true, underscored: true });

module.exports = BranchCustomer;
