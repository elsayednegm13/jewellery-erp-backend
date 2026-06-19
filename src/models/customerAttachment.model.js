const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const CustomerAttachment = sequelize.define("CustomerAttachment", {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  companyId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "company_id"
  },
  customerId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "customer_id"
  },
  fileName: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "file_name"
  },
  originalFileName: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "original_file_name"
  },
  mimeType: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "mime_type"
  },
  fileSize: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: "file_size"
  },
  fileUrl: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "file_url"
  },
  category: {
    type: DataTypes.STRING
  },
  uploadedBy: {
    type: DataTypes.STRING,
    field: "uploaded_by"
  },
  uploadedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    field: "uploaded_at"
  }
}, {
  tableName: "customer_attachments",
  timestamps: true,
  underscored: true
});

module.exports = CustomerAttachment;
