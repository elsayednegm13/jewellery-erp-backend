"use strict";

/**
 * GOLD-LIVE-FEED-01 foundation only.
 * Additive schema: no business rows, no gold_prices changes, no provider secrets.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable("gold_market_quotes", {
        id: { type: Sequelize.STRING(128), primaryKey: true, allowNull: false },
        company_id: { type: Sequelize.STRING, allowNull: false, references: { model: "companies", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        provider: { type: Sequelize.STRING(32), allowNull: false },
        metal: { type: Sequelize.STRING(8), allowNull: false, defaultValue: "XAU" },
        currency: { type: Sequelize.STRING(3), allowNull: false },
        unit: { type: Sequelize.STRING(24), allowNull: false, defaultValue: "PER_GRAM" },
        base_purity: { type: Sequelize.DECIMAL(8, 4), allowNull: true },
        quote_timestamp: { type: Sequelize.DATE, allowNull: false },
        received_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
        spot: { type: Sequelize.DECIMAL(20, 8), allowNull: true },
        bid: { type: Sequelize.DECIMAL(20, 8), allowNull: true },
        ask: { type: Sequelize.DECIMAL(20, 8), allowNull: true },
        karat_18_rate: { type: Sequelize.DECIMAL(20, 8), allowNull: true },
        karat_21_rate: { type: Sequelize.DECIMAL(20, 8), allowNull: true },
        karat_22_rate: { type: Sequelize.DECIMAL(20, 8), allowNull: true },
        karat_24_rate: { type: Sequelize.DECIMAL(20, 8), allowNull: true },
        karat_rate_source: { type: Sequelize.STRING(32), allowNull: true },
        provider_quote_id: { type: Sequelize.STRING(128), allowNull: true },
        raw_payload_hash: { type: Sequelize.STRING(128), allowNull: true },
        status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: "VALID" },
        quality: { type: Sequelize.STRING(24), allowNull: true },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      }, { transaction });

      await queryInterface.sequelize.query(
        "ALTER TABLE gold_market_quotes ADD CONSTRAINT gold_market_quotes_metal_ck CHECK (metal = 'XAU')",
        { transaction },
      );
      await queryInterface.sequelize.query(
        "ALTER TABLE gold_market_quotes ADD CONSTRAINT gold_market_quotes_currency_ck CHECK (currency ~ '^[A-Z]{3}$')",
        { transaction },
      );
      await queryInterface.sequelize.query(
        "ALTER TABLE gold_market_quotes ADD CONSTRAINT gold_market_quotes_unit_ck CHECK (unit = 'PER_GRAM')",
        { transaction },
      );
      await queryInterface.sequelize.query(
        "ALTER TABLE gold_market_quotes ADD CONSTRAINT gold_market_quotes_status_ck CHECK (status IN ('VALID','STALE','INVALID','UNAVAILABLE'))",
        { transaction },
      );
      await queryInterface.sequelize.query(
        "ALTER TABLE gold_market_quotes ADD CONSTRAINT gold_market_quotes_positive_values_ck CHECK ((spot IS NULL OR spot > 0) AND (bid IS NULL OR bid > 0) AND (ask IS NULL OR ask > 0) AND (karat_18_rate IS NULL OR karat_18_rate > 0) AND (karat_21_rate IS NULL OR karat_21_rate > 0) AND (karat_22_rate IS NULL OR karat_22_rate > 0) AND (karat_24_rate IS NULL OR karat_24_rate > 0))",
        { transaction },
      );
      await queryInterface.sequelize.query(
        "ALTER TABLE gold_market_quotes ADD CONSTRAINT gold_market_quotes_quote_value_ck CHECK (spot IS NOT NULL OR bid IS NOT NULL OR ask IS NOT NULL OR karat_18_rate IS NOT NULL OR karat_21_rate IS NOT NULL OR karat_22_rate IS NOT NULL OR karat_24_rate IS NOT NULL)",
        { transaction },
      );

      await queryInterface.addIndex("gold_market_quotes", ["company_id", "provider", "currency", "metal", "quote_timestamp"], { name: "gold_market_quotes_latest_idx", transaction });
      await queryInterface.addIndex("gold_market_quotes", ["provider_quote_id"], { name: "gold_market_quotes_provider_quote_idx", where: { provider_quote_id: { [Sequelize.Op.ne]: null } }, transaction });
      await queryInterface.addIndex("gold_market_quotes", ["created_at"], { name: "gold_market_quotes_created_idx", transaction });
      await queryInterface.addIndex("gold_market_quotes", ["status"], { name: "gold_market_quotes_status_idx", transaction });
      await queryInterface.addIndex("gold_market_quotes", ["company_id", "provider", "provider_quote_id"], { unique: true, name: "gold_market_quotes_provider_identity_uq", where: { provider_quote_id: { [Sequelize.Op.ne]: null } }, transaction });
      await queryInterface.addIndex("gold_market_quotes", ["company_id", "provider", "raw_payload_hash", "quote_timestamp"], { unique: true, name: "gold_market_quotes_payload_identity_uq", where: { raw_payload_hash: { [Sequelize.Op.ne]: null } }, transaction });

      await queryInterface.createTable("gold_market_settings", {
        id: { type: Sequelize.STRING(128), primaryKey: true, allowNull: false },
        company_id: { type: Sequelize.STRING, allowNull: false, unique: true, references: { model: "companies", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        pricing_mode: { type: Sequelize.STRING(24), allowNull: false, defaultValue: "MANUAL_APPROVED" },
        active_provider: { type: Sequelize.STRING(32), allowNull: true },
        market_currency: { type: Sequelize.STRING(3), allowNull: false, defaultValue: "AED" },
        refresh_interval_seconds: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 30 },
        stale_after_seconds: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 120 },
        enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
        updated_by: { type: Sequelize.STRING, allowNull: true, references: { model: "users", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" },
        version: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      }, { transaction });
      await queryInterface.sequelize.query(
        "ALTER TABLE gold_market_settings ADD CONSTRAINT gold_market_settings_mode_ck CHECK (pricing_mode IN ('MANUAL_APPROVED','LIVE_PROVIDER'))",
        { transaction },
      );
      await queryInterface.sequelize.query(
        "ALTER TABLE gold_market_settings ADD CONSTRAINT gold_market_settings_provider_ck CHECK (active_provider IS NULL OR active_provider IN ('GOLDAPI_IO','METALS_API'))",
        { transaction },
      );
      await queryInterface.sequelize.query(
        "ALTER TABLE gold_market_settings ADD CONSTRAINT gold_market_settings_currency_ck CHECK (market_currency ~ '^[A-Z]{3}$')",
        { transaction },
      );
      await queryInterface.sequelize.query(
        "ALTER TABLE gold_market_settings ADD CONSTRAINT gold_market_settings_intervals_ck CHECK (refresh_interval_seconds > 0 AND stale_after_seconds > 0 AND stale_after_seconds >= refresh_interval_seconds)",
        { transaction },
      );
    });
  },

  async down() {
    throw new Error("NON_DESTRUCTIVE_FORWARD_ONLY: Gold live-feed foundation must not be rolled back automatically");
  },
};
