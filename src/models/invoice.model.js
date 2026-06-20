const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const Invoice = sequelize.define("Invoice", {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  companyId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "company_id"
  },
  type: {
    // "installment" added (TD-003) to match /pos/checkout which sets it when
    // paymentMethod === "installment". NOTE: the DB enum also carries a legacy
    // "giftVoucher" value (from an earlier migration) that NO route writes, so
    // it is intentionally NOT listed here.
    type: DataTypes.ENUM("sale", "return", "exchange", "deposit", "repair", "installment"),
    defaultValue: "sale"
  },
  customerId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "customer_id"
  },
  customerName: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "customer_name"
  },
  date: {
    type: DataTypes.STRING,
    allowNull: false
  },
  total: {
    type: DataTypes.DECIMAL(15, 4),
    allowNull: false,
    defaultValue: 0
  },
  tax: {
    type: DataTypes.DECIMAL(15, 4),
    allowNull: false,
    defaultValue: 0
  },
  vatRate: {
    // VAT percentage applied at the time of sale (e.g. 5, 14). Nullable for
    // historical rows created before this column existed.
    type: DataTypes.DECIMAL(6, 3),
    allowNull: true,
    field: "vat_rate"
  },
  subtotal: {
    type: DataTypes.DECIMAL(15, 4)
  },
  discount: {
    type: DataTypes.DECIMAL(15, 4),
    defaultValue: 0
  },
  makingCharge: {
    type: DataTypes.DECIMAL(15, 4),
    defaultValue: 0,
    field: "making_charge"
  },
  stoneValue: {
    type: DataTypes.DECIMAL(15, 4),
    defaultValue: 0,
    field: "stone_value"
  },
  deposit: {
    type: DataTypes.DECIMAL(15, 4),
    defaultValue: 0
  },
  // PAYMENT status (how much is paid). Do NOT use for lifecycle.
  status: {
    type: DataTypes.ENUM("paid", "partial", "due", "returned", "cancelled"),
    defaultValue: "due"
  },
  // LIFECYCLE status (draft → posted → cancelled). Separate from `status`.
  // Default 'posted' keeps every existing row + immediate-post path posted.
  // Only invoice lifecycle endpoints may change this (generic CRUD is blocked).
  postingStatus: {
    type: DataTypes.ENUM("draft", "posted", "cancelled"),
    allowNull: false,
    defaultValue: "posted",
    field: "posting_status"
  },
  paymentMethod: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "payment_method"
  },
  paymentSplits: {
    type: DataTypes.JSONB,
    field: "payment_splits",
    defaultValue: []
  },
  branch: {
    type: DataTypes.STRING,
    allowNull: false
  },
  branchId: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "branch_id"
  },
  paidAmount: {
    type: DataTypes.DECIMAL(15, 4),
    defaultValue: 0,
    field: "paid_amount"
  },
  remainingAmount: {
    type: DataTypes.DECIMAL(15, 4),
    defaultValue: 0,
    field: "remaining_amount"
  },
  downPayment: {
    type: DataTypes.DECIMAL(15, 4),
    defaultValue: 0,
    field: "down_payment"
  },
  installmentCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    field: "installment_count"
  },
  guarantorName: {
    type: DataTypes.STRING,
    field: "guarantor_name"
  },
  guarantorPhone: {
    type: DataTypes.STRING,
    field: "guarantor_phone"
  },
  installmentFrequency: {
    type: DataTypes.STRING,
    defaultValue: "monthly",
    field: "installment_frequency"
  },
  notes: {
    type: DataTypes.TEXT
  },
  relatedInvoiceId: {
    type: DataTypes.STRING,
    field: "related_invoice_id"
  },
  idempotencyKey: {
    type: DataTypes.STRING,
    field: "idempotency_key"
  },
  // Customer-facing sequential number (e.g. INV-2026-000010), SEPARATE from the
  // primary key `id`. NULL for drafts; assigned when the invoice becomes posted.
  invoiceNumber: {
    type: DataTypes.STRING,
    field: "invoice_number"
  },
  postedAt: {
    type: DataTypes.STRING,
    field: "posted_at"
  },
  cancelledAt: {
    type: DataTypes.STRING,
    field: "cancelled_at"
  },
  cancelReason: {
    type: DataTypes.STRING,
    field: "cancel_reason"
  }
}, {
  tableName: "invoices",
  timestamps: true,
  underscored: true,
  paranoid: true
});

module.exports = Invoice;
