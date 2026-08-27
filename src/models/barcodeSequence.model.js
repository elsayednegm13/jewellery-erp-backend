const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const BarcodeSequence = sequelize.define("BarcodeSequence", {
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  companyId: { type: DataTypes.STRING, allowNull: false, field: "company_id" },
  inventoryCode: { type: DataTypes.STRING(6), allowNull: false, field: "inventory_code" },
  itemCode: { type: DataTypes.STRING(6), allowNull: false, field: "item_code" },
  karatCode: { type: DataTypes.STRING(2), allowNull: false, field: "karat_code" },
  lastSerial: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "last_serial" },
}, {
  tableName: "barcode_sequences",
  timestamps: true,
  underscored: true,
  indexes: [{ unique: true, fields: ["company_id", "inventory_code", "item_code", "karat_code"] }],
});

module.exports = BarcodeSequence;
