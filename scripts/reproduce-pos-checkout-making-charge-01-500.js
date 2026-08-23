"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { QueryTypes } = require("sequelize");
const { Client } = require("pg");
const { resolveDatabaseEnv } = require("../src/config/database-env");

const ACCEPTANCE = "darfus_erp_inventory_rehearsal_20260804_160500z";
const PERSISTENT = "darfus_erp";
const PREFIX = "darfus_erp_pos_checkout_making_charge_01_rehearsal_";
const PG_BIN = "C:\\Program Files\\PostgreSQL\\18\\bin";

function assertClone(db) {
  assert.match(db, new RegExp(`^${PREFIX}`));
  assert.notEqual(db, ACCEPTANCE);
  assert.notEqual(db, PERSISTENT);
}
function pgEnv(config, db) {
  return { ...process.env, PGHOST: config.host, PGPORT: String(config.port), PGUSER: config.username, PGPASSWORD: config.password, PGDATABASE: db, PGSSLMODE: config.ssl ? "require" : "disable" };
}
function run(name, args, env) { return execFileSync(path.join(PG_BIN, name), args, { env, stdio: "pipe" }); }
function cloneAcceptance(config, clone, dumpDir) {
  run("pg_dump.exe", ["--format=custom", "--no-owner", "--no-privileges", `--file=${path.join(dumpDir, "acceptance.dump")}`, ACCEPTANCE], pgEnv(config, ACCEPTANCE));
  run("createdb.exe", [clone], pgEnv(config, "postgres"));
  run("pg_restore.exe", ["--no-owner", "--no-privileges", "--exit-on-error", "--dbname", clone, path.join(dumpDir, "acceptance.dump")], pgEnv(config, clone));
}
function dropClone(config, clone) { assertClone(clone); run("dropdb.exe", [clone], pgEnv(config, "postgres")); }

async function main() {
  const sourceConfig = resolveDatabaseEnv({ ...process.env, NODE_ENV: "development", DATABASE_URL: "", DB_NAME: ACCEPTANCE });
  const source = new Client({ host: sourceConfig.host, port: sourceConfig.port, user: sourceConfig.username, password: sourceConfig.password, database: ACCEPTANCE, ssl: sourceConfig.ssl ? { rejectUnauthorized: false } : false });
  await source.connect();
  assert.equal((await source.query("SELECT current_database() AS db")).rows[0].db, ACCEPTANCE);
  await source.end();

  // Keep the PostgreSQL identifier below its 63-byte limit; the exact task
  // prefix remains intact for the drop safety assertion.
  const clone = `${PREFIX}${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 12)}`;
  assertClone(clone);
  const dumpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-checkout-making-charge-01-"));
  cloneAcceptance(sourceConfig, clone, dumpDir);

  let server;
  let sequelize;
  try {
    process.env.NODE_ENV = "development";
    delete process.env.DATABASE_URL;
    process.env.DB_NAME = clone;
    const models = require("../src/models");
    sequelize = models.sequelize;
    assert.equal((await sequelize.query("SELECT current_database() AS db", { type: QueryTypes.SELECT }))[0].db, clone);
    const company = await models.Company.findOne({ order: [["id", "ASC"]] });
    const customer = await models.Customer.findOne({ where: { companyId: company.id, status: "active" }, order: [["id", "ASC"]] });
    const asset = await models.Asset.findOne({ where: { companyId: company.id, status: "available", inventoryProfile: "GOLD_BY_WEIGHT_JEWELLERY", grossWeight: 10 }, order: [["id", "ASC"]] });
    const branch = await models.Branch.findOne({ where: { id: asset.branchId, companyId: company.id, isActive: true } });
    const user = await models.User.findOne({ where: { companyId: company.id, isActive: true, accountType: "super_admin" }, order: [["id", "ASC"]] });
    assert.ok(company && customer && asset && branch && user);
    const pricing = require("../src/services/gold-sale-pricing.service");
    let stack = "";
    try {
      await pricing.calculateGoldSalePriceForAsset({ asset, models, companyId: company.id, transaction: null, itemInput: { makingChargePerGram: 10 }, configuredVatRate: 0 });
      assert.fail("expected missing selling rate failure");
    } catch (error) {
      assert.equal(error.message, "GOLD_SALE_PRICING_SELLING_GOLD_RATE_REQUIRED");
      stack = error.stack;
    }

    const countSql = `SELECT
      (SELECT COUNT(*)::int FROM invoices) AS invoices,
      (SELECT COUNT(*)::int FROM invoice_items) AS invoice_items,
      (SELECT COUNT(*)::int FROM cash_transactions) AS cash_transactions,
      (SELECT COUNT(*)::int FROM journal_entries) AS journals,
      (SELECT COUNT(*)::int FROM journal_lines) AS journal_lines,
      (SELECT status FROM assets WHERE id=:assetId) AS asset_status,
      (SELECT COUNT(*)::int FROM asset_events WHERE asset_id=:assetId) AS asset_events,
      (SELECT COUNT(*)::int FROM stock_movements WHERE asset_id=:assetId) AS asset_movements`;
    const before = (await sequelize.query(countSql, { replacements: { assetId: asset.id }, type: QueryTypes.SELECT }))[0];

    const sessions = require("../src/services/technical-session.service");
    const issued = await sessions.issueTokens(user, { headers: { "x-device-session-id": `pos-checkout-making-charge-01-${Date.now()}` }, ip: "127.0.0.1" });
    const app = require("../src/app");
    await new Promise((resolve, reject) => { server = app.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve()); });
    const body = {
      customerId: customer.id,
      customerName: customer.name,
      branchId: branch.id,
      paymentMethod: "cash",
      discount: 0,
      makingCharge: 0,
      makingChargePerGram: 10,
      totalMakingCharge: 100,
      stoneValue: 0,
      items: [{ assetId: asset.id, name: asset.name, quantity: 1, price: Number(asset.price), cost: Number(asset.cost), totalWeight: Number(asset.grossWeight), makingCharge: 0, makingChargePerGram: 10, totalMakingCharge: 100, stoneValue: 0 }]
    };
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/pos/checkout`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${issued.token}`, "X-Company-ID": company.id, "X-Branch-ID": branch.id, "Idempotency-Key": `POS-GMC01-500-${Date.now()}` }, body: JSON.stringify(body) });
    const responseBody = await response.json();
    assert.equal(response.status, 500);
    assert.equal(responseBody.error.code, "INTERNAL_SERVER_ERROR");
    assert.equal(responseBody.error.requestId !== undefined, true);
    const after = (await sequelize.query(countSql, { replacements: { assetId: asset.id }, type: QueryTypes.SELECT }))[0];
    assert.deepEqual(after, before);
    console.log(JSON.stringify({ result: "REPRODUCED", database: clone, endpoint: "/api/v1/pos/checkout", status: response.status, responseRequestId: responseBody.error.requestId, assetId: asset.id, grossWeight: Number(asset.grossWeight), makingChargePerGram: 10, expectedTotalMakingCharge: 100, payload: { ...body, authorization: "REDACTED" }, before, after, rootCause: "GOLD_SALE_PRICING_SELLING_GOLD_RATE_REQUIRED", stack }));
    await sessions.revokeSession(issued.session.id, user.id, "pos_checkout_making_charge_01_reproduction");
  } finally {
    try { if (server) await new Promise((resolve) => server.close(resolve)); } catch (_) {}
    try { if (sequelize && !sequelize.closed) await sequelize.close(); } catch (_) {}
    dropClone(sourceConfig, clone);
    fs.rmSync(dumpDir, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(JSON.stringify({ result: "FAIL", message: error.message, stack: error.stack })); process.exitCode = 1; });
