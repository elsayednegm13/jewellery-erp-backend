const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * Attendance — one row per employee per day (check-in / check-out).
 */
const Attendance = sequelize.define("Attendance", {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  companyId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "company_id"
  },
  employeeId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "employee_id"
  },
  employeeName: {
    type: DataTypes.STRING,
    field: "employee_name"
  },
  date: {
    type: DataTypes.STRING,
    allowNull: false
  },
  checkIn: {
    type: DataTypes.STRING,
    field: "check_in"
  },
  checkOut: {
    type: DataTypes.STRING,
    field: "check_out"
  },
  hours: {
    type: DataTypes.DECIMAL(6, 2),
    defaultValue: 0
  },
  status: {
    type: DataTypes.ENUM("present", "absent", "leave", "late", "holiday"),
    defaultValue: "present"
  },
  branch: {
    type: DataTypes.STRING
  },
  notes: {
    type: DataTypes.TEXT
  }
}, {
  tableName: "attendance",
  timestamps: true,
  underscored: true
});

module.exports = Attendance;
