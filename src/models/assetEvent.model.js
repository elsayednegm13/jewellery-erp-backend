const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const AssetEvent = sequelize.define("AssetEvent", {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  assetId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "asset_id"
  },
  action: {
    type: DataTypes.STRING,
    allowNull: false
  },
  date: {
    type: DataTypes.STRING,
    allowNull: false
  },
  user: {
    type: DataTypes.STRING,
    allowNull: false
  },
  branch: {
    type: DataTypes.STRING,
    allowNull: false
  },
  note: {
    type: DataTypes.TEXT
  },
  device: {
    type: DataTypes.STRING
  },
  reason: {
    type: DataTypes.STRING
  },
  sourceDocument: {
    type: DataTypes.STRING,
    field: "source_document"
  },
  beforeState: {
    type: DataTypes.STRING,
    field: "before_state"
  },
  afterState: {
    type: DataTypes.STRING,
    field: "after_state"
  },
  correlationId: {
    type: DataTypes.STRING,
    field: "correlation_id"
  },
  severity: {
    type: DataTypes.ENUM("info", "warning", "critical"),
    defaultValue: "info"
  }
}, {
  tableName: "asset_events",
  timestamps: true,
  underscored: true
});

module.exports = AssetEvent;
