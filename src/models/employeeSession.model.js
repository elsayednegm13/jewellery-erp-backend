const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const EmployeeSession = sequelize.define("EmployeeSession", {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  employeeId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "employee_id"
  },
  deviceName: {
    type: DataTypes.STRING,
    field: "device_name"
  },
  browser: {
    type: DataTypes.STRING
  },
  location: {
    type: DataTypes.STRING
  },
  lastActive: {
    type: DataTypes.STRING,
    field: "last_active"
  },
  isCurrent: {
    type: DataTypes.BOOLEAN,
    field: "is_current",
    defaultValue: false
  }
}, {
  tableName: "employee_sessions",
  timestamps: true,
  underscored: true
});

module.exports = EmployeeSession;
