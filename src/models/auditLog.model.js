const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const AuditLog = sequelize.define("AuditLog", {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  companyId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "company_id"
  },
  action: {
    type: DataTypes.STRING,
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  user: {
    type: DataTypes.STRING,
    allowNull: false
  },
  userId: {
    type: DataTypes.STRING,
    field: "user_id"
  },
  technicalUserId: {
    type: DataTypes.STRING,
    field: "technical_user_id"
  },
  employeeId: {
    type: DataTypes.STRING,
    field: "employee_id"
  },
  employeeCodeSnapshot: {
    type: DataTypes.STRING,
    field: "employee_code_snapshot"
  },
  employeeNameSnapshot: {
    type: DataTypes.STRING,
    field: "employee_name_snapshot"
  },
  operatorSessionId: {
    type: DataTypes.STRING,
    field: "operator_session_id"
  },
  deviceSessionId: {
    type: DataTypes.STRING,
    field: "device_session_id"
  },
  verificationLevel: {
    type: DataTypes.INTEGER,
    field: "verification_level"
  },
  level2VerifiedAt: {
    type: DataTypes.DATE,
    field: "level_2_verified_at"
  },
  requiredPermission: {
    type: DataTypes.STRING,
    field: "required_permission"
  },
  requestedOperation: {
    type: DataTypes.STRING,
    field: "requested_operation"
  },
  authorizationResult: {
    type: DataTypes.STRING,
    field: "authorization_result"
  },
  authorizationFailureCode: {
    type: DataTypes.STRING,
    field: "authorization_failure_code"
  },
  operatorReason: {
    type: DataTypes.STRING,
    field: "operator_reason"
  },
  place: {
    type: DataTypes.STRING,
    allowNull: false
  },
  branch: {
    type: DataTypes.STRING
  },
  date: {
    type: DataTypes.STRING,
    allowNull: false
  },
  before: {
    type: DataTypes.TEXT
  },
  after: {
    type: DataTypes.TEXT
  },
  device: {
    type: DataTypes.STRING
  },
  correlationId: {
    type: DataTypes.STRING,
    field: "correlation_id"
  },
  sourceDocument: {
    type: DataTypes.STRING,
    field: "source_document"
  },
  severity: {
    type: DataTypes.ENUM("info", "warning", "critical"),
    defaultValue: "info"
  },
  // Tamper-evident hash chain: hash = sha256(prevHash + canonical(row)).
  hash: {
    type: DataTypes.STRING
  },
  prevHash: {
    type: DataTypes.STRING,
    field: "prev_hash"
  },
  hashVersion: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: "v2",
    field: "hash_version"
  }
}, {
  tableName: "audit_logs",
  timestamps: true,
  underscored: true,
  hooks: {
    // Defense in depth: audit logs are append-only. Block any mutation or
    // deletion at the ORM layer even if some code path attempts it.
    beforeUpdate: () => { throw new Error("Audit logs are immutable and cannot be updated."); },
    beforeBulkUpdate: () => { throw new Error("Audit logs are immutable and cannot be updated."); },
    beforeDestroy: () => { throw new Error("Audit logs are immutable and cannot be deleted."); },
    beforeBulkDestroy: () => { throw new Error("Audit logs are immutable and cannot be deleted."); }
  }
});

module.exports = AuditLog;
