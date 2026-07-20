const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

// A stable, branch-scoped accounting role. This is deliberately separate
// from Account names/codes: posting code resolves an approved role, never a
// translated label, a demo record, or an arbitrary first account.
const SystemAccountRole = sequelize.define("SystemAccountRole", {
  id: { type: DataTypes.STRING, primaryKey: true },
  companyId: { type: DataTypes.STRING, allowNull: false, field: "company_id" },
  branchId: { type: DataTypes.STRING, allowNull: true, field: "branch_id" },
  roleCode: { type: DataTypes.STRING, allowNull: false, field: "role_code" },
  accountId: { type: DataTypes.STRING, allowNull: false, field: "account_id" },
  createdBy: { type: DataTypes.STRING, allowNull: true, field: "created_by" },
  updatedBy: { type: DataTypes.STRING, allowNull: true, field: "updated_by" },
}, {
  tableName: "system_account_roles",
  timestamps: true,
  underscored: true,
});

module.exports = SystemAccountRole;
