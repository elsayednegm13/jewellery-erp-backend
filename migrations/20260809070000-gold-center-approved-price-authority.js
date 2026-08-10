"use strict";

const { DataTypes } = require("sequelize");
const { GOLD_PRICE_APPROVAL_PERMISSION } = require("../src/bootstrap/gold-price-approval-permission-catalog");

const TABLE = "gold_prices";
const STATUS_CHECK = "gold_prices_approval_status_ck";
const WINDOW_CHECK = "gold_prices_validity_window_ck";
const CURRENT_APPROVED_INDEX = "gold_prices_one_current_approved_uq";

module.exports = {
  async up(queryInterface) {
    await queryInterface.addColumn(TABLE, "approval_status", { type: DataTypes.STRING(24), allowNull: false, defaultValue: "PENDING" });
    await queryInterface.addColumn(TABLE, "approved_at", { type: DataTypes.DATE, allowNull: true });
    await queryInterface.addColumn(TABLE, "approved_by", { type: DataTypes.STRING, allowNull: true, references: { model: "users", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" });
    await queryInterface.addColumn(TABLE, "valid_from", { type: DataTypes.DATE, allowNull: true });
    await queryInterface.addColumn(TABLE, "valid_until", { type: DataTypes.DATE, allowNull: true });
    await queryInterface.addColumn(TABLE, "approval_version", { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 });
    await queryInterface.sequelize.query(`ALTER TABLE ${TABLE} ADD CONSTRAINT ${STATUS_CHECK} CHECK (approval_status IN ('PENDING','APPROVED','REJECTED','EXPIRED','VOIDED','SUPERSEDED'))`);
    await queryInterface.sequelize.query(`ALTER TABLE ${TABLE} ADD CONSTRAINT ${WINDOW_CHECK} CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_until > valid_from)`);
    await queryInterface.sequelize.query(`CREATE UNIQUE INDEX ${CURRENT_APPROVED_INDEX} ON ${TABLE} (company_id, karat, currency) WHERE approval_status = 'APPROVED'`);
    await queryInterface.addColumn("cgp_pricing_snapshots", "approved_price_id", { type: DataTypes.INTEGER, allowNull: true, references: { model: TABLE, key: "id" }, onUpdate: "RESTRICT", onDelete: "RESTRICT" });
    await queryInterface.addColumn("cgp_pricing_snapshots", "approved_price_status", { type: DataTypes.STRING(24), allowNull: true });
    await queryInterface.addColumn("cgp_pricing_snapshots", "approved_price_at", { type: DataTypes.DATE, allowNull: true });
    await queryInterface.addColumn("cgp_pricing_snapshots", "approved_price_by", { type: DataTypes.STRING, allowNull: true, references: { model: "users", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" });
    await queryInterface.addColumn("cgp_pricing_snapshots", "approved_price_source", { type: DataTypes.STRING(64), allowNull: true });
    await queryInterface.sequelize.query(`
      INSERT INTO permissions (id, name, module, action, description, created_at, updated_at)
      VALUES (:id, :name, :module, :action, :description, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (name) DO NOTHING
    `, { replacements: { id: `PERM-${GOLD_PRICE_APPROVAL_PERMISSION.name}`, ...GOLD_PRICE_APPROVAL_PERMISSION } });
  },
  async down(queryInterface) {
    const [used] = await queryInterface.sequelize.query(`SELECT count(*)::int AS count FROM ${TABLE} WHERE approval_status = 'APPROVED'`);
    if (Number(used?.[0]?.count || 0) > 0) throw new Error("Gold price approval rollback is unsafe after approved executable prices exist");
    await queryInterface.sequelize.query(`DELETE FROM permissions WHERE name=:name AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.permission_id=permissions.id) AND NOT EXISTS (SELECT 1 FROM employee_permission_grants epg WHERE epg.permission_id=permissions.id)`, { replacements: { name: GOLD_PRICE_APPROVAL_PERMISSION.name } });
    await queryInterface.removeIndex(TABLE, CURRENT_APPROVED_INDEX);
    for (const column of ["approved_price_source", "approved_price_by", "approved_price_at", "approved_price_status", "approved_price_id"]) await queryInterface.removeColumn("cgp_pricing_snapshots", column);
    await queryInterface.sequelize.query(`ALTER TABLE ${TABLE} DROP CONSTRAINT ${WINDOW_CHECK}`);
    await queryInterface.sequelize.query(`ALTER TABLE ${TABLE} DROP CONSTRAINT ${STATUS_CHECK}`);
    for (const column of ["approval_version", "valid_until", "valid_from", "approved_by", "approved_at", "approval_status"]) await queryInterface.removeColumn(TABLE, column);
  },
};
