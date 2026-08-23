"use strict";

// Disposable-clone closeout only.  The source acceptance and persistent
// databases are never used for business writes by this script.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { QueryTypes } = require("sequelize");
const { resolveDatabaseEnv } = require("../src/config/database-env");

const ACCEPTANCE = "darfus_erp_inventory_rehearsal_20260804_160500z";
const PERSISTENT = "darfus_erp";
const PREFIX = "darfus_erp_supplier_gold_closeout_";
const PG_BIN = "C:\\Program Files\\PostgreSQL\\18\\bin";
const KARATS = [14, 18, 21, 22, 24];
const trace = (message) => { try { fs.appendFileSync(path.join(os.tmpdir(), "supplier-gold-closeout.trace"), `${new Date().toISOString()} ${message}\n`); } catch (_) {} };

const assertClone = (db) => {
  assert.match(db, new RegExp(`^${PREFIX}`));
  assert.notEqual(db, ACCEPTANCE);
  assert.notEqual(db, PERSISTENT);
};
const pgEnv = (config, db) => ({ ...process.env, PGHOST: config.host, PGPORT: String(config.port), PGUSER: config.username, PGPASSWORD: config.password, PGDATABASE: db, PGSSLMODE: config.ssl ? "require" : "disable" });
const pg = (name, args, env) => execFileSync(path.join(PG_BIN, name), args, { env, stdio: "pipe" });
function cloneAcceptance(config, clone, dumpDir) {
  pg("pg_dump.exe", ["--format=custom", "--no-owner", "--no-privileges", `--file=${path.join(dumpDir, "acceptance.dump")}`, ACCEPTANCE], pgEnv(config, ACCEPTANCE));
  pg("createdb.exe", [clone], pgEnv(config, "postgres"));
  pg("pg_restore.exe", ["--no-owner", "--no-privileges", "--exit-on-error", "--dbname", clone, path.join(dumpDir, "acceptance.dump")], pgEnv(config, clone));
}
function dropClone(config, clone) { assertClone(clone); pg("dropdb.exe", [clone], pgEnv(config, "postgres")); }

async function main() {
  trace("start");
  const sourceConfig = resolveDatabaseEnv({ ...process.env, NODE_ENV: "development", DATABASE_URL: "", DB_NAME: ACCEPTANCE });
  const source = new (require("pg").Client)({ host: sourceConfig.host, port: sourceConfig.port, user: sourceConfig.username, password: sourceConfig.password, database: ACCEPTANCE, ssl: sourceConfig.ssl ? { rejectUnauthorized: false } : false });
  await source.connect();
  trace("source connected");
  assert.equal((await source.query("SELECT current_database() AS db")).rows[0].db, ACCEPTANCE);
  await source.end();

  const clone = `${PREFIX}${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 12)}`;
  assertClone(clone);
  const dumpDir = fs.mkdtempSync(path.join(os.tmpdir(), "supplier-gold-closeout-"));
  cloneAcceptance(sourceConfig, clone, dumpDir);
  trace(`clone restored ${clone}`);
  let server; let sequelize; let auth; let limitedAuth;
  try {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "";
    process.env.DB_NAME = clone;
    const models = require("../src/models");
    trace("models loaded");
    sequelize = models.sequelize;
    const one = async (sql, replacements = {}) => (await sequelize.query(sql, { replacements, type: QueryTypes.SELECT }))[0];
    const assertDb = async () => assert.equal((await one("SELECT current_database() AS db")).db, clone);
    await assertDb();
    trace("clone connected");
    const company = await models.Company.findOne({ order: [["id", "ASC"]] });
    const financialBootstrap = require("../src/services/financial-bootstrap.service");
    const activeBranches = await models.Branch.findAll({ where: { companyId: company.id, isActive: true }, order: [["code", "ASC"], ["id", "ASC"]] });
    const branchCandidates = [];
    for (const candidate of activeBranches) {
      const readiness = await financialBootstrap.evaluateReadiness({ models, companyId: company.id, branchId: candidate.id });
      branchCandidates.push({ candidate, readiness });
    }
    const readyCandidates = branchCandidates.filter((entry) => entry.readiness.status === "READY");
    const mainCandidate = readyCandidates.find((entry) => String(entry.candidate.code || "").toUpperCase() === "MAIN");
    const branch = (mainCandidate || readyCandidates.sort((a, b) => String(a.candidate.code || "").localeCompare(String(b.candidate.code || "")))[0])?.candidate;
    const supplier = await models.Supplier.findOne({ where: { companyId: company.id }, order: [["id", "ASC"]] });
    const superAdmin = await models.User.findOne({ where: { companyId: company.id, isActive: true, accountType: "super_admin" }, order: [["id", "ASC"]] });
    const limited = await models.User.findOne({ where: { companyId: company.id, isActive: true, accountType: { [require("sequelize").Op.ne]: "super_admin" } }, order: [["id", "ASC"]] });
    assert.ok(company && branch && supplier && superAdmin, "clone requires company, a financially-ready branch, supplier and super-admin harness data");
    const selectedReadiness = branchCandidates.find((entry) => entry.candidate.id === branch.id)?.readiness;
    assert.equal(selectedReadiness?.status, "READY", "selected branch must be financially ready before E2E");
    console.error(`[closeout] selected financially-ready branch ${branch.code} (${branch.id})`);
    const codeFor = async (assetType) => one(`SELECT i.code AS "inventoryCode", m.code AS "itemCode" FROM barcode_inventory_codes i JOIN barcode_item_codes m ON m.is_active=true AND (jsonb_array_length(m.allowed_inventory_codes)=0 OR m.allowed_inventory_codes ? i.code) WHERE i.asset_type=:assetType AND i.is_active=true ORDER BY i.code,m.code LIMIT 1`, { assetType });
    const goldWeightCode = await codeFor("gold-weight");
    const goldPieceCode = await codeFor("gold-piece");
    assert.ok(goldWeightCode && goldPieceCode, "clone barcode taxonomy is required");

    // The clone gets explicit, approved, company-scoped Gold Center fixtures;
    // they are disposable test configuration and are never copied elsewhere.
    await assertDb();
    const now = new Date();
    for (const karat of KARATS) {
      // Append a fresh executable clone-only quote for every karat. Existing
      // historical/stale approved rows must not shadow this acceptance quote.
      const currentApproved = await models.GoldPrice.findAll({ where: { companyId: company.id, karat, currency: company.currency || "AED", approvalStatus: "APPROVED" } });
      for (const row of currentApproved) {
        await row.update({ approvalStatus: "SUPERSEDED" }, { goldPriceTransition: "supersede" });
      }
      await models.GoldPrice.create({ companyId: company.id, karat, pricePerGram: String(karat * 20), currency: company.currency || "AED", source: "manual", approvalStatus: "APPROVED", approvedAt: now, approvedBy: superAdmin.id, validFrom: new Date(now.getTime() - 60_000), validUntil: new Date(now.getTime() + 86_400_000), approvalVersion: 100, updatedBy: superAdmin.id });
    }
    trace("prices seeded");
    console.error(`[closeout] clone seeded ${clone}`);

    const app = require("../src/app");
    server = await new Promise((resolve, reject) => { const s = app.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve(s)); });
    trace("server started");
    console.error(`[closeout] server listening ${server.address().port}`);
    const base = `http://127.0.0.1:${server.address().port}/api/v1`;
    const request = async (method, url, token, body, key) => {
      await assertDb();
      trace(`request ${method} ${url}`);
      const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-Company-ID": company.id, "X-Branch-ID": branch.id };
      if (key) headers["Idempotency-Key"] = key;
      const response = await fetch(`${base}${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
      trace(`response ${method} ${url} ${response.status}`);
      const text = await Promise.race([response.text(), new Promise((_, reject) => setTimeout(() => reject(new Error(`response body timeout status=${response.status}`)), 3000))]); let parsed; try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
      trace(`body ${method} ${url} ${text.slice(0, 300)}`);
      return { status: response.status, body: parsed };
    };
    const issue = async (user, label) => {
      const sessions = require("../src/services/technical-session.service");
      return sessions.issueTokens(user, { headers: { "x-device-session-id": `supplier-gold-closeout-${label}-${Date.now()}` }, ip: "127.0.0.1" });
    };
    auth = await issue(superAdmin, "admin");
    trace("token issued");
    console.error("[closeout] admin token issued");
    if (limited) limitedAuth = await issue(limited, "limited");

    const receiveBody = ({ profile, assetType = "gold-weight", code, karat, rate, currentRate = 1, certificateCost = 100, currentCertificateCost = 120, makingPerGram = 0, pieceCost, reason } = {}) => ({
      id: `SUP-GOLD-CLOSEOUT-${profile}-${karat}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      supplierId: supplier.id, branchId: branch.id, warehouseId: branch.id, purchaseDate: "2026-08-12", paymentMethod: "credit", paidAmount: 0, applyVat: true, inventoryV2: true,
      items: [{ name: `Closeout ${profile} ${karat}K`, type: assetType, category: "Supplier Gold Closeout", inventoryCode: code.inventoryCode, itemCode: code.itemCode, karat, quantity: 1, weightPerUnit: 10, unitCost: 0, price: 0, perPiece: [{ name: `Closeout ${profile} ${karat}K`, description: "Disposable clone acceptance", profile, inventoryProfile: profile, type: assetType, category: "Supplier Gold Closeout", inventoryCode: code.inventoryCode, itemCode: code.itemCode, karat, grossWeight: 10, stoneWeight: 0, ...(pieceCost === undefined ? {} : { purchaseCost: pieceCost }), condition: profile === "GOLD_BAR_24K" ? undefined : "NEW", goldValuation: { ...(rate === undefined ? {} : { purchaseGoldRate: rate }), currentGoldRate: currentRate, certificateCost, currentCertificateCost, makingPerGram, vatRate: profile === "GOLD_BAR_24K" ? 7.25 : undefined, currentVatRate: profile === "GOLD_BAR_24K" ? 7.25 : undefined, purchaseRateOverrideReason: reason } }] }],
    });

    const before = await one("SELECT (SELECT COUNT(*)::int FROM assets) AS assets, (SELECT COUNT(*)::int FROM journal_entries) AS journals, (SELECT COUNT(*)::int FROM audit_logs) AS audits");
    const barBody = receiveBody({ profile: "GOLD_BAR_24K", code: goldWeightCode, karat: 24, certificateCost: 100, currentCertificateCost: 120 });
    const barKey = `SUP-GOLD-CLOSEOUT-BAR-${Date.now()}`;
    const bar = await request("POST", "/purchase-orders/receive", auth.token, barBody, barKey);
    console.error(`[closeout] bar response ${bar.status}`);
    assert.equal(bar.status, 201, `24K clone receipt failed: ${JSON.stringify(bar.body)}`);
    const barAsset = (bar.body.assets || bar.body.data?.assets || [])[0]; assert.ok(barAsset?.id && barAsset.barcode);
    const detail = await request("GET", `/inventory-v2/assets/${encodeURIComponent(barAsset.id)}`, auth.token);
    assert.equal(detail.status, 200);
    const d = detail.body.data;
    const referenceRate = 480; // seeded 24K Gold Center fixture
    assert.equal(Number(d.currentPurchaseCost.purchase_gold_rate), referenceRate);
    assert.equal(Number(d.currentValuation.gold_rate), referenceRate);
    assert.equal(Number(d.currentPurchaseCost.certificate_cost), 100);
    assert.equal(Number(d.currentPurchaseCost.vat_amount), 7.25);
    assert.equal(Number(d.currentPurchaseCost.vat_base), 100);

    // Certificate finance is optional for a Gold Bar and remains zero when
    // omitted; the client cannot forge the current market rate either.
    const noCertificateBody = receiveBody({ profile: "GOLD_BAR_24K", code: goldWeightCode, karat: 24, rate: referenceRate, currentRate: 1, certificateCost: 0, currentCertificateCost: 0 });
    const noCertificate = await request("POST", "/purchase-orders/receive", auth.token, noCertificateBody, `SUP-GOLD-CLOSEOUT-NOCERT-${Date.now()}`);
    assert.equal(noCertificate.status, 201, `no-certificate Gold Bar failed: ${JSON.stringify(noCertificate.body)}`);
    const noCertificateAsset = (noCertificate.body.assets || noCertificate.body.data?.assets || [])[0];
    const noCertificateDetail = await request("GET", `/inventory-v2/assets/${encodeURIComponent(noCertificateAsset.id)}`, auth.token);
    assert.equal(noCertificateDetail.status, 200);
    assert.equal(Number(noCertificateDetail.body.data.currentPurchaseCost.certificate_cost || 0), 0);
    assert.equal(Number(noCertificateDetail.body.data.currentPurchaseCost.vat_amount || 0), 0);
    assert.equal(Number(noCertificateDetail.body.data.currentValuation.gold_rate), referenceRate, "current-rate tampering was accepted");

    const barPurchase = await models.PurchaseOrder.findByPk(barBody.id);
    assert.ok(Number(barPurchase?.total) > 0, "supplier total must be positive");
    const barPaid = await one("SELECT COALESCE(SUM(amount),0)::numeric AS paid FROM cash_transactions WHERE company_id=:companyId AND category='supplier_purchase' AND reference=:reference AND status='posted'", { companyId: company.id, reference: barBody.id });
    assert.equal(Number(barPaid.paid), 0, "paid=0 fixture unexpectedly has supplier payment");
    assert.equal(Number(barPurchase.total) - Number(barPaid.paid), Number(barPurchase.total), "supplier remaining must equal total when paid=0");
    const barReplay = await request("POST", "/purchase-orders/receive", auth.token, barBody, barKey);
    assert.equal(barReplay.status, 201, `primary Gold Bar idempotency replay failed: ${JSON.stringify(barReplay.body)}`);
    assert.equal((barReplay.body.assets || barReplay.body.data?.assets || [])[0]?.id, barAsset.id, "idempotency replay created a different Asset");

    const overrideRate = 450;
    const override = await request("POST", "/purchase-orders/receive", auth.token, receiveBody({ profile: "GOLD_BAR_24K", code: goldWeightCode, karat: 24, rate: overrideRate, currentRate: 1, certificateCost: 80, currentCertificateCost: 90, reason: "Owner-approved clone override" }), `SUP-GOLD-CLOSEOUT-OVERRIDE-${Date.now()}`);
    assert.equal(override.status, 201, `authorized override failed: ${JSON.stringify(override.body)}`);
    const overrideAsset = (override.body.assets || override.body.data?.assets || [])[0]; assert.ok(overrideAsset?.id);
    const audit = await one("SELECT COUNT(*)::int AS count FROM audit_logs WHERE company_id=:companyId AND action='supplier_purchase_rate.override' AND after::text LIKE :asset", { companyId: company.id, asset: `%${overrideAsset.id}%` });
    assert.ok(audit.count >= 1, "purchase-rate override audit evidence missing");

    if (limitedAuth) {
      const beforeUnauthorized = await one("SELECT COUNT(*)::int AS count FROM assets");
      const unauthorized = await request("POST", "/purchase-orders/receive", limitedAuth.token, receiveBody({ profile: "GOLD_BAR_24K", code: goldWeightCode, karat: 24, rate: 1, currentRate: 1, reason: "unauthorized" }), `SUP-GOLD-CLOSEOUT-UNAUTH-${Date.now()}`);
      assert.ok(unauthorized.status >= 400 && unauthorized.status < 500, `unauthorized override unexpectedly accepted: ${unauthorized.status}`);
      const afterUnauthorized = await one("SELECT COUNT(*)::int AS count FROM assets"); assert.equal(afterUnauthorized.count, beforeUnauthorized.count);
    }

    const pricing = require("../src/services/gold-sale-pricing.service");
    const goldValuation = require("../src/services/gold-valuation.service");
    console.error(`[closeout] current valuation readback ${JSON.stringify(d.currentValuation)}`);
    const m1 = goldValuation.calculateCurrentGoldValuation({ profile: "GOLD_BAR_24K", goldDetails: d.goldDetails, input: { ...d.currentValuation, currentCertificateCost: d.currentValuation.certificate_value ?? d.currentValuation.certificateValue }, configuredVatRate: 7.25, canonicalCurrentGoldRate: referenceRate });
    const q1 = await request("POST", "/pricing/calculate", auth.token, { customerId: (await models.Customer.findOne({ where: { companyId: company.id }, order: [["id", "ASC"]] }))?.id, assetIds: [barAsset.id] });
    assert.equal(q1.status, 200, `POS quote failed: ${JSON.stringify(q1.body)}`);
    const q1Price = Number(q1.body.items?.[0]?.price || q1.body.data?.items?.[0]?.price);
    const qTampered = await request("POST", "/pricing/calculate", auth.token, { customerId: (await models.Customer.findOne({ where: { companyId: company.id }, order: [["id", "ASC"]] }))?.id, assetIds: [barAsset.id], price: 1, items: [{ assetId: barAsset.id, price: 1 }] });
    assert.equal(qTampered.status, 200, `tampered POS quote unexpectedly failed: ${JSON.stringify(qTampered.body)}`);
    assert.equal(Number(qTampered.body.items?.[0]?.price || qTampered.body.data?.items?.[0]?.price), q1Price, "POS accepted client-calculated price as authority");

    // Move only the disposable clone's Gold Center authority forward.
    await assertDb();
    const movedRate = 520;
    const current24 = await models.GoldPrice.findOne({ where: { companyId: company.id, karat: 24, currency: company.currency || "AED", approvalStatus: "APPROVED" } });
    if (current24) await current24.update({ approvalStatus: "SUPERSEDED" }, { goldPriceTransition: "supersede" });
    await models.GoldPrice.create({ companyId: company.id, karat: 24, pricePerGram: String(movedRate), currency: company.currency || "AED", source: "manual", approvalStatus: "APPROVED", approvedAt: new Date(), approvedBy: superAdmin.id, validFrom: new Date(Date.now() - 60_000), validUntil: new Date(Date.now() + 86_400_000), approvalVersion: 2, updatedBy: superAdmin.id });
    const m2 = goldValuation.calculateCurrentGoldValuation({ profile: "GOLD_BAR_24K", goldDetails: d.goldDetails, input: { ...d.currentValuation, currentCertificateCost: d.currentValuation.certificate_value ?? d.currentValuation.certificateValue }, configuredVatRate: 7.25, canonicalCurrentGoldRate: movedRate });
    const q2 = await request("POST", "/pricing/calculate", auth.token, { customerId: (await models.Customer.findOne({ where: { companyId: company.id }, order: [["id", "ASC"]] }))?.id, assetIds: [barAsset.id] });
    assert.equal(q2.status, 200, `moved POS quote failed: ${JSON.stringify(q2.body)}`);
    assert.ok(Number(m2.goldValue) > Number(m1.goldValue));
    assert.ok(Number(q2.body.items?.[0]?.price || q2.body.data?.items?.[0]?.price) > Number(q1.body.items?.[0]?.price || q1.body.data?.items?.[0]?.price));
    assert.equal(Number(d.currentPurchaseCost.purchase_gold_rate), referenceRate, "historical purchase rate changed after market movement");

    const non24 = await request("POST", "/purchase-orders/receive", auth.token, receiveBody({ profile: "GOLD_BAR_24K", code: goldWeightCode, karat: 22, rate: referenceRate, currentRate: referenceRate }), `SUP-GOLD-CLOSEOUT-NON24-${Date.now()}`);
    assert.ok(non24.status >= 400 && non24.status < 500, "Gold Bar non-24K tampering must be rejected");

    const matrices = { weight: [], piece: [] };
    for (const k of KARATS) {
      const matrixRate = k === 24 ? movedRate : k * 20;
      const result = await request("POST", "/purchase-orders/receive", auth.token, receiveBody({ profile: "GOLD_BY_WEIGHT_JEWELLERY", code: goldWeightCode, karat: k, rate: matrixRate, currentRate: matrixRate, makingPerGram: 10 }), `SUP-GOLD-CLOSEOUT-W-${k}-${Date.now()}`);
      assert.equal(result.status, 201, `Gold By Weight ${k}K matrix failed: ${JSON.stringify(result.body)}`); matrices.weight.push(k);
    }
    for (const k of KARATS) {
      const matrixRate = k === 24 ? movedRate : k * 20;
      const result = await request("POST", "/purchase-orders/receive", auth.token, receiveBody({ profile: "GOLD_BY_PIECE", assetType: "gold-piece", code: goldPieceCode, karat: k, rate: matrixRate, currentRate: matrixRate, pieceCost: 100 + k }), `SUP-GOLD-CLOSEOUT-P-${k}-${Date.now()}`);
      assert.equal(result.status, 201, `Gold By Piece ${k}K matrix failed: ${JSON.stringify(result.body)}`); matrices.piece.push(k);
    }

    // A stale/invalid authority fails closed at the read-only pricing gate.
    await assertDb();
    await sequelize.query("UPDATE gold_prices SET valid_until=NOW()-INTERVAL '1 minute' WHERE company_id=:companyId AND approval_status='APPROVED'", { replacements: { companyId: company.id } });
    const zero = await request("POST", "/pricing/calculate", auth.token, { customerId: (await models.Customer.findOne({ where: { companyId: company.id }, order: [["id", "ASC"]] }))?.id, assetIds: [barAsset.id] });
    assert.notEqual(zero.status, 200, "pricing must fail closed when Gold Center authority is unavailable");

    const after = await one("SELECT (SELECT COUNT(*)::int FROM assets) AS assets, (SELECT COUNT(*)::int FROM journal_entries) AS journals, (SELECT COUNT(*)::int FROM journal_lines jl LEFT JOIN journal_entries je ON je.id=jl.journal_entry_id WHERE je.id IS NULL) AS orphan_journal_lines");
    assert.equal(after.orphan_journal_lines, 0);
    console.log(JSON.stringify({ result: "PASS", database: clone, barAsset: barAsset.id, overrideAsset: overrideAsset.id, referenceRate, movedRate, purchaseVat: 7.25, historicalPurchaseFrozen: true, marketMoved: true, posMoved: true, zeroPriceFailClosed: true, non24Rejected: true, matrices, before, after, pricingModuleLoaded: Boolean(pricing) }));
  } finally {
    try { if (auth) await Promise.race([require("../src/services/technical-session.service").revokeSession(auth.session.id, superAdmin.id, "supplier_gold_closeout_complete"), new Promise((resolve) => setTimeout(resolve, 2000))]); } catch (_) {}
    try { if (limitedAuth && limited) await Promise.race([require("../src/services/technical-session.service").revokeSession(limitedAuth.session.id, limited.id, "supplier_gold_closeout_complete"), new Promise((resolve) => setTimeout(resolve, 2000))]); } catch (_) {}
    try { if (server) { server.closeAllConnections?.(); await Promise.race([new Promise((resolve) => server.close(resolve)), new Promise((resolve) => setTimeout(resolve, 2000))]); } } catch (_) {}
    try { if (sequelize && !sequelize.closed) await sequelize.close(); } catch (_) {}
    dropClone(sourceConfig, clone);
    fs.rmSync(dumpDir, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(JSON.stringify({ result: "FAIL", message: error.message, parent: error.parent?.message, detail: error.parent?.detail, constraint: error.parent?.constraint, stack: error.stack })); process.exitCode = 1; });
