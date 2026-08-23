const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const AssetCertificate = sequelize.define("AssetCertificate", {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  assetId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "asset_id"
  },
  type: {
    type: DataTypes.STRING,
    allowNull: false
  },
  issuer: {
    type: DataTypes.STRING,
    allowNull: false
  },
  issueDate: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "issue_date"
  },
  expiryDate: {
    type: DataTypes.STRING,
    field: "expiry_date"
  },
  certificateNumber: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "certificate_number"
  },
  url: {
    type: DataTypes.STRING
  }
}, {
  tableName: "asset_certificates",
  timestamps: true,
  underscored: true
});

module.exports = AssetCertificate;
