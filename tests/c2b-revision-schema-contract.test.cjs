const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migrationPath = path.resolve(__dirname, "../migrations/20260824010000-create-asset-revision-schema.js");
const migrationSource = fs.readFileSync(migrationPath, "utf8");
const migrationCode = migrationSource
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|\s)\/\/.*$/gm, "$1");

test("C2B migration is additive and storage-only", () => {
  assert.match(migrationSource, /createTable\("asset_revisions"/);
  assert.match(migrationSource, /createTable\("asset_revision_changes"/);
  assert.doesNotMatch(migrationSource, /createTable\("(?!asset_revision)/);
  assert.doesNotMatch(migrationCode, /INSERT\s+INTO|UPDATE\s+assets|DELETE\s+FROM\s+assets|backfill/i);
  assert.match(migrationSource, /asset_id/);
  assert.match(migrationSource, /onDelete: "RESTRICT"/);
});

test("C2B contract separates general revision numbers and idempotency backstop", () => {
  assert.match(migrationSource, /revision_no: \{ type: Sequelize\.INTEGER, allowNull: false \}/);
  assert.match(migrationSource, /asset_revisions_asset_revision_no_uq/);
  assert.match(migrationSource, /idempotency_scope/);
  assert.match(migrationSource, /idempotency_key/);
  assert.match(migrationSource, /asset_revisions_company_scope_key_uq/);
  assert.doesNotMatch(migrationSource, /MAX\s*\(\s*revision_no\s*\)/i);
});

test("C2B values are lossless-encoding capable and field keys are bounded", () => {
  assert.match(migrationSource, /old_value: \{ type: Sequelize\.JSONB/);
  assert.match(migrationSource, /new_value: \{ type: Sequelize\.JSONB/);
  assert.match(migrationSource, /value_type/);
  assert.match(migrationSource, /decimal/);
  assert.match(migrationSource, /field_key_format_ck/);
  assert.match(migrationSource, /GENERAL_REVISION_CHANGE/);
  assert.match(migrationSource, /DEDICATED_OPERATION_REFERENCE/);
});

test("C2B history is DB-protected and down migration refuses populated history", () => {
  assert.match(migrationSource, /asset_revisions_immutable_trg/);
  assert.match(migrationSource, /asset_revision_changes_immutable_trg/);
  assert.match(migrationSource, /Asset revision history is immutable/);
  assert.match(migrationSource, /allowed only for an empty disposable schema/);
});
