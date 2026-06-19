const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const JournalLine = sequelize.define("JournalLine", {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  journalEntryId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "journal_entry_id"
  },
  accountId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "account_id"
  },
  accountCode: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "account_code"
  },
  accountName: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "account_name"
  },
  debit: {
    type: DataTypes.DECIMAL(15, 4),
    allowNull: false,
    defaultValue: 0
  },
  credit: {
    type: DataTypes.DECIMAL(15, 4),
    allowNull: false,
    defaultValue: 0
  },
  description: {
    type: DataTypes.STRING
  }
}, {
  tableName: "journal_lines",
  timestamps: true,
  underscored: true
});

module.exports = JournalLine;
