const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const Employee = sequelize.define("Employee", {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  companyId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "company_id"
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  role: {
    type: DataTypes.STRING,
    allowNull: false
  },
  systemRole: {
    type: DataTypes.ENUM("admin", "owner", "manager", "accountant", "sales"),
    field: "system_role"
  },
  branch: {
    type: DataTypes.STRING,
    allowNull: false
  },
  branchId: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "branch_id"
  },
  status: {
    type: DataTypes.ENUM("present", "leave", "inactive"),
    defaultValue: "present"
  },
  email: {
    type: DataTypes.STRING
  },
  phone: {
    type: DataTypes.STRING
  },
  joinDate: {
    type: DataTypes.STRING,
    field: "join_date"
  },
  jobTitle: {
    type: DataTypes.STRING,
    field: "job_title"
  },
  approvalLimit: {
    type: DataTypes.DECIMAL(15, 4),
    field: "approval_limit",
    defaultValue: 0
  },
  baseSalary: {
    type: DataTypes.DECIMAL(15, 4),
    field: "base_salary",
    defaultValue: 0
  },
  allowances: {
    type: DataTypes.DECIMAL(15, 4),
    defaultValue: 0
  },
  assignedDevice: {
    type: DataTypes.STRING,
    field: "assigned_device"
  },
  notes: {
    type: DataTypes.TEXT
  },
  approvalLimitsDetail: {
    type: DataTypes.JSONB,
    field: "approval_limits_detail"
  },
  deactivateReason: {
    type: DataTypes.STRING,
    field: "deactivate_reason"
  }
}, {
  tableName: "employees",
  timestamps: true,
  underscored: true,
  paranoid: true
});

module.exports = Employee;
