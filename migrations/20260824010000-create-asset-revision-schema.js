"use strict";

/**
 * C2B only: additive storage contract for future Asset revisions.
 *
 * This migration deliberately creates storage and database backstops only.
 * It does not expose a command, mutate Assets, emit business events, or
 * backfill historical revisions. C2C owns the future service/API contract.
 */

const REVISION_IMMUTABILITY_FUNCTION = "asset_revision_history_immutable";

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.createTable("asset_revisions", {
        id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
        asset_id: {
          type: Sequelize.STRING,
          allowNull: false,
          references: { model: "assets", key: "id" },
          onUpdate: "CASCADE",
          onDelete: "RESTRICT"
        },
        company_id: {
          type: Sequelize.STRING,
          allowNull: false,
          references: { model: "companies", key: "id" },
          onUpdate: "CASCADE",
          onDelete: "RESTRICT"
        },
        branch_id: {
          type: Sequelize.STRING,
          allowNull: true,
          references: { model: "branches", key: "id" },
          onUpdate: "CASCADE",
          onDelete: "SET NULL"
        },
        revision_no: { type: Sequelize.INTEGER, allowNull: false },
        reason: { type: Sequelize.TEXT, allowNull: false },
        source_operation: { type: Sequelize.STRING(120), allowNull: false },
        source_reference: { type: Sequelize.STRING(255), allowNull: true },
        technical_user_id: {
          type: Sequelize.STRING,
          allowNull: true,
          references: { model: "users", key: "id" },
          onUpdate: "CASCADE",
          onDelete: "SET NULL"
        },
        employee_id: {
          type: Sequelize.STRING,
          allowNull: true,
          references: { model: "employees", key: "id" },
          onUpdate: "CASCADE",
          onDelete: "SET NULL"
        },
        operator_session_id: { type: Sequelize.STRING, allowNull: true },
        occurred_at: { type: Sequelize.DATE, allowNull: false },
        idempotency_scope: { type: Sequelize.STRING(100), allowNull: false },
        idempotency_key: { type: Sequelize.STRING(191), allowNull: false },
        request_hash: { type: Sequelize.STRING(128), allowNull: false },
        created_at: { type: Sequelize.DATE, allowNull: false },
        updated_at: { type: Sequelize.DATE, allowNull: false }
      }, { transaction });

      await queryInterface.createTable("asset_revision_changes", {
        id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
        revision_id: {
          type: Sequelize.STRING,
          allowNull: false,
          references: { model: "asset_revisions", key: "id" },
          onUpdate: "CASCADE",
          onDelete: "RESTRICT"
        },
        field_key: { type: Sequelize.STRING(120), allowNull: false },
        old_value: { type: Sequelize.JSONB, allowNull: true },
        new_value: { type: Sequelize.JSONB, allowNull: true },
        value_type: { type: Sequelize.STRING(32), allowNull: false },
        authority_type: { type: Sequelize.STRING(40), allowNull: false },
        dedicated_operation_reference: { type: Sequelize.STRING(255), allowNull: true },
        created_at: { type: Sequelize.DATE, allowNull: false },
        updated_at: { type: Sequelize.DATE, allowNull: false }
      }, { transaction });

      await queryInterface.addIndex("asset_revisions", ["asset_id", "revision_no"], {
        unique: true,
        name: "asset_revisions_asset_revision_no_uq",
        transaction
      });
      await queryInterface.addIndex("asset_revisions", ["company_id", "branch_id", "occurred_at"], {
        name: "asset_revisions_company_branch_occurred_idx",
        transaction
      });
      await queryInterface.addIndex("asset_revisions", ["asset_id", "occurred_at"], {
        name: "asset_revisions_asset_occurred_idx",
        transaction
      });
      await queryInterface.addIndex("asset_revisions", ["company_id", "idempotency_scope", "idempotency_key"], {
        unique: true,
        name: "asset_revisions_company_scope_key_uq",
        transaction
      });
      await queryInterface.addIndex("asset_revision_changes", ["revision_id"], {
        name: "asset_revision_changes_revision_idx",
        transaction
      });
      await queryInterface.addIndex("asset_revision_changes", ["field_key"], {
        name: "asset_revision_changes_field_key_idx",
        transaction
      });

      await queryInterface.sequelize.query(`
        ALTER TABLE asset_revisions
          ADD CONSTRAINT asset_revisions_revision_no_positive_ck CHECK (revision_no > 0),
          ADD CONSTRAINT asset_revisions_scope_nonempty_ck CHECK (btrim(idempotency_scope) <> ''),
          ADD CONSTRAINT asset_revisions_key_nonempty_ck CHECK (btrim(idempotency_key) <> ''),
          ADD CONSTRAINT asset_revisions_source_operation_nonempty_ck CHECK (btrim(source_operation) <> '');

        ALTER TABLE asset_revision_changes
          ADD CONSTRAINT asset_revision_changes_field_key_format_ck
            CHECK (field_key ~ '^[a-z][a-z0-9_.-]*$'),
          ADD CONSTRAINT asset_revision_changes_value_type_ck
            CHECK (value_type IN ('string','number','decimal','boolean','datetime','identifier','structured','null')),
          ADD CONSTRAINT asset_revision_changes_authority_type_ck
            CHECK (authority_type IN ('GENERAL_REVISION_CHANGE','DEDICATED_OPERATION_REFERENCE')),
          ADD CONSTRAINT asset_revision_changes_value_presence_ck
            CHECK (old_value IS NOT NULL OR new_value IS NOT NULL);
      `, { transaction });

      // Existing historical tables use application immutability in several
      // places and database guards for identity history. This DB guard is
      // justified for the new append-only revision evidence because a future
      // service must never silently rewrite or delete a posted revision.
      await queryInterface.sequelize.query(`
        CREATE OR REPLACE FUNCTION ${REVISION_IMMUTABILITY_FUNCTION}()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          RAISE EXCEPTION 'Asset revision history is immutable';
        END;
        $$;

        CREATE TRIGGER asset_revisions_immutable_trg
          BEFORE UPDATE OR DELETE ON asset_revisions
          FOR EACH ROW EXECUTE FUNCTION ${REVISION_IMMUTABILITY_FUNCTION}();

        CREATE TRIGGER asset_revision_changes_immutable_trg
          BEFORE UPDATE OR DELETE ON asset_revision_changes
          FOR EACH ROW EXECUTE FUNCTION ${REVISION_IMMUTABILITY_FUNCTION}();
      `, { transaction });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      const [rows] = await queryInterface.sequelize.query(
        "SELECT (SELECT COUNT(*) FROM asset_revisions) AS revisions, (SELECT COUNT(*) FROM asset_revision_changes) AS changes",
        { transaction }
      );
      const revisions = Number(rows[0]?.revisions || 0);
      const changes = Number(rows[0]?.changes || 0);
      if (revisions !== 0 || changes !== 0) {
        throw new Error("C2B down migration is allowed only for an empty disposable schema");
      }
      await queryInterface.sequelize.query("DROP TRIGGER IF EXISTS asset_revision_changes_immutable_trg ON asset_revision_changes", { transaction });
      await queryInterface.sequelize.query("DROP TRIGGER IF EXISTS asset_revisions_immutable_trg ON asset_revisions", { transaction });
      await queryInterface.dropTable("asset_revision_changes", { transaction });
      await queryInterface.dropTable("asset_revisions", { transaction });
      await queryInterface.sequelize.query(`DROP FUNCTION IF EXISTS ${REVISION_IMMUTABILITY_FUNCTION}()`, { transaction });
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
};

