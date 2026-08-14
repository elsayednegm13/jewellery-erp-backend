const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const AccountingLock = sequelize.define("AccountingLock", {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  companyId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "company_id"
  },
  lockedThroughDate: {
    type: DataTypes.DATEONLY,
    allowNull: true,
    field: "locked_through_date"
  },
  reason: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  updatedByUserId: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "updated_by_user_id"
  },
  updatedByName: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "updated_by_name"
  }
}, {
  tableName: "accounting_locks",
  timestamps: true,
  underscored: true
});

module.exports = AccountingLock;
