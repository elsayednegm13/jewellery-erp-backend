"use strict";

// Disposable PostgreSQL-clone proof for CGP-IMP-10A.  This deliberately calls
// the real reservation service and ERP route handlers; it never substitutes a
// bare inventory transition for a surrounding business operation.
const assert = require("assert/strict");
const path = require("path");
const { AsyncLocalStorage } = require("async_hooks");
const { Op, QueryTypes } = require("sequelize");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const DB = String(process.env.CGP_IMP10A_RACE_DB || "").trim();
const PREFIX = /^darfus_erp_cgp_imp10a_race_[a-z0-9_]+$/;
if (!PREFIX.test(DB)) throw new Error("CGP_IMP10A_RACE_DATABASE_REQUIRED");
process.env.DATABASE_URL = "";
process.env.DB_NAME = DB;

const models = require("../src/models");
const erpRouter = require("../src/routes/erp.routes");
const reservationService = require("../src/services/reservation.service");
const draft = require("../src/services/gold-purchase-draft.service");
const posting = require("../src/services/cgp-posting.service");
const permissions = require("../src/services/permission.service");
const inventoryConsumer = require("../src/services/cgp-inventory-consumer.service");
const accountingConsumer = require("../src/services/cgp-accounting-consumer.service");
const goldConsumer = require("../src/services/cgp-gold-center-consumer.service");
const availability = require("../src/services/cgp-availability-evaluator.service");
const hold = require("../src/services/cgp-reversal-hold.service");
const holdConsumer = require("../src/services/cgp-reversal-hold-inventory-consumer.service");
const runtime = require("../src/services/inventory-v2-runtime.service");

const MARKER = "CGP_IMP10A_FULL_PATH_TEST";
const lockScope = new AsyncLocalStorage();
const originalTransitionAsset = runtime.transitionAsset;
const originalFindByPk = models.Asset.findByPk.bind(models.Asset);
let activeCheckpoint = null;

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

// Test-only instrumentation.  The production transition implementation is not
// edited: this wrapper merely tags each asynchronous caller in the harness.
// The patched model method signals only after the original `findByPk(... FOR
// UPDATE)` has returned, i.e. after the decisive row lock is actually held.
runtime.transitionAsset = (args) => lockScope.run({
  role: args.toStatus === "REVERSAL_PENDING" ? "HOLD" : "BUSINESS",
  assetId: args.assetId || args.asset?.id || null,
}, () => originalTransitionAsset(args));
models.Asset.findByPk = async function instrumentedFindByPk(id, options = {}) {
  const row = await originalFindByPk(id, options);
  const scope = lockScope.getStore();
  if (activeCheckpoint && row && scope?.assetId === id && options.transaction && options.lock && scope.role === activeCheckpoint.role) {
    activeCheckpoint.acquired.resolve({ role: scope.role, assetId: id });
    await activeCheckpoint.release.promise;
  }
  return row;
};

async function waitForLock(checkpoint, label) {
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error(`RACE_LOCK_CHECKPOINT_TIMEOUT:${label}`)), 15000));
  return Promise.race([checkpoint.acquired.promise, timeout]);
}

async function assertTarget() {
  const rows = await models.sequelize.query("SELECT current_database() AS db", { type: QueryTypes.SELECT });
  assert.equal(rows[0]?.db, DB, "race test refuses a non-clone database");
}

async function context() {
  for (const company of await models.Company.findAll({ order: [["id", "ASC"]] })) {
    const branches = await models.Branch.findAll({ where: { companyId: company.id, isActive: true }, order: [["id", "ASC"]] });
    const customer = await models.Customer.findOne({ where: { companyId: company.id, status: "active" } });
    const price = await models.GoldPrice.findOne({ where: { companyId: company.id, currency: company.currency || "AED", karat: 21, approvalStatus: "APPROVED", validFrom: { [Op.lte]: new Date() }, validUntil: { [Op.gt]: new Date() } } });
    if (!customer || !price || branches.length < 2) continue;
    // CGP accounting is deliberately branch-mapped.  The test must use the
    // active, financially configured source branch; the destination branch is
    // only used by the transfer path and is never its financial authority.
    const mapped = [];
    for (const branch of branches) {
      const mappingCount = await models.BranchFinancialMapping.count({ where: { companyId: company.id, branchId: branch.id, isActive: true } });
      if (mappingCount >= 11) mapped.push(branch);
    }
    if (!mapped.length) continue;
    for (const user of await models.User.findAll({ where: { companyId: company.id }, order: [["id", "ASC"]] })) {
      const raw = user.toJSON();
      if (await permissions.userHasPermission(raw, posting.POST_PERMISSION) && await permissions.userHasPermission(raw, hold.REVERSE_PERMISSION)) {
        // The route handlers below are invoked after the production auth layers;
        // super-admin context lets their own sales-operator policy take its
        // canonical no-session branch without bypassing a business transaction.
        const sourceBranch = mapped[0];
        const otherBranch = branches.find((branch) => branch.id !== sourceBranch.id);
        return { company: company.toJSON(), customer: customer.toJSON(), branch: sourceBranch.toJSON(), otherBranch: otherBranch.toJSON(), user: { ...raw, accountType: "super_admin", isAdmin: true } };
      }
    }
  }
  throw new Error("CGP_IMP10A_FULL_PATH_CONTEXT_NOT_FOUND");
}

async function createAvailableCgpAsset(ctx, label) {
  const made = await models.sequelize.transaction(async (transaction) => {
    const document = await draft.create("cgp", { companyId: ctx.company.id, branchId: ctx.branch.id, user: ctx.user }, {
      branchId: ctx.branch.id, customerId: ctx.customer.id, transactionDate: "2026-08-10", currency: ctx.company.currency || "AED", exchangeRate: "1",
      notes: `${MARKER}:${label}`,
      items: [{ goldType: `${MARKER}-${label}`, karat: "21", purityFactor: "0.875", fineness: "0.875", grossWeight: "8.000000", stoneWeight: "0.100000", proposedRate: "999.0000", referenceMarketRate: "888.0000" }],
    }, transaction);
    const validated = await draft.validate("cgp", { companyId: ctx.company.id, branchId: ctx.branch.id, user: ctx.user }, document.id, document.version, transaction);
    return posting.post({ context: { companyId: ctx.company.id, branchId: ctx.branch.id, user: ctx.user }, id: validated.id, expectedVersion: validated.version, correlationId: `${MARKER}:${label}:POST`, transaction });
  });
  const eventId = made.outboxEvent.eventId;
  await inventoryConsumer.consumePostedEvent({ eventId });
  await accountingConsumer.consumePostedEvent({ eventId });
  await goldConsumer.consumePostedEvent({ eventId });
  await availability.evaluateAvailability({ eventId });
  const rows = await models.sequelize.query(`SELECT a.id,a.barcode,a.price,a.cost,a.operational_status AS status
    FROM assets a JOIN asset_origins ao ON ao.asset_id=a.id JOIN customer_gold_purchase_items i ON i.id=ao.cgp_item_id
    WHERE i.document_id=:documentId`, { replacements: { documentId: made.document.id }, type: QueryTypes.SELECT });
  assert.equal(rows.length, 1); assert.equal(rows[0].status, "AVAILABLE");
  return { document: made.document, asset: rows[0] };
}

async function requestHold(ctx, document, label) {
  return models.sequelize.transaction((transaction) => hold.requestHold({
    context: { companyId: ctx.company.id, branchId: ctx.branch.id, user: ctx.user }, cgpDocumentId: document.id,
    reason: `${MARKER}:${label}`, idempotencyKey: `${MARKER}:${label}:HOLD`, correlationId: `${MARKER}:${label}:HOLD`, transaction,
  }));
}

function routeHandler(pathname) {
  const layer = erpRouter.stack.find((entry) => entry.route?.path === pathname && entry.route.methods?.post);
  if (!layer) throw new Error(`ERP_ROUTE_NOT_FOUND:${pathname}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

async function invokeRoute(pathname, ctx, body, idempotencyKey) {
  const handler = routeHandler(pathname);
  let responded = false;
  let payload = null;
  let statusCode = 200;
  const req = {
    body, params: {}, query: {}, companyId: ctx.company.id, branchId: ctx.branch.id, user: ctx.user,
    headers: { "x-branch-id": ctx.branch.id, "idempotency-key": idempotencyKey },
    get(name) { return this.headers[String(name).toLowerCase()]; },
  };
  const res = { status(code) { statusCode = code; return this; }, json(value) { responded = true; payload = value; return value; } };
  let nextError = null;
  await Promise.resolve(handler(req, res, (error) => { nextError = error || new Error("ROUTE_NEXT_WITHOUT_ERROR"); }));
  if (nextError) throw nextError;
  if (!responded) throw new Error(`ERP_ROUTE_NO_RESPONSE:${pathname}`);
  if (statusCode >= 400) {
    const error = new Error(payload?.message || `ERP_ROUTE_STATUS_${statusCode}`);
    error.statusCode = statusCode; error.payload = payload; throw error;
  }
  return payload;
}

function businessOperation(kind, ctx, source, label) {
  const key = `${MARKER}:${label}:${kind}`;
  if (kind === "RESERVE") return () => reservationService.createReservation({
    companyId: ctx.company.id, branchId: ctx.branch.id, user: ctx.user, idempotencyKey: key,
    body: { customerId: ctx.customer.id, items: [{ assetId: source.asset.id, agreedPrice: String(source.asset.price || 1000) }], initialPayment: { amount: "1.0000", paymentMethod: "cash" }, expiresAt: "2026-12-31T23:59:59.000Z", notes: `${MARKER}:${label}` },
  });
  if (kind === "TRANSFER") return () => invokeRoute("/transfers", ctx, { assetIds: [source.asset.id], fromBranchId: ctx.branch.id, toBranchId: ctx.otherBranch.id, notes: `${MARKER}:${label}` }, key);
  if (kind === "SALE") return () => invokeRoute("/pos/checkout", ctx, { customerId: ctx.customer.id, branchId: ctx.branch.id, items: [{ assetId: source.asset.id, price: Number(source.asset.price || 1000) }], paymentMethod: "cash", notes: `${MARKER}:${label}` }, key);
  if (kind === "WORKSHOP") return () => invokeRoute("/inventory-v2/workshop-orders", ctx, { assetIds: [source.asset.id], orderNumber: `${MARKER}:${label}`, providerName: MARKER, notes: `${MARKER}:${label}` }, key);
  if (kind === "MELTING") return () => invokeRoute("/inventory-v2/melt-orders", ctx, { inputAssetIds: [source.asset.id], outputs: [], reason: `${MARKER}:${label}` }, key);
  throw new Error(`UNKNOWN_BUSINESS_OPERATION:${kind}`);
}

async function race(ctx, kind, ordering) {
  const label = `${kind}_${ordering}`;
  const source = await createAvailableCgpAsset(ctx, label);
  const reversal = await requestHold(ctx, source.document, label);
  const operation = businessOperation(kind, ctx, source, label);
  const checkpoint = { role: ordering === "HOLD_WINS" ? "HOLD" : "BUSINESS", acquired: deferred(), release: deferred() };
  activeCheckpoint = checkpoint;
  let settled;
  if (ordering === "HOLD_WINS") {
    const held = holdConsumer.consumeHoldEvent({ eventId: reversal.holdEventId });
    await waitForLock(checkpoint, `${kind}:HOLD`);
    const business = operation();
    checkpoint.release.resolve();
    settled = await Promise.allSettled([held, business]);
  } else {
    const business = operation();
    await waitForLock(checkpoint, `${kind}:BUSINESS`);
    const held = holdConsumer.consumeHoldEvent({ eventId: reversal.holdEventId });
    checkpoint.release.resolve();
    settled = await Promise.allSettled([business, held]);
  }
  activeCheckpoint = null;
  const successes = settled.filter((item) => item.status === "fulfilled").length;
  assert.equal(successes, 1, `${kind}/${ordering} must have exactly one durable winner: ${settled.map((item) => item.status === "rejected" ? `${item.status}:${item.reason?.message || item.reason?.errorCode || "unknown"}` : item.status).join("|")}`);
  const asset = await models.Asset.findByPk(source.asset.id);
  const businessStatus = { RESERVE: "RESERVED", TRANSFER: "PENDING_TRANSFER", SALE: "SOLD", WORKSHOP: "WORKSHOP", MELTING: "MELTED" }[kind];
  const expected = ordering === "HOLD_WINS" ? "REVERSAL_PENDING" : businessStatus;
  assert.equal(asset.operationalStatus, expected, `${kind}/${ordering} final state; ${settled.map((item) => item.status === "rejected" ? `${item.reason?.message || item.reason?.errorCode || "unknown"}` : "fulfilled").join("|")}`);
  const request = await models.CgpReversalRequest.findOne({ where: { cgpDocumentId: source.document.id } });
  if (ordering === "HOLD_WINS") assert.equal(request.status, "HELD");
  else assert.notEqual(request.status, "HELD");
  const effects = await residueCounts(ctx, kind, label, source.asset.id);
  if (ordering === "HOLD_WINS") assert.deepEqual(effects, Object.fromEntries(Object.keys(effects).map((key) => [key, 0])), `${kind}/${ordering} left business residue`);
  return { label, source, expected, finalStatus: asset.operationalStatus, requestStatus: request.status, effects, results: settled.map((item) => item.status) };
}

async function residueCounts(ctx, kind, label, assetId) {
  const marker = `${MARKER}:${label}`;
  const count = async (sql, replacements) => Number((await models.sequelize.query(sql, { replacements, type: QueryTypes.SELECT }))[0]?.count || 0);
  if (kind === "RESERVE") return { reservations: await count("SELECT count(*)::int count FROM reservations WHERE company_id=:companyId AND notes=:marker", { companyId: ctx.company.id, marker }), reservationItems: await count("SELECT count(*)::int count FROM reservation_items ri JOIN reservations r ON r.id=ri.reservation_id WHERE r.company_id=:companyId AND r.notes=:marker", { companyId: ctx.company.id, marker }), reservationPayments: await count("SELECT count(*)::int count FROM reservation_payments rp JOIN reservations r ON r.id=rp.reservation_id WHERE r.company_id=:companyId AND r.notes=:marker", { companyId: ctx.company.id, marker }) };
  if (kind === "TRANSFER") return { transfers: await count("SELECT count(*)::int count FROM transfers WHERE company_id=:companyId AND notes=:marker", { companyId: ctx.company.id, marker }), transferItems: await count("SELECT count(*)::int count FROM transfer_items ti JOIN transfers t ON t.id=ti.transfer_id WHERE t.company_id=:companyId AND t.notes=:marker", { companyId: ctx.company.id, marker }) };
  if (kind === "SALE") return { invoices: await count("SELECT count(*)::int count FROM invoices WHERE company_id=:companyId AND notes=:marker", { companyId: ctx.company.id, marker }), invoiceItems: await count("SELECT count(*)::int count FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id WHERE i.company_id=:companyId AND i.notes=:marker", { companyId: ctx.company.id, marker }), movements: await count("SELECT count(*)::int count FROM inventory_asset_movements WHERE asset_id=:assetId AND movement_type='SALE'", { assetId }), journals: await count("SELECT count(*)::int count FROM journal_entries WHERE company_id=:companyId AND source_id IN (SELECT id FROM invoices WHERE notes=:marker)", { companyId: ctx.company.id, marker }), treasury: await count("SELECT count(*)::int count FROM cash_transactions WHERE company_id=:companyId AND reference IN (SELECT id FROM invoices WHERE notes=:marker)", { companyId: ctx.company.id, marker }) };
  if (kind === "WORKSHOP") return { workshopOrders: await count("SELECT count(*)::int count FROM inventory_workshop_orders WHERE company_id=:companyId AND order_number=:marker", { companyId: ctx.company.id, marker }), workshopItems: await count("SELECT count(*)::int count FROM inventory_workshop_items wi JOIN inventory_workshop_orders wo ON wo.id=wi.workshop_order_id WHERE wo.company_id=:companyId AND wo.order_number=:marker", { companyId: ctx.company.id, marker }), movements: await count("SELECT count(*)::int count FROM inventory_asset_movements WHERE asset_id=:assetId AND movement_type='WORKSHOP_OUT'", { assetId }) };
  return { manufacturingOrders: await count("SELECT count(*)::int count FROM manufacturing_orders WHERE company_id=:companyId AND notes=:marker", { companyId: ctx.company.id, marker }), manufacturingInputs: await count("SELECT count(*)::int count FROM manufacturing_order_inputs mi JOIN manufacturing_orders mo ON mo.id=mi.manufacturing_order_id WHERE mo.company_id=:companyId AND mo.notes=:marker", { companyId: ctx.company.id, marker }), movements: await count("SELECT count(*)::int count FROM inventory_asset_movements WHERE asset_id=:assetId AND movement_type='MELT_OUT'", { assetId }) };
}

async function main() {
  await assertTarget();
  const ctx = await context();
  const out = {};
  for (const kind of ["RESERVE", "TRANSFER", "SALE", "WORKSHOP", "MELTING"]) {
    out[`${kind}_HOLD_WINS`] = await race(ctx, kind, "HOLD_WINS");
    out[`${kind}_BUSINESS_WINS`] = await race(ctx, kind, "BUSINESS_WINS");
  }
  const integrity = (await models.sequelize.query(`SELECT
    (SELECT count(*)::int FROM journal_entries WHERE status='posted' AND total_debit<>total_credit) AS unbalanced,
    (SELECT count(*)::int FROM journal_lines l LEFT JOIN journal_entries j ON j.id=l.journal_entry_id WHERE j.id IS NULL) AS orphan_lines`, { type: QueryTypes.SELECT }))[0];
  assert.deepEqual(integrity, { unbalanced: 0, orphan_lines: 0 });
  console.log(JSON.stringify({ database: DB, marker: MARKER, paths: { reserve: "reservation.service#createReservation", transfer: "erp.routes#/transfers", sale: "erp.routes#/pos/checkout", workshop: "erp.routes#/inventory-v2/workshop-orders", melting: "erp.routes#/inventory-v2/melt-orders" }, outcomes: out, integrity }));
  console.log("CGP_IMP_10A_FULL_BUSINESS_PATH_RACES: PASS");
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; }).finally(async () => { await models.sequelize.close(); });
