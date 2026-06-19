const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const Setting = sequelize.define("Setting", {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  companyId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "company_id"
  },
  key: {
    type: DataTypes.STRING,
    allowNull: false
  },
  value: {
    type: DataTypes.JSONB,
    allowNull: false
  }
}, {
  tableName: "settings",
  timestamps: true,
  underscored: true
});

module.exports = Setting;
