const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const Notification = sequelize.define("Notification", {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  companyId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "company_id"
  },
  userId: {
    type: DataTypes.STRING,
    field: "user_id"
  },
  roleId: {
    type: DataTypes.STRING,
    field: "role_id"
  },
  title: {
    type: DataTypes.STRING,
    allowNull: false
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  type: {
    type: DataTypes.ENUM("info", "success", "warning", "error", "approval", "system"),
    defaultValue: "info"
  },
  entityType: {
    type: DataTypes.STRING,
    field: "entity_type"
  },
  entityId: {
    type: DataTypes.STRING,
    field: "entity_id"
  },
  isRead: {
    type: DataTypes.BOOLEAN,
    field: "is_read",
    defaultValue: false
  },
  readAt: {
    type: DataTypes.DATE,
    field: "read_at"
  }
}, {
  tableName: "notifications",
  timestamps: true,
  underscored: true
});

module.exports = Notification;
