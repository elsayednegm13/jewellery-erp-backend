"use strict";

/*
 * Purchased Gift Voucher foundation.
 *
 * This migration is intentionally allowed only when the legacy voucher table
 * is empty.  It must never fabricate code, currency, branch eligibility,
 * activation history, or financial provenance for an existing voucher.
 */

const STATUS_TYPE = "enum_gift_vouchers_lifecycle_status";
const IDENTITY_FUNCTION = "gift_voucher_identity_immutable";
const DELETE_FUNCTION = "gift_voucher_delete_forbidden";

async function assertLegacyGiftVoucherTableEmpty(queryInterface, transaction) {
  const [rows] = await queryInterface.sequelize.query(
    "SELECT COUNT(*)::int AS count FROM gift_vouchers",
    { transaction }
  );
  if (Number(rows?.[0]?.count || 0) !== 0) {
    throw new Error("GIFT_VOUCHER_LEGACY_DATA_MIGRATION_REQUIRED");
  }
}

async function createLegacyGiftVoucherTable(queryInterface, Sequelize, transaction) {
  await queryInterface.createTable("gift_vouchers", {
    id: { type: Sequelize.STRING, primaryKey: true },
    company_id: {
      type: Sequelize.STRING,
      allowNull: false,
      references: { model: "companies", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    code: { type: Sequelize.STRING, allowNull: false },
    value: { type: Sequelize.DECIMAL(15, 4), allowNull: false, defaultValue: 0 },
    balance: { type: Sequelize.DECIMAL(15, 4), allowNull: false, defaultValue: 0 },
    customer_id: { type: Sequelize.STRING },
    customer_name: { type: Sequelize.STRING },
    status: { type: Sequelize.ENUM("active", "redeemed", "expired"), defaultValue: "active" },
    issue_date: { type: Sequelize.STRING, allowNull: false },
    expiry_date: { type: Sequelize.STRING },
    payment_method: { type: Sequelize.STRING },
    branch: { type: Sequelize.STRING },
    created_at: { type: Sequelize.DATE, allowNull: false },
    updated_at: { type: Sequelize.DATE, allowNull: false },
  }, { transaction });
  await queryInterface.addIndex("gift_vouchers", ["company_id"], { transaction });
  await queryInterface.addIndex("gift_vouchers", ["code"], { transaction });
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      await assertLegacyGiftVoucherTableEmpty(queryInterface, transaction);

      await queryInterface.renameColumn("gift_vouchers", "code", "voucher_code", { transaction });
      await queryInterface.renameColumn("gift_vouchers", "value", "face_value", { transaction });
      // The legacy, non-unique code index is replaced by the global immutable
      // identity constraint below. Keeping both indexes obscures the actual
      // authority and does not add safety.
      await queryInterface.removeIndex("gift_vouchers", "gift_vouchers_code", { transaction });
      await queryInterface.removeColumn("gift_vouchers", "balance", { transaction });
      await queryInterface.removeColumn("gift_vouchers", "customer_name", { transaction });
      await queryInterface.removeColumn("gift_vouchers", "issue_date", { transaction });
      await queryInterface.removeColumn("gift_vouchers", "expiry_date", { transaction });
      await queryInterface.removeColumn("gift_vouchers", "payment_method", { transaction });
      await queryInterface.removeColumn("gift_vouchers", "branch", { transaction });

      await queryInterface.sequelize.query("ALTER TABLE gift_vouchers ALTER COLUMN status DROP DEFAULT", { transaction });
      await queryInterface.sequelize.query(`CREATE TYPE ${STATUS_TYPE} AS ENUM ('issued', 'active', 'distributed', 'redeemed', 'expired', 'cancelled')`, { transaction });
      await queryInterface.sequelize.query(`
        ALTER TABLE gift_vouchers
          ALTER COLUMN status TYPE ${STATUS_TYPE}
          USING CASE status::text
            WHEN 'active' THEN 'active'::${STATUS_TYPE}
            WHEN 'redeemed' THEN 'redeemed'::${STATUS_TYPE}
            WHEN 'expired' THEN 'expired'::${STATUS_TYPE}
            ELSE 'issued'::${STATUS_TYPE}
          END,
          ALTER COLUMN status SET NOT NULL,
          ALTER COLUMN status SET DEFAULT 'issued'::${STATUS_TYPE};
        DROP TYPE enum_gift_vouchers_status;
      `, { transaction });

      await queryInterface.addColumn("gift_vouchers", "voucher_number", { type: Sequelize.STRING, allowNull: false }, { transaction });
      await queryInterface.addColumn("gift_vouchers", "issue_branch_id", {
        type: Sequelize.STRING,
        allowNull: false,
        references: { model: "branches", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      }, { transaction });
      await queryInterface.addColumn("gift_vouchers", "voucher_type", { type: Sequelize.STRING, allowNull: false }, { transaction });
      await queryInterface.addColumn("gift_vouchers", "funding_source", { type: Sequelize.STRING, allowNull: false }, { transaction });
      await queryInterface.addColumn("gift_vouchers", "currency", { type: Sequelize.STRING(3), allowNull: false }, { transaction });
      await queryInterface.addColumn("gift_vouchers", "branch_eligibility_mode", { type: Sequelize.STRING, allowNull: false }, { transaction });
      await queryInterface.addColumn("gift_vouchers", "issued_at", { type: Sequelize.DATE, allowNull: false }, { transaction });
      await queryInterface.addColumn("gift_vouchers", "issued_by_user_id", {
        type: Sequelize.STRING,
        allowNull: true,
        references: { model: "users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      }, { transaction });
      await queryInterface.addColumn("gift_vouchers", "issued_by_employee_id", {
        type: Sequelize.STRING,
        allowNull: true,
        references: { model: "employees", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      }, { transaction });
      await queryInterface.addColumn("gift_vouchers", "activated_at", { type: Sequelize.DATE, allowNull: true }, { transaction });
      await queryInterface.addColumn("gift_vouchers", "activated_by_user_id", { type: Sequelize.STRING, allowNull: true, references: { model: "users", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" }, { transaction });
      await queryInterface.addColumn("gift_vouchers", "activated_by_employee_id", { type: Sequelize.STRING, allowNull: true, references: { model: "employees", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" }, { transaction });
      await queryInterface.addColumn("gift_vouchers", "distributed_at", { type: Sequelize.DATE, allowNull: true }, { transaction });
      await queryInterface.addColumn("gift_vouchers", "redeemed_at", { type: Sequelize.DATE, allowNull: true }, { transaction });
      await queryInterface.addColumn("gift_vouchers", "redeemed_by_user_id", { type: Sequelize.STRING, allowNull: true, references: { model: "users", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" }, { transaction });
      await queryInterface.addColumn("gift_vouchers", "redeemed_by_employee_id", { type: Sequelize.STRING, allowNull: true, references: { model: "employees", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" }, { transaction });
      await queryInterface.addColumn("gift_vouchers", "redemption_invoice_id", { type: Sequelize.STRING, allowNull: true, references: { model: "invoices", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" }, { transaction });
      await queryInterface.addColumn("gift_vouchers", "redemption_payment_id", { type: Sequelize.STRING, allowNull: true, references: { model: "payments", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" }, { transaction });

      await queryInterface.changeColumn("gift_vouchers", "customer_id", {
        type: Sequelize.STRING,
        allowNull: true,
        references: { model: "customers", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      }, { transaction });

      await queryInterface.addIndex("gift_vouchers", ["voucher_code"], { unique: true, name: "gift_vouchers_voucher_code_uq", transaction });
      await queryInterface.addIndex("gift_vouchers", ["voucher_number"], { unique: true, name: "gift_vouchers_voucher_number_uq", transaction });
      await queryInterface.addIndex("gift_vouchers", ["company_id", "status"], { name: "gift_vouchers_company_status_idx", transaction });
      await queryInterface.addIndex("gift_vouchers", ["redemption_invoice_id"], { name: "gift_vouchers_redemption_invoice_idx", transaction });
      await queryInterface.addIndex("gift_vouchers", ["redemption_payment_id"], { unique: true, name: "gift_vouchers_redemption_payment_uq", transaction });

      await queryInterface.createTable("gift_voucher_branch_eligibilities", {
        voucher_id: { type: Sequelize.STRING, allowNull: false, primaryKey: true, references: { model: "gift_vouchers", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE" },
        branch_id: { type: Sequelize.STRING, allowNull: false, primaryKey: true, references: { model: "branches", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        created_at: { type: Sequelize.DATE, allowNull: false },
        updated_at: { type: Sequelize.DATE, allowNull: false },
      }, { transaction });
      await queryInterface.addIndex("gift_voucher_branch_eligibilities", ["branch_id", "voucher_id"], { name: "gift_voucher_branch_eligibility_branch_idx", transaction });

      await queryInterface.addColumn("payments", "gift_voucher_id", {
        type: Sequelize.STRING,
        allowNull: true,
        references: { model: "gift_vouchers", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      }, { transaction });
      await queryInterface.addIndex("payments", ["gift_voucher_id"], { unique: true, name: "payments_gift_voucher_uq", transaction });

      await queryInterface.createTable("gift_voucher_print_events", {
        id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
        voucher_id: { type: Sequelize.STRING, allowNull: false, references: { model: "gift_vouchers", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        company_id: { type: Sequelize.STRING, allowNull: false, references: { model: "companies", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        branch_id: { type: Sequelize.STRING, allowNull: false, references: { model: "branches", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        technical_user_id: { type: Sequelize.STRING, allowNull: true, references: { model: "users", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" },
        employee_id: { type: Sequelize.STRING, allowNull: true, references: { model: "employees", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" },
        print_kind: { type: Sequelize.ENUM("original", "reprint"), allowNull: false },
        printed_at: { type: Sequelize.DATE, allowNull: false },
        created_at: { type: Sequelize.DATE, allowNull: false },
        updated_at: { type: Sequelize.DATE, allowNull: false },
      }, { transaction });
      await queryInterface.addIndex("gift_voucher_print_events", ["voucher_id", "printed_at"], { name: "gift_voucher_print_events_voucher_idx", transaction });

      await queryInterface.sequelize.query(`
        ALTER TABLE gift_vouchers
          ADD CONSTRAINT gift_vouchers_code_nonempty_ck CHECK (btrim(voucher_code) <> '' AND btrim(voucher_number) <> ''),
          ADD CONSTRAINT gift_vouchers_face_value_positive_ck CHECK (face_value > 0),
          ADD CONSTRAINT gift_vouchers_type_ck CHECK (voucher_type IN ('PURCHASED_GIFT_VOUCHER')),
          ADD CONSTRAINT gift_vouchers_funding_ck CHECK (funding_source IN ('PURCHASED','PROMOTIONAL','LOYALTY','COMPENSATION','CORPORATE','MANUAL')),
          ADD CONSTRAINT gift_vouchers_eligibility_ck CHECK (branch_eligibility_mode IN ('ALL_BRANCHES','SELECTED_BRANCHES')),
          ADD CONSTRAINT gift_vouchers_redeemed_link_ck CHECK (
            status <> 'redeemed' OR (redeemed_at IS NOT NULL AND redemption_invoice_id IS NOT NULL AND redemption_payment_id IS NOT NULL)
          );

        CREATE OR REPLACE FUNCTION ${IDENTITY_FUNCTION}()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          IF NEW.voucher_number IS DISTINCT FROM OLD.voucher_number
            OR NEW.voucher_code IS DISTINCT FROM OLD.voucher_code
            OR NEW.company_id IS DISTINCT FROM OLD.company_id
            OR NEW.voucher_type IS DISTINCT FROM OLD.voucher_type
            OR NEW.funding_source IS DISTINCT FROM OLD.funding_source
            OR NEW.face_value IS DISTINCT FROM OLD.face_value
            OR NEW.currency IS DISTINCT FROM OLD.currency
            OR NEW.issue_branch_id IS DISTINCT FROM OLD.issue_branch_id
            OR NEW.issued_at IS DISTINCT FROM OLD.issued_at THEN
            RAISE EXCEPTION 'Gift Voucher identity and face value are immutable';
          END IF;
          RETURN NEW;
        END;
        $$;

        CREATE TRIGGER gift_vouchers_identity_immutable_trg
          BEFORE UPDATE ON gift_vouchers
          FOR EACH ROW EXECUTE FUNCTION ${IDENTITY_FUNCTION}();

        CREATE OR REPLACE FUNCTION ${DELETE_FUNCTION}()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          RAISE EXCEPTION 'Gift Voucher rows are retained for identity history';
        END;
        $$;

        CREATE TRIGGER gift_vouchers_delete_forbidden_trg
          BEFORE DELETE ON gift_vouchers
          FOR EACH ROW EXECUTE FUNCTION ${DELETE_FUNCTION}();
      `, { transaction });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      const [rows] = await queryInterface.sequelize.query(`
        SELECT
          (SELECT COUNT(*)::int FROM gift_vouchers) AS vouchers,
          (SELECT COUNT(*)::int FROM gift_voucher_branch_eligibilities) AS eligibility,
          (SELECT COUNT(*)::int FROM gift_voucher_print_events) AS print_events,
          (SELECT COUNT(*)::int FROM payments WHERE gift_voucher_id IS NOT NULL) AS linked_payments
      `, { transaction });
      const counts = rows?.[0] || {};
      if ([counts.vouchers, counts.eligibility, counts.print_events, counts.linked_payments].some((value) => Number(value || 0) !== 0)) {
        throw new Error("GIFT_VOUCHER_DOWN_REQUIRES_EMPTY_DISPOSABLE_SCHEMA");
      }

      await queryInterface.sequelize.query("DROP TRIGGER IF EXISTS gift_vouchers_delete_forbidden_trg ON gift_vouchers", { transaction });
      await queryInterface.sequelize.query("DROP TRIGGER IF EXISTS gift_vouchers_identity_immutable_trg ON gift_vouchers", { transaction });
      await queryInterface.sequelize.query(`DROP FUNCTION IF EXISTS ${DELETE_FUNCTION}()`, { transaction });
      await queryInterface.sequelize.query(`DROP FUNCTION IF EXISTS ${IDENTITY_FUNCTION}()`, { transaction });
      await queryInterface.dropTable("gift_voucher_print_events", { transaction });
      await queryInterface.sequelize.query("DROP TYPE IF EXISTS enum_gift_voucher_print_events_print_kind", { transaction });
      await queryInterface.removeIndex("payments", "payments_gift_voucher_uq", { transaction });
      await queryInterface.removeColumn("payments", "gift_voucher_id", { transaction });
      await queryInterface.dropTable("gift_voucher_branch_eligibilities", { transaction });
      await queryInterface.dropTable("gift_vouchers", { transaction });
      await queryInterface.sequelize.query(`DROP TYPE IF EXISTS ${STATUS_TYPE}`, { transaction });
      await createLegacyGiftVoucherTable(queryInterface, Sequelize, transaction);
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
