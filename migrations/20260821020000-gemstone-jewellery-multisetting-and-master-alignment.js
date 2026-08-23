"use strict";
const crypto = require("crypto");
const policy = require("../src/services/inventory-master-data-policy.service");

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable("asset_gemstone_component_settings", {
        id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
        component_id: { type: Sequelize.STRING, allowNull: false, references: { model: "asset_components", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        company_id: { type: Sequelize.STRING, allowNull: false, references: { model: "companies", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        master_data_id: { type: Sequelize.STRING, allowNull: false, references: { model: "profile_master_data", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        sequence: { type: Sequelize.INTEGER, allowNull: false },
        value_snapshot: { type: Sequelize.STRING(160), allowNull: false },
        label_snapshot: { type: Sequelize.STRING(160), allowNull: false },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      }, { transaction });
      await queryInterface.addConstraint("asset_gemstone_component_settings", { fields: ["component_id", "master_data_id"], type: "unique", name: "asset_gemstone_component_setting_uq", transaction });
      await queryInterface.addIndex("asset_gemstone_component_settings", ["company_id", "component_id", "sequence"], { name: "asset_gemstone_component_settings_scope_idx", transaction });

      const [companies] = await queryInterface.sequelize.query("SELECT id FROM companies", { transaction });
      const seeds = [
        ["GEMSTONE_NAME", policy.GEMSTONE_NAMES], ["GEMSTONE_TYPE", policy.GEMSTONE_TYPES], ["GEMSTONE_SHAPE", policy.GEMSTONE_SHAPES],
        ["GEMSTONE_COLOR", policy.GEMSTONE_COLORS], ["GEMSTONE_TONE", policy.GEMSTONE_TONES], ["GEMSTONE_TONE_LEVEL", policy.GEMSTONE_TONE_LEVELS],
        ["GEMSTONE_SATURATION", policy.GEMSTONE_SATURATIONS], ["GEMSTONE_OPTICAL_EFFECT", policy.GEMSTONE_OPTICAL_EFFECTS], ["GEMSTONE_ORIGIN", policy.GEMSTONE_ORIGINS],
      ];
      for (const company of companies) for (const [category, labels] of seeds) for (let index = 0; index < labels.length; index += 1) {
        const label = labels[index];
        await queryInterface.sequelize.query(`INSERT INTO profile_master_data
          (id,company_id,category_key,canonical_value,display_label,is_active,sort_order,created_at,updated_at)
          VALUES (:id,:companyId,:category,:value,:label,true,:sortOrder,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
          ON CONFLICT (company_id,category_key,canonical_value) DO NOTHING`, {
          replacements: { id: `PMD-${crypto.randomUUID().replaceAll("-", "").slice(0, 26)}`, companyId: company.id, category, value: label.toLocaleLowerCase("en-US"), label, sortOrder: index + 1 }, transaction,
        });
      }
    });
  },
  async down() { throw new Error("NON_DESTRUCTIVE_FORWARD_ONLY: Gem Stone settings and master data are historical evidence"); },
};
