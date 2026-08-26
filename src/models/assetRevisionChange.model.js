const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const AssetRevisionChange = sequelize.define("AssetRevisionChange", {
  id: { type: DataTypes.STRING, primaryKey: true },
  revisionId: { type: DataTypes.STRING, allowNull: false, field: "revision_id" },
  fieldKey: { type: DataTypes.STRING(120), allowNull: false, field: "field_key" },
  oldValue: { type: DataTypes.JSONB, allowNull: true, field: "old_value" },
  newValue: { type: DataTypes.JSONB, allowNull: true, field: "new_value" },
  valueType: { type: DataTypes.STRING(32), allowNull: false, field: "value_type" },
  authorityType: { type: DataTypes.STRING(40), allowNull: false, field: "authority_type" },
  dedicatedOperationReference: { type: DataTypes.STRING(255), allowNull: true, field: "dedicated_operation_reference" },
}, {
  tableName: "asset_revision_changes",
  timestamps: true,
  underscored: true,
});

module.exports = AssetRevisionChange;
