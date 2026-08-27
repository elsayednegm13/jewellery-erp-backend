"use strict";

/** GOLD-LIVE-FEED-04: nullable, mode-aware live pricing lineage. */
const { DataTypes } = require("sequelize");

const TABLE = "cgp_pricing_snapshots";
const COLUMNS = {
  pricing_mode: { type: DataTypes.STRING(24), allowNull: true },
  provider: { type: DataTypes.STRING(32), allowNull: true },
  market_quote_id: { type: DataTypes.STRING(128), allowNull: true, references: { model: "gold_market_quotes", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
  provider_quote_id: { type: DataTypes.STRING(128), allowNull: true },
  market_quote_timestamp: { type: DataTypes.DATE, allowNull: true },
  market_received_at: { type: DataTypes.DATE, allowNull: true },
  quote_currency: { type: DataTypes.STRING(3), allowNull: true },
  quote_unit: { type: DataTypes.STRING(24), allowNull: true },
  base_quote_type: { type: DataTypes.STRING(8), allowNull: true },
  base_market_rate: { type: DataTypes.DECIMAL(20, 8), allowNull: true },
  karat_market_rate: { type: DataTypes.DECIMAL(20, 8), allowNull: true },
  adjustment_type: { type: DataTypes.STRING(24), allowNull: true },
  adjustment_value: { type: DataTypes.DECIMAL(20, 8), allowNull: true },
  policy_id: { type: DataTypes.STRING(128), allowNull: true, references: { model: "gold_pricing_policies", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
  policy_version: { type: DataTypes.INTEGER, allowNull: true },
  policy_scope: { type: DataTypes.STRING(16), allowNull: true },
  final_effective_rate: { type: DataTypes.DECIMAL(20, 4), allowNull: true },
  calculated_at: { type: DataTypes.DATE, allowNull: true },
  rate_precision: { type: DataTypes.JSONB, allowNull: true },
  derivation_method: { type: DataTypes.STRING(64), allowNull: true },
};

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      for (const [column, definition] of Object.entries(COLUMNS)) {
        await queryInterface.addColumn(TABLE, column, definition, { transaction });
      }
      await queryInterface.sequelize.query(`
        ALTER TABLE ${TABLE}
        ADD CONSTRAINT cgp_pricing_snapshots_live_mode_ck CHECK (
          pricing_mode IS NULL OR pricing_mode IN ('MANUAL_APPROVED','LIVE_PROVIDER')
        ),
        ADD CONSTRAINT cgp_pricing_snapshots_live_quote_type_ck CHECK (
          base_quote_type IS NULL OR base_quote_type IN ('BID','SPOT','ASK')
        ),
        ADD CONSTRAINT cgp_pricing_snapshots_live_adjustment_ck CHECK (
          adjustment_type IS NULL OR adjustment_type IN ('NONE','FIXED_PER_GRAM','PERCENTAGE')
        ),
        ADD CONSTRAINT cgp_pricing_snapshots_live_unit_ck CHECK (
          quote_unit IS NULL OR quote_unit = 'PER_GRAM'
        ),
        ADD CONSTRAINT cgp_pricing_snapshots_live_lineage_ck CHECK (
          pricing_mode IS NULL OR pricing_mode = 'MANUAL_APPROVED' OR
          (provider IS NOT NULL AND market_quote_id IS NOT NULL AND policy_id IS NOT NULL AND
           final_effective_rate IS NOT NULL AND calculated_at IS NOT NULL)
        )
      `, { transaction });
      await queryInterface.addIndex(TABLE, ["market_quote_id"], { name: "cgp_pricing_snapshots_market_quote_idx", transaction });
      await queryInterface.addIndex(TABLE, ["policy_id", "policy_version"], { name: "cgp_pricing_snapshots_policy_idx", transaction });
    });
  },

  async down() {
    throw new Error("NON_DESTRUCTIVE_FORWARD_ONLY: live pricing snapshot lineage must not be rolled back automatically");
  },
};
