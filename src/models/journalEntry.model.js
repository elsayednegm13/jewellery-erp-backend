const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const JournalEntry = sequelize.define("JournalEntry", {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  companyId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "company_id"
  },
  branchId: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "branch_id"
  },
  description: {
    type: DataTypes.STRING,
    allowNull: false
  },
  date: {
    type: DataTypes.STRING,
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM("draft", "balanced", "posted", "pending", "reversed"),
    defaultValue: "draft"
  },
  amount: {
    type: DataTypes.DECIMAL(15, 4),
    allowNull: false,
    defaultValue: 0
  },
  totalDebit: {
    type: DataTypes.DECIMAL(15, 4),
    allowNull: false,
    defaultValue: 0,
    field: "total_debit"
  },
  totalCredit: {
    type: DataTypes.DECIMAL(15, 4),
    allowNull: false,
    defaultValue: 0,
    field: "total_credit"
  },
  sourceType: {
    type: DataTypes.STRING,
    field: "source_type"
  },
  sourceId: {
    type: DataTypes.STRING,
    field: "source_id"
  },
  postedBy: {
    type: DataTypes.STRING,
    field: "posted_by"
  },
  postedAt: {
    type: DataTypes.STRING,
    field: "posted_at"
  },
  reversalOf: {
    type: DataTypes.STRING,
    field: "reversal_of"
  }
}, {
  tableName: "journal_entries",
  timestamps: true,
  underscored: true
});

module.exports = JournalEntry;
