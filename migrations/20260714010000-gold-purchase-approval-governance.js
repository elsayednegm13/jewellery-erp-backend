"use strict";

const { DataTypes } = require("sequelize");

const PERMISSIONS = [
  ...["view", "view_all", "view_branch", "view_own", "create", "update_draft", "validate", "submit", "approve", "reject", "void"].map((action) => `gold_purchase.cgp.${action}`),
  ...["view", "view_all", "view_branch", "view_own", "create", "update_draft", "validate", "submit", "approve", "reject", "void"].map((action) => `gold_purchase.igp.${action}`)
];

const actorReference = {
  type: DataTypes.STRING,
  allowNull: true,
  references: { model: "users", key: "id" },
  onUpdate: "CASCADE",
  onDelete: "SET NULL"
};

async function addGovernanceColumns(queryInterface, table) {
  await queryInterface.addColumn(table, "submitted_at", { type: DataTypes.DATE, allowNull: true });
  await queryInterface.addColumn(table, "submitted_by", actorReference);
  await queryInterface.addColumn(table, "approved_at", { type: DataTypes.DATE, allowNull: true });
  await queryInterface.addColumn(table, "approved_by", actorReference);
  await queryInterface.addColumn(table, "last_rejected_at", { type: DataTypes.DATE, allowNull: true });
  await queryInterface.addColumn(table, "last_rejected_by", actorReference);
  await queryInterface.addColumn(table, "last_rejection_reason", { type: DataTypes.TEXT, allowNull: true });
  await queryInterface.addColumn(table, "current_approval_request_id", { type: DataTypes.STRING, allowNull: true });
  await queryInterface.addColumn(table, "revision_number", { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 });
  await queryInterface.addColumn(table, "supersedes_document_id", { type: DataTypes.STRING, allowNull: true });
  await queryInterface.addColumn(table, "root_document_id", { type: DataTypes.STRING, allowNull: true });
  await queryInterface.addIndex(table, ["company_id", "status", "submitted_at"], { name: `${table}_governance_status_idx` });
  await queryInterface.addIndex(table, ["company_id", "root_document_id", "revision_number"], { name: `${table}_revision_chain_idx` });
}

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query("ALTER TYPE enum_customer_gold_purchase_documents_status ADD VALUE IF NOT EXISTS 'submitted'");
    await queryInterface.sequelize.query("ALTER TYPE enum_customer_gold_purchase_documents_status ADD VALUE IF NOT EXISTS 'approved'");
    await queryInterface.sequelize.query("ALTER TYPE enum_investment_gold_purchase_documents_status ADD VALUE IF NOT EXISTS 'submitted'");
    await queryInterface.sequelize.query("ALTER TYPE enum_investment_gold_purchase_documents_status ADD VALUE IF NOT EXISTS 'approved'");

    await addGovernanceColumns(queryInterface, "customer_gold_purchase_documents");
    await addGovernanceColumns(queryInterface, "investment_gold_purchase_documents");

    await queryInterface.createTable("gold_purchase_approval_requests", {
      id: { type: DataTypes.STRING, primaryKey: true },
      company_id: { type: DataTypes.STRING, allowNull: false, references: { model: "companies", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      branch_id: { type: DataTypes.STRING, allowNull: false, references: { model: "branches", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      aggregate_type: { type: DataTypes.ENUM("cgp", "igp"), allowNull: false },
      document_id: { type: DataTypes.STRING, allowNull: false },
      document_version: { type: DataTypes.INTEGER, allowNull: false },
      approval_status: { type: DataTypes.ENUM("pending", "approved", "rejected", "superseded"), allowNull: false, defaultValue: "pending" },
      submitted_snapshot: { type: DataTypes.JSONB, allowNull: false },
      submitted_snapshot_hash: { type: DataTypes.STRING(64), allowNull: false },
      requested_by: { ...actorReference, allowNull: false, onDelete: "RESTRICT" },
      requested_at: { type: DataTypes.DATE, allowNull: false },
      reviewed_by: actorReference,
      reviewed_at: { type: DataTypes.DATE, allowNull: true },
      review_reason: { type: DataTypes.TEXT, allowNull: true },
      version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    });
    await queryInterface.sequelize.query("ALTER TABLE gold_purchase_approval_requests ADD CONSTRAINT gold_purchase_approval_document_version_positive_ck CHECK (document_version > 0)");
    await queryInterface.addIndex("gold_purchase_approval_requests", ["document_id"], { unique: true, where: { approval_status: "pending" }, name: "gold_purchase_approval_one_pending_uq" });
    await queryInterface.addIndex("gold_purchase_approval_requests", ["company_id", "branch_id", "aggregate_type", "approval_status", "requested_at"], { name: "gold_purchase_approval_queue_idx" });
    await queryInterface.addIndex("gold_purchase_approval_requests", ["company_id", "requested_by", "requested_at"], { name: "gold_purchase_approval_requester_idx" });
    await queryInterface.addIndex("gold_purchase_approval_requests", ["company_id", "reviewed_by", "reviewed_at"], { name: "gold_purchase_approval_reviewer_idx" });

    const now = new Date();
    await queryInterface.bulkInsert("permissions", PERMISSIONS.map((name) => {
      const parts = name.split(".");
      return { id: `PERM-${name}`, name, module: `${parts[0]}.${parts[1]}`, action: parts.slice(2).join("."), description: name, created_at: now, updated_at: now };
    }), { ignoreDuplicates: true });
    await queryInterface.sequelize.query(`
      INSERT INTO role_permissions (role_id, permission_id, created_at, updated_at)
      SELECT r.id, p.id, NOW(), NOW()
      FROM roles r CROSS JOIN permissions p
      WHERE r.is_admin = true AND p.name IN (:permissionNames)
      ON CONFLICT (role_id, permission_id) DO NOTHING
    `, { replacements: { permissionNames: PERMISSIONS } });
  },

  async down(queryInterface) {
    const [[active]] = await queryInterface.sequelize.query(`
      SELECT
        (SELECT count(*) FROM customer_gold_purchase_documents WHERE status IN ('submitted','approved')) +
        (SELECT count(*) FROM investment_gold_purchase_documents WHERE status IN ('submitted','approved')) AS count
    `);
    if (Number(active.count) > 0) throw new Error("Cannot remove Phase 33C while submitted or approved Gold Purchase documents exist");

    await queryInterface.dropTable("gold_purchase_approval_requests");
    for (const table of ["customer_gold_purchase_documents", "investment_gold_purchase_documents"]) {
      for (const column of ["submitted_at", "submitted_by", "approved_at", "approved_by", "last_rejected_at", "last_rejected_by", "last_rejection_reason", "current_approval_request_id", "revision_number", "supersedes_document_id", "root_document_id"]) {
        await queryInterface.removeColumn(table, column);
      }
    }
    await queryInterface.sequelize.query("DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE name IN (:permissionNames))", { replacements: { permissionNames: PERMISSIONS } });
    await queryInterface.sequelize.query("DELETE FROM permissions WHERE name IN (:permissionNames)", { replacements: { permissionNames: PERMISSIONS } });
  }
};
