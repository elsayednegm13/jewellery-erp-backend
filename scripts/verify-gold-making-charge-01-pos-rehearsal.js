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
const PREFIX = "darfus_erp_gold_making_charge_01_rehearsal_";
const PG_BIN = "C:\\Program Files\\PostgreSQL\\18\\bin";

function assertClone(db) {
  assert.match(db, new RegExp(`^${PREFIX}`));
  assert.notEqual(db, ACCEPTANCE);
  assert.notEqual(db, PERSISTENT);
}
function pgEnv(config, db) {
  return { ...process.env, PGHOST: config.host, PGPORT: String(config.port), PGUSER: config.username, PGPASSWORD: config.password, PGDATABASE: db, PGSSLMODE: config.ssl ? "require" : "disable" };
}
function run(name, args, env) { execFileSync(path.join(PG_BIN, name), args, { env, stdio: "pipe" }); }
function cloneAcceptance(config, clone, dumpDir) {
  run("pg_dump.exe", ["--format=custom", "--no-owner", "--no-privileges", `--file=${path.join(dumpDir, "acceptance.dump")}`, ACCEPTANCE], pgEnv(config, ACCEPTANCE));
  run("createdb.exe", [clone], pgEnv(config, "postgres"));
  run("pg_restore.exe", ["--no-owner", "--no-privileges", "--exit-on-error", "--dbname", clone, path.join(dumpDir, "acceptance.dump")], pgEnv(config, clone));
}
function dropClone(config, clone) { assertClone(clone); run("dropdb.exe", [clone], pgEnv(config, "postgres")); }

async function request(baseUrl, pathname, { token, companyId, branchId, key, body }) {
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-Company-ID": companyId, "X-Branch-ID": branchId, "Idempotency-Key": key };
  const response = await fetch(`${baseUrl}/api/v1${pathname}`, { method: "POST", headers, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

async function main() {
  const sourceConfig = resolveDatabaseEnv({ ...process.env, NODE_ENV: "development", DATABASE_URL: "", DB_NAME: ACCEPTANCE });
  const sourceClient = new Client({ host: sourceConfig.host, port: sourceConfig.port, user: sourceConfig.username, password: sourceConfig.password, database: ACCEPTANCE, ssl: sourceConfig.ssl ? { rejectUnauthorized: false } : false });
  await sourceClient.connect();
  const sourceDb = (await sourceClient.query("SELECT current_database() AS db")).rows[0].db;
  assert.equal(sourceDb, ACCEPTANCE);
  await sourceClient.end();

  const clone = `${PREFIX}${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
  assertClone(clone);
  const dumpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gold-making-charge-01-"));
  cloneAcceptance(sourceConfig, clone, dumpDir);

  let sequelize;
  let server;
  try {
    process.env.NODE_ENV = "development"; delete process.env.DATABASE_URL; process.env.DB_NAME = clone;
    const models = require("../src/models");
    sequelize = models.sequelize;
    const actualDb = (await sequelize.query("SELECT current_database() AS db", { type: QueryTypes.SELECT }))[0].db;
    assert.equal(actualDb, clone);
    const company = await models.Company.findOne({ order: [["id", "ASC"]] });
    assert.ok(company, "company fixture required");
    const customer = await models.Customer.findOne({ where: { companyId: company.id, status: "active" }, order: [["id", "ASC"]] });
    const assets = await models.Asset.findAll({ where: { companyId: company.id, status: "available", inventoryProfile: "GOLD_BY_WEIGHT_JEWELLERY", grossWeight: 10 }, order: [["id", "ASC"]], limit: 4 });
    const asset10a = assets[0];
    const asset10b = assets[1];
    const asset875 = assets[2];
    const assetNegative = assets[3];
    const branch = await models.Branch.findOne({ where: { id: asset10a?.branchId, companyId: company.id, isActive: true } });
    const user = await models.User.findOne({ where: { companyId: company.id, isActive: true, accountType: "super_admin" }, order: [["id", "ASC"]] });
    assert.ok(branch && customer && asset10a && asset10b && asset875 && assetNegative && user, "gold POS acceptance context required");

    // Controlled fixture only: make one cloned Asset fractional for the
    // required 8.75g checkout proof. The canonical Asset remains untouched.
    const cloneDb = (await sequelize.query("SELECT current_database() AS db", { type: QueryTypes.SELECT }))[0].db;
    assert.equal(cloneDb, clone);
    await asset875.update({ grossWeight: 8.75, netWeight: 8.75 });
    await sequelize.query("UPDATE asset_gold_details SET gross_weight=8.75, net_gold_weight=8.75 WHERE asset_id=:assetId", { replacements: { assetId: asset875.id }, transaction: null });

    const sessions = require("../src/services/technical-session.service");
    const issued = await sessions.issueTokens(user, { headers: { "x-device-session-id": `gold-making-charge-01-${Date.now()}` }, ip: "127.0.0.1" });
    const app = require("../src/app");
    await new Promise((resolve, reject) => { server = app.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve()); });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const runCheckout = async (asset, rate, expectedMaking, label) => {
      const target = (await sequelize.query("SELECT current_database() AS db", { type: QueryTypes.SELECT }))[0].db;
      assert.equal(target, clone);
      const key = `GMC01:${label}:${Date.now()}`;
      const body = {
        customerId: customer.id,
        branchId: branch.id,
        paymentMethod: "cash",
        makingChargePerGram: rate,
        // Deliberately forged values: the server must ignore these authorities.
        weight: 1,
        totalMakingCharge: 1,
        items: [{ assetId: asset.id, weight: 1, totalWeight: 1, totalMakingCharge: 1, makingChargePerGram: rate }]
      };
      const result = await request(baseUrl, "/pos/checkout", { token: issued.token, companyId: company.id, branchId: branch.id, key, body });
      assert.equal(result.status, 201, JSON.stringify(result.body));
      const invoice = result.body.data || result.body;
      assert.equal(Number(invoice.makingCharge), expectedMaking);
      assert.equal(Number(invoice.items?.[0]?.makingCharge), expectedMaking);
      assert.equal((await models.Asset.findByPk(asset.id)).status, "sold");
      const replay = await request(baseUrl, "/pos/checkout", { token: issued.token, companyId: company.id, branchId: branch.id, key, body });
      assert.ok([200, 201].includes(replay.status), JSON.stringify(replay.body));
      const replayInvoice = replay.body.data || replay.body;
      assert.equal(replayInvoice.id, invoice.id);
      return { label, assetId: asset.id, grossWeight: Number(asset.grossWeight), makingChargePerGram: rate, totalMakingCharge: expectedMaking, invoiceId: invoice.id, replayStatus: replay.status };
    };

    const evidence = [];
    evidence.push(await runCheckout(asset10a, 10, 100, "10G_X_10"));
    evidence.push(await runCheckout(asset10b, 100, 1000, "10G_X_100"));
    evidence.push(await runCheckout(asset875, 100, 875, "8_75G_X_100"));
    const negativeTarget = (await sequelize.query("SELECT current_database() AS db", { type: QueryTypes.SELECT }))[0].db;
    assert.equal(negativeTarget, clone);
    const negative = await request(baseUrl, "/pos/checkout", {
      token: issued.token, companyId: company.id, branchId: branch.id, key: `GMC01:NEGATIVE:${Date.now()}`,
      body: { customerId: customer.id, branchId: branch.id, paymentMethod: "cash", makingChargePerGram: -1, items: [{ assetId: assetNegative.id }] }
    });
    assert.equal(negative.status, 422, JSON.stringify(negative.body));
    assert.equal((await models.Asset.findByPk(assetNegative.id)).status, "available");
    const integrity = (await sequelize.query(`SELECT
      (SELECT COUNT(*)::int FROM journal_entries WHERE status IN ('posted','reversed') AND total_debit<>total_credit) AS unbalanced,
      (SELECT COUNT(*)::int FROM journal_lines l LEFT JOIN journal_entries j ON j.id=l.journal_entry_id WHERE j.id IS NULL) AS orphan_lines,
      (SELECT COUNT(*)::int FROM cash_transactions c LEFT JOIN journal_entries j ON j.id=c.journal_entry_id WHERE c.status='posted' AND c.type<>'closing' AND c.journal_entry_id IS NOT NULL AND j.id IS NULL) AS unlinked_treasury`, { type: QueryTypes.SELECT }))[0];
    assert.deepEqual(integrity, { unbalanced: 0, orphan_lines: 0, unlinked_treasury: 0 });
    console.log(JSON.stringify({ result: "PASS", database: clone, cases: evidence, negativeMakingRejected: true, integrity, forgedWeightAccepted: false, forgedTotalAccepted: false }));
    await sessions.revokeSession(issued.session.id, user.id, "gold_making_charge_01_complete");
  } finally {
    try { if (server) await new Promise((resolve) => server.close(resolve)); } catch (_) {}
    try { if (sequelize && !sequelize.closed) await sequelize.close(); } catch (_) {}
    dropClone(sourceConfig, clone);
    fs.rmSync(dumpDir, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(JSON.stringify({ result: "FAIL", message: error.message, code: error.errorCode || error.code })); process.exitCode = 1; });
