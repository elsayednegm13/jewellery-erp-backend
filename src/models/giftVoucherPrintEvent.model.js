const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

// Printing is an auditable presentation event.  It never changes voucher
// identity, lifecycle, value, financial links, or accounting.
const GiftVoucherPrintEvent = sequelize.define("GiftVoucherPrintEvent", {
  id: { type: DataTypes.STRING, primaryKey: true },
  voucherId: { type: DataTypes.STRING, allowNull: false, field: "voucher_id" },
  companyId: { type: DataTypes.STRING, allowNull: false, field: "company_id" },
  branchId: { type: DataTypes.STRING, allowNull: false, field: "branch_id" },
  technicalUserId: { type: DataTypes.STRING, allowNull: true, field: "technical_user_id" },
  employeeId: { type: DataTypes.STRING, allowNull: true, field: "employee_id" },
  printKind: { type: DataTypes.ENUM("original", "reprint"), allowNull: false },
  printedAt: { type: DataTypes.DATE, allowNull: false, field: "printed_at" },
}, {
  tableName: "gift_voucher_print_events",
  timestamps: true,
  underscored: true,
  hooks: {
    beforeUpdate: () => { throw new Error("Gift Voucher print events are immutable."); },
    beforeBulkUpdate: () => { throw new Error("Gift Voucher print events are immutable."); },
    beforeDestroy: () => { throw new Error("Gift Voucher print events are immutable."); },
    beforeBulkDestroy: () => { throw new Error("Gift Voucher print events are immutable."); },
  },
});

module.exports = GiftVoucherPrintEvent;
