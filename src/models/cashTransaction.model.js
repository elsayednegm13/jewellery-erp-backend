const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * CashTransaction — Treasury movements.
 *  - cash_in   : money received into a treasury account
 *  - cash_out  : money paid out of a treasury account
 *  - transfer  : move money between two treasury accounts
 *  - closing   : end-of-day reconciliation snapshot (opening/expected/actual)
 */
const CashTransaction = sequelize.define("CashTransaction", {
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
    type: DataTypes.ENUM("cash_in", "cash_out", "transfer", "closing"),
    allowNull: false,
    defaultValue: "cash_in"
  },
  // Treasury account affected: "cash" (Cash on Hand) or "bank" (Bank Accounts)
  account: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: "cash"
  },
  // Destination account for transfers ("cash" / "bank")
  toAccount: {
    type: DataTypes.STRING,
    field: "to_account"
  },
  amount: {
    type: DataTypes.DECIMAL(15, 4),
    allowNull: false,
    defaultValue: 0
  },
  // Free-text category / reason (e.g. "إيجار", "رواتب", "إيداع مالك")
  category: {
    type: DataTypes.STRING
  },
  // Optional explicit GL counter-account code; defaults applied by posting engine.
  counterAccountCode: {
    type: DataTypes.STRING,
    field: "counter_account_code"
  },
  description: {
    type: DataTypes.STRING
  },
  // Link to a source document (e.g. invoice id) when applicable.
  reference: {
    type: DataTypes.STRING
  },
  branch: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: "Main Branch"
  },
  branchId: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "branch_id"
  },
  date: {
    type: DataTypes.STRING,
    allowNull: false
  },
  createdBy: {
    type: DataTypes.STRING,
    field: "created_by"
  },
  status: {
    type: DataTypes.ENUM("posted", "draft", "approved"),
    defaultValue: "posted"
  },
  // Closing reconciliation fields (used when type = "closing")
  openingBalance: {
    type: DataTypes.DECIMAL(15, 4),
    field: "opening_balance"
  },
  expectedBalance: {
    type: DataTypes.DECIMAL(15, 4),
    field: "expected_balance"
  },
  actualBalance: {
    type: DataTypes.DECIMAL(15, 4),
    field: "actual_balance"
  },
  variance: {
    type: DataTypes.DECIMAL(15, 4),
    defaultValue: 0
  },
  // The auto-generated journal entry id (for cash_in/out/transfer).
  journalEntryId: {
    type: DataTypes.STRING,
    field: "journal_entry_id"
  },
  idempotencyKey: {
    type: DataTypes.STRING,
    field: "idempotency_key"
  }
}, {
  tableName: "cash_transactions",
  timestamps: true,
  underscored: true
});

module.exports = CashTransaction;
