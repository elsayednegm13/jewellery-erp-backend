const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const User = sequelize.define("User", {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  companyId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "company_id"
  },
  firstName: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "first_name"
  },
  lastName: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "last_name"
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: {
      isEmail: true
    }
  },
  phone: {
    type: DataTypes.STRING
  },
  password: {
    type: DataTypes.STRING,
    allowNull: false
  },
  jobTitle: {
    type: DataTypes.STRING,
    field: "job_title"
  },
  role: {
    type: DataTypes.ENUM("admin", "owner", "manager", "accountant", "sales"),
    allowNull: false,
    defaultValue: "sales"
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    field: "is_active"
  },
  accountType: {
    type: DataTypes.ENUM("legacy", "super_admin", "branch_shell"),
    allowNull: false,
    defaultValue: "legacy",
    field: "account_type"
  },
  branchId: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "branch_id"
  },
  recoveryEmail: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "recovery_email",
    validate: { isEmail: true }
  },
  recoveryPhone: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "recovery_phone"
  },
  recoveryEmailVerifiedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: "recovery_email_verified_at"
  },
  recoveryPhoneVerifiedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: "recovery_phone_verified_at"
  },
  forcePasswordChange: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: "force_password_change"
  },
  failedLoginCount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: "failed_login_count"
  },
  lockedUntil: {
    type: DataTypes.DATE,
    allowNull: true,
    field: "locked_until"
  },
  passwordVersion: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
    field: "password_version"
  },
  sessionVersion: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
    field: "session_version"
  },
  credentialsChangedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: "credentials_changed_at"
  },
  lastLoginAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: "last_login_at"
  },
  lastPasswordChangeAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: "last_password_change_at"
  },
  defaultEmployeeId: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "default_employee_id"
  }
}, {
  tableName: "users",
  timestamps: true,
  underscored: true,
  paranoid: true
});

module.exports = User;
