const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const SupplierDocument = sequelize.define("SupplierDocument", {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  supplierId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "supplier_id"
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  type: {
    type: DataTypes.STRING,
    allowNull: false
  },
  expiryDate: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "expiry_date"
  },
  url: {
    type: DataTypes.STRING
  },
  fileName: {
    type: DataTypes.STRING,
    field: "file_name"
  },
  originalFileName: {
    type: DataTypes.STRING,
    field: "original_file_name"
  },
  mimeType: {
    type: DataTypes.STRING,
    field: "mime_type"
  },
  fileSize: {
    type: DataTypes.INTEGER,
    field: "file_size"
  },
  uploadedBy: {
    type: DataTypes.STRING,
    field: "uploaded_by"
  },
  uploadedAt: {
    type: DataTypes.DATE,
    field: "uploaded_at"
  }
}, {
  tableName: "supplier_documents",
  timestamps: true,
  underscored: true
});

module.exports = SupplierDocument;
