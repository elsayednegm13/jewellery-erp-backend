const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

// Server-owned selected-branch eligibility for a Gift Voucher.  ALL_BRANCHES
// needs no row; SELECTED_BRANCHES must have one row for each eligible branch.
const GiftVoucherBranchEligibility = sequelize.define("GiftVoucherBranchEligibility", {
  voucherId: {
    type: DataTypes.STRING,
    primaryKey: true,
    field: "voucher_id",
  },
  branchId: {
    type: DataTypes.STRING,
    primaryKey: true,
    field: "branch_id",
  },
}, {
  tableName: "gift_voucher_branch_eligibilities",
  timestamps: true,
  underscored: true,
});

module.exports = GiftVoucherBranchEligibility;
