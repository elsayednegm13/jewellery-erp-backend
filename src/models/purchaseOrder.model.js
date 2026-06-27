const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const PurchaseOrder = sequelize.define("PurchaseOrder", {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  companyId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "company_id"
  },
  supplierId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "supplier_id"
  },
  supplierName: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "supplier_name"
  },
  status: {
    type: DataTypes.ENUM("draft", "sent", "partial", "received", "cancelled"),
    defaultValue: "draft"
  },
  date: {
    type: DataTypes.STRING,
    allowNull: false
  },
  expectedDate: {
    type: DataTypes.STRING,
    field: "expected_date"
  },
  receivedDate: {
    type: DataTypes.STRING,
    field: "received_date"
  },
  total: {
    type: DataTypes.DECIMAL(15, 4),
    allowNull: false,
    defaultValue: 0
  },
  // Phase 12F — header-level purchase VAT / RCM foundation. Forward-only: no
  // posting reads these yet (12G). Safe defaults reproduce today's behaviour.
  taxBase: {
    type: DataTypes.DECIMAL(15, 4),
    allowNull: false,
    defaultValue: 0,
    field: "tax_base"
  },
  vatRate: {
    type: DataTypes.DECIMAL(6, 3),
    allowNull: false,
    defaultValue: 0,
    field: "vat_rate"
  },
  inputVatAmount: {
    type: DataTypes.DECIMAL(15, 4),
    allowNull: false,
    defaultValue: 0,
    field: "input_vat_amount"
  },
  taxIncluded: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: "tax_included"
  },
  isRecoverable: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    field: "is_recoverable"
  },
  isRcm: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: "is_rcm"
  },
  rcmVatAmount: {
    type: DataTypes.DECIMAL(15, 4),
    allowNull: false,
    defaultValue: 0,
    field: "rcm_vat_amount"
  },
  rcmRate: {
    type: DataTypes.DECIMAL(6, 3),
    allowNull: false,
    defaultValue: 0,
    field: "rcm_rate"
  },
  branch: {
    type: DataTypes.STRING,
    allowNull: false
  },
  notes: {
    type: DataTypes.TEXT
  },
  isConsignment: {
    type: DataTypes.BOOLEAN,
    field: "is_consignment",
    defaultValue: false
  },
  idempotencyKey: {
    type: DataTypes.STRING,
    field: "idempotency_key"
  }
}, {
  tableName: "purchase_orders",
  timestamps: true,
  underscored: true,
  paranoid: true
});

module.exports = PurchaseOrder;
