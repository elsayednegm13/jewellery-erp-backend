const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const ManufacturingOrder = sequelize.define("ManufacturingOrder", {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  companyId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "company_id"
  },
  status: {
    type: DataTypes.ENUM("draft", "approved", "in-process", "completed", "cancelled"),
    defaultValue: "draft"
  },
  type: {
    type: DataTypes.ENUM("melting", "manufacturing", "conversion"),
    allowNull: false
  },
  inputAssets: {
    type: DataTypes.JSONB,
    allowNull: false,
    field: "input_assets",
    defaultValue: []
  },
  outputAssets: {
    type: DataTypes.JSONB,
    allowNull: false,
    field: "output_assets",
    defaultValue: []
  },
  expectedOutputWeight: {
    type: DataTypes.DECIMAL(10, 4),
    allowNull: false,
    field: "expected_output_weight"
  },
  actualOutputWeight: {
    type: DataTypes.DECIMAL(10, 4),
    field: "actual_output_weight"
  },
  processLoss: {
    type: DataTypes.DECIMAL(10, 4),
    field: "process_loss",
    defaultValue: 0
  },
  wastage: {
    type: DataTypes.DECIMAL(10, 4),
    defaultValue: 0
  },
  branch: {
    type: DataTypes.STRING,
    allowNull: false
  },
  notes: {
    type: DataTypes.TEXT
  },
  startedAt: {
    type: DataTypes.STRING,
    field: "started_at"
  },
  completedAt: {
    type: DataTypes.STRING,
    field: "completed_at"
  },
  createdBy: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "created_by"
  },
  approvedBy: {
    type: DataTypes.STRING,
    field: "approved_by"
  }
}, {
  tableName: "manufacturing_orders",
  timestamps: true,
  underscored: true
});

module.exports = ManufacturingOrder;
