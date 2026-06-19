const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const Supplier = sequelize.define("Supplier", {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  companyId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "company_id"
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  category: {
    type: DataTypes.STRING,
    allowNull: false
  },
  phone: {
    type: DataTypes.STRING,
    allowNull: false
  },
  email: {
    type: DataTypes.STRING
  },
  due: {
    type: DataTypes.DECIMAL(15, 4),
    defaultValue: 0,
    allowNull: false
  },
  lastOrder: {
    type: DataTypes.STRING,
    field: "last_order"
  },
  rating: {
    type: DataTypes.DECIMAL(3, 2),
    defaultValue: 5.0
  },
  status: {
    type: DataTypes.ENUM("active", "inactive"),
    defaultValue: "active"
  },
  address: {
    type: DataTypes.TEXT
  },
  country: {
    type: DataTypes.STRING
  },
  taxNumber: {
    type: DataTypes.STRING,
    field: "tax_number"
  },
  commercialRegister: {
    type: DataTypes.STRING,
    field: "commercial_register"
  },
  paymentTerms: {
    type: DataTypes.STRING,
    field: "payment_terms"
  },
  notes: {
    type: DataTypes.TEXT
  },
  isConsignment: {
    type: DataTypes.BOOLEAN,
    field: "is_consignment",
    defaultValue: false
  }
}, {
  tableName: "suppliers",
  timestamps: true,
  underscored: true,
  paranoid: true
});

module.exports = Supplier;
