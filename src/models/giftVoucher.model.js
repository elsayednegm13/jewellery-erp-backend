const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * Purchased Gift Voucher — a prepaid monetary obligation.  Its full face
 * value is consumed once through the canonical Sales Invoice settlement path.
 */
const GiftVoucher = sequelize.define("GiftVoucher", {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  companyId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "company_id"
  },
  voucherNumber: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "voucher_number",
  },
  voucherCode: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "voucher_code",
  },
  issueBranchId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "issue_branch_id",
  },
  voucherType: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "voucher_type",
  },
  fundingSource: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "funding_source",
  },
  faceValue: {
    type: DataTypes.DECIMAL(15, 4),
    allowNull: false,
    field: "face_value",
  },
  currency: {
    type: DataTypes.STRING(3),
    allowNull: false,
  },
  branchEligibilityMode: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "branch_eligibility_mode",
  },
  customerId: {
    type: DataTypes.STRING,
    field: "customer_id",
  },
  status: {
    type: DataTypes.ENUM("issued", "active", "distributed", "redeemed", "expired", "cancelled"),
    allowNull: false,
  },
  issuedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    field: "issued_at",
  },
  issuedByUserId: { type: DataTypes.STRING, field: "issued_by_user_id" },
  issuedByEmployeeId: { type: DataTypes.STRING, field: "issued_by_employee_id" },
  activatedAt: { type: DataTypes.DATE, field: "activated_at" },
  activatedByUserId: { type: DataTypes.STRING, field: "activated_by_user_id" },
  activatedByEmployeeId: { type: DataTypes.STRING, field: "activated_by_employee_id" },
  distributedAt: { type: DataTypes.DATE, field: "distributed_at" },
  redeemedAt: { type: DataTypes.DATE, field: "redeemed_at" },
  redeemedByUserId: { type: DataTypes.STRING, field: "redeemed_by_user_id" },
  redeemedByEmployeeId: { type: DataTypes.STRING, field: "redeemed_by_employee_id" },
  redemptionInvoiceId: { type: DataTypes.STRING, field: "redemption_invoice_id" },
  redemptionPaymentId: { type: DataTypes.STRING, field: "redemption_payment_id" },
}, {
  tableName: "gift_vouchers",
  timestamps: true,
  underscored: true
});

module.exports = GiftVoucher;
