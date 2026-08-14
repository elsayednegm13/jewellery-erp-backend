const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const AssetAttachment = sequelize.define("AssetAttachment", {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  assetId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "asset_id"
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  type: {
    type: DataTypes.STRING,
    allowNull: false
  },
  url: {
    type: DataTypes.STRING
  },
  uploadedAt: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "uploaded_at"
  },
  uploadedBy: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "uploaded_by"
  }
}, {
  tableName: "asset_attachments",
  timestamps: true,
  underscored: true
});

module.exports = AssetAttachment;
