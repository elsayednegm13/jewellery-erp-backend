"use strict";

// A deliberately narrow, clone-only acceptance harness for the Purchased
// Gift Voucher foundation. It refuses the official database before it reads
// or writes any business/configuration data. It never creates financial
// accounts: it only maps the existing compatible clone account to the new
// semantic role required by this control.

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const models = require("../src/models");

const CONTROL = "DARFUS-GIFT-VOUCHER-SCHEMA-MINIMUM-SAFE-IMPLEMENTATION-01";
const REQUIRED_MODE = "1";
const REQUIRED_DB = process.env.GV_ACCEPTANCE_DB || "";
const BASE_URL = String(process.env.GV_ACCEPTANCE_BASE_URL || "http://127.0.0.1:8000/api/v1").replace(/\/$/, "");
const EMAIL = process.env.GV_ACCEPTANCE_EMAIL || "";
const PASSWORD = process.env.GV_ACCEPTANCE_PASSWORD || "";
const ROLE = "GIFT_VOUCHER_LIABILITY";

function fail(message) {
  throw new Error(`[${CONTROL}] ${message}`);
}

function key() {
  return crypto.randomUUID();
}

function money(value) {
  return Number(value).toFixed(4);
}

async function responseJson(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; } catch { return { raw: text }; }
}

async function request(path, { method = "GET", token, companyId, branchId, idempotencyKey, body } = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(companyId ? { "x-company-id": companyId } : {}),
      ...(branchId ? { "x-branch-id": branchId } : {}),
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await responseJson(response) };
}

function expectStatus(result, expected, label) {
  assert.equal(result.status, expected, `${label}: expected HTTP ${expected}, got ${result.status}: ${JSON.stringify(result.body)}`);
  return result.body;
}

async function counts(companyId) {
  const [giftVouchers, payments, invoices, journals, journalLines, cashTransactions, movements, printEvents] = await Promise.all([
    models.GiftVoucher.count({ where: { companyId } }),
    models.Payment.count({ where: { companyId } }),
    models.Invoice.count({ where: { companyId } }),
    models.JournalEntry.count({ where: { companyId } }),
    models.JournalLine.count(),
    models.CashTransaction.count({ where: { companyId } }),
    models.sequelize.query(
      "SELECT count(*)::int AS count FROM inventory_asset_movements WHERE company_id=:companyId",
      { replacements: { companyId } },
    ).then(([rows]) => Number(rows[0]?.count || 0)),
    models.GiftVoucherPrintEvent.count({ where: { companyId } }),
  ]);
  return { giftVouchers, payments, invoices, journals, journalLines, cashTransactions, movements, printEvents };
}

function delta(before, after) {
  return Object.fromEntries(Object.keys(before).map((name) => [name, after[name] - before[name]]));
}

async function resolveCloneIdentity() {
  if (process.env.DARFUS_GIFT_VOUCHER_DISPOSABLE_ACCEPTANCE !== REQUIRED_MODE) {
    fail("DARFUS_GIFT_VOUCHER_DISPOSABLE_ACCEPTANCE=1 is required.");
  }
  if (!REQUIRED_DB || REQUIRED_DB === "darfus_erp" || !/^darfus_gift_voucher_schema_impl_01$/i.test(REQUIRED_DB)) {
    fail("GV_ACCEPTANCE_DB must name the approved Gift Voucher disposable clone.");
  }
  const [[current]] = await models.sequelize.query("SELECT current_database() AS database_name");
  if (!current || current.database_name !== REQUIRED_DB || current.database_name === "darfus_erp") {
    fail("The connected database is not the approved disposable clone.");
  }
  return current.database_name;
}

async function ensureCloneSemanticRole({ companyId, branchId }) {
  const existing = await models.SystemAccountRole.findAll({ where: { companyId, branchId, roleCode: ROLE } });
  if (existing.length > 1) fail("Gift Voucher Liability semantic role is ambiguous in the clone.");
  if (existing.length === 1) return existing[0];

  const account = await models.Account.findOne({
    where: {
      companyId,
      code: "2400",
      type: "liability",
      nature: "credit",
      statementClassification: "liability",
      isActive: true,
      isPosting: true,
    },
  });
  if (!account) fail("The clone has no compatible existing Gift Voucher Liability account.");
  return models.SystemAccountRole.create({
    id: `GV-ROLE-${crypto.randomUUID()}`,
    companyId,
    branchId,
    roleCode: ROLE,
    accountId: account.id,
    createdBy: "gift-voucher-disposable-acceptance",
    updatedBy: "gift-voucher-disposable-acceptance",
  });
}

async function login() {
  if (!EMAIL || !PASSWORD) fail("Disposable acceptance credentials are required through environment variables.");
  const result = await request("/auth/login", { method: "POST", body: { email: EMAIL, password: PASSWORD } });
  const body = expectStatus(result, 200, "clone login");
  if (!body?.data?.token || !body?.data?.company?.id) fail("Clone login did not return usable context.");
  return { token: body.data.token, companyId: body.data.company.id };
}

async function preview({ token, companyId, branch, asset }) {
  const result = await request("/pricing/calculate", {
    method: "POST", token, companyId, branchId: branch.id,
    body: { assetIds: [asset.id], branchId: branch.id, paymentMethod: "split" },
  });
  const body = expectStatus(result, 200, `pricing preview for ${asset.id}`);
  const total = Number(body?.data?.total ?? body?.total);
  if (!Number.isFinite(total) || total <= 0) fail(`Pricing preview returned no positive total for ${asset.id}.`);
  return total;
}

async function pricedAssets({ token, companyId, branch, assets }) {
  const priced = [];
  for (const asset of assets) {
    const result = await request("/pricing/calculate", {
      method: "POST", token, companyId, branchId: branch.id,
      body: { assetIds: [asset.id], branchId: branch.id, paymentMethod: "split" },
    });
    if (result.status !== 200) continue;
    const total = Number(result.body?.data?.total ?? result.body?.total);
    if (Number.isFinite(total) && total > 0) priced.push({ asset, total });
  }
  return priced;
}

async function issue({ token, companyId, branch, faceValue, customerId, eligibility = "ALL_BRANCHES", eligibleBranchIds = [] }) {
  const body = {
    faceValue: money(faceValue),
    paymentMethod: "cash",
    branchId: branch.id,
    customerId,
    branchEligibilityMode: eligibility,
    ...(eligibility === "SELECTED_BRANCHES" ? { eligibleBranchIds } : {}),
  };
  const idempotencyKey = key();
  const result = await request("/gift-vouchers/issue", { method: "POST", token, companyId, branchId: branch.id, idempotencyKey, body });
  const response = expectStatus(result, 201, "purchased voucher issue");
  const voucher = response?.data?.voucher || response?.voucher;
  if (!voucher?.voucherCode || voucher.status !== "issued") fail("Voucher issue did not return an ISSUED durable Voucher.");
  return { voucher, body, idempotencyKey, response };
}

async function activate({ token, companyId, branch, voucher }) {
  const result = await request(`/gift-vouchers/${encodeURIComponent(voucher.voucherCode)}/activate`, {
    method: "POST", token, companyId, branchId: branch.id, idempotencyKey: key(), body: { branchId: branch.id },
  });
  const body = expectStatus(result, 200, "voucher activation");
  const active = body?.data?.voucher || body?.voucher;
  if (active?.status !== "active") fail("Voucher activation did not return ACTIVE state.");
  return active;
}

function salePayload({ branch, customer, asset, vouchers = [], cashAmount = 0, notes = "Gift Voucher disposable acceptance" }) {
  return {
    customerId: customer.id,
    customerName: customer.name,
    branchId: branch.id,
    branch: branch.name,
    paymentMethod: "split",
    notes,
    items: [{
      assetId: asset.id,
      name: asset.name,
      quantity: 1,
      price: Number(asset.price || 0),
      cost: Number(asset.cost || 0),
      totalWeight: Number(asset.grossWeight || 0),
      discount: 0,
      makingCharge: 0,
      makingChargePerGram: 0,
      stoneValue: 0,
    }],
    paymentSplits: [
      ...vouchers.map((voucher) => ({ method: "gift_voucher", amount: Number(voucher.faceValue), voucherCode: voucher.voucherCode })),
      ...(cashAmount > 0 ? [{ method: "cash", amount: Number(money(cashAmount)) }] : []),
    ],
  };
}

async function checkout({ token, companyId, branch, payload, idempotencyKey }) {
  return request("/pos/checkout", { method: "POST", token, companyId, branchId: branch.id, idempotencyKey, body: payload });
}

async function issuanceJournalProof(issueResult) {
  const journal = issueResult.response?.data?.journal || issueResult.response?.journal;
  if (!journal?.id) fail("Issue response lacked its journal reference.");
  const lines = await models.JournalLine.findAll({ where: { journalEntryId: journal.id }, raw: true });
  const debit = lines.reduce((sum, line) => sum + Number(line.debit || 0), 0);
  const credit = lines.reduce((sum, line) => sum + Number(line.credit || 0), 0);
  assert.equal(money(debit), money(credit), "issuance journal must balance");
  assert.equal(lines.some((line) => ["4100", "4110", "4111", "4112", "4113", "4119", "2200"].includes(String(line.accountCode))), false, "issuance must not post revenue or VAT");
  assert.equal(lines.some((line) => String(line.accountCode) === "2400" && Number(line.credit) > 0), true, "issuance must credit Voucher Liability");
  return { journalId: journal.id, debit: money(debit), credit: money(credit), accountCodes: lines.map((line) => line.accountCode).sort() };
}

async function redemptionProof({ invoiceId, voucherId, expectedVoucherAmount }) {
  const voucher = await models.GiftVoucher.findByPk(voucherId);
  assert.equal(voucher.status, "redeemed", "successful checkout must redeem the voucher");
  assert.equal(voucher.redemptionInvoiceId, invoiceId, "voucher must link the canonical Invoice");
  assert.ok(voucher.redemptionPaymentId, "voucher must link its canonical Payment");
  const payment = await models.Payment.findByPk(voucher.redemptionPaymentId);
  assert.equal(payment.giftVoucherId, voucherId, "Payment must link the voucher exactly once");
  assert.equal(money(payment.amount), money(expectedVoucherAmount), "Payment must settle exact face value");
  const cashCount = await models.CashTransaction.count({ where: { reference: invoiceId } });
  assert.equal(cashCount, 0, "voucher-only redemption must not create a cash transaction");
  const journal = await models.JournalEntry.findOne({ where: { sourceType: "invoice", sourceId: invoiceId } });
  assert.ok(journal, "checkout must produce canonical Invoice journal");
  assert.equal(money(journal.totalDebit), money(journal.totalCredit), "redemption invoice journal must balance");
  const lines = await models.JournalLine.findAll({ where: { journalEntryId: journal.id }, raw: true });
  const invoice = await models.Invoice.findByPk(invoiceId);
  const accounts = await models.Account.findAll({ where: { id: lines.map((line) => line.accountId) }, raw: true });
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  assert.equal(lines.some((line) => String(line.accountCode) === "2400" && Number(line.debit) > 0), true, "redemption must debit existing Voucher Liability");
  assert.equal(lines.some((line) => accountById.get(line.accountId)?.type === "revenue" && Number(line.credit) > 0), true, "Sales Invoice remains Revenue authority");
  assert.equal(lines.some((line) => accountById.get(line.accountId)?.type === "liability" && Number(line.credit) === Number(invoice.tax)), true, "Sales Invoice tax engine remains VAT authority");
  return { invoiceId, journalId: journal.id, paymentId: payment.id, journalDebit: money(journal.totalDebit), journalCredit: money(journal.totalCredit) };
}

async function runPrintRetry() {
  const database = await resolveCloneIdentity();
  const { token, companyId } = await login();
  const redeemed = await models.GiftVoucher.findAll({
    where: { companyId, status: "redeemed" },
    order: [["created_at", "DESC"]],
  });
  let voucher = null;
  for (const candidate of redeemed) {
    const priorEvents = await models.GiftVoucherPrintEvent.count({ where: { voucherId: candidate.id } });
    if (priorEvents === 0) {
      voucher = candidate;
      break;
    }
  }
  if (!voucher) fail("No unprinted redeemed Voucher is available in the disposable clone for print/reprint retry proof.");
  const branch = await models.Branch.findByPk(voucher.issueBranchId);
  if (!branch?.isActive) fail("The selected disposable Voucher has no active issue Branch.");
  const original = await request(`/gift-vouchers/${encodeURIComponent(voucher.voucherCode)}/print-events`, {
    method: "POST", token, companyId, branchId: branch.id, idempotencyKey: key(), body: { branchId: branch.id },
  });
  const originalBody = expectStatus(original, 201, "Voucher original print retry");
  const reprint = await request(`/gift-vouchers/${encodeURIComponent(voucher.voucherCode)}/print-events`, {
    method: "POST", token, companyId, branchId: branch.id, idempotencyKey: key(), body: { branchId: branch.id },
  });
  const reprintBody = expectStatus(reprint, 201, "Voucher reprint retry");
  assert.equal((originalBody?.data?.event || originalBody?.event)?.printKind, "original");
  assert.equal((reprintBody?.data?.event || reprintBody?.event)?.printKind, "reprint");
  const events = await models.GiftVoucherPrintEvent.findAll({ where: { voucherId: voucher.id }, order: [["printed_at", "ASC"]], raw: true });
  assert.deepEqual(events.map((event) => event.printKind), ["original", "reprint"]);
  console.log(JSON.stringify({ control: CONTROL, database, printRetry: "PASS", voucherCodePrefix: voucher.voucherCode.slice(0, 3), printKinds: events.map((event) => event.printKind) }, null, 2));
}

async function main() {
  if (process.env.GV_ACCEPTANCE_PRINT_RETRY === "1") return runPrintRetry();
  const database = await resolveCloneIdentity();
  const { token, companyId } = await login();
  const branches = await models.Branch.findAll({ where: { companyId, isActive: true }, order: [["name", "ASC"]] });
  if (branches.length < 2) fail("The disposable clone needs two active branches for eligibility proof.");
  const branchOne = branches[0];
  const branchTwo = branches[1];
  await Promise.all([
    ensureCloneSemanticRole({ companyId, branchId: branchOne.id }),
    ensureCloneSemanticRole({ companyId, branchId: branchTwo.id }),
  ]);
  const customer = await models.Customer.findOne({ where: { companyId, status: "active" }, order: [["created_at", "ASC"]] });
  if (!customer) fail("The clone has no existing active Customer for POS acceptance.");
  const assetsOne = await models.Asset.findAll({ where: { companyId, branchId: branchOne.id, status: "available", operationalStatus: "AVAILABLE" }, order: [["created_at", "ASC"]] });
  const assetsTwo = await models.Asset.findAll({ where: { companyId, branchId: branchTwo.id, status: "available", operationalStatus: "AVAILABLE" }, order: [["created_at", "ASC"]] });
  const [pricedOne, pricedTwo] = await Promise.all([
    pricedAssets({ token, companyId, branch: branchOne, assets: assetsOne }),
    pricedAssets({ token, companyId, branch: branchTwo, assets: assetsTwo }),
  ]);
  // Rejected scenarios do not mutate an Asset, so their controlled payloads
  // may reuse a known-price Asset. Successful paths require three separate
  // Assets in Branch 1 and one in Branch 2. Invalid profile master data is
  // deliberately out of scope and is not silently repaired by this control.
  if (pricedOne.length < 3 || pricedTwo.length < 1) {
    fail("The clone lacks enough server-priceable serialized Assets for Gift Voucher acceptance.");
  }

  const before = await counts(companyId);
  const issueOne = await issue({ token, companyId, branch: branchTwo, faceValue: pricedTwo[0].total, customerId: customer.id });
  const issueReplay = await request("/gift-vouchers/issue", { method: "POST", token, companyId, branchId: branchTwo.id, idempotencyKey: issueOne.idempotencyKey, body: issueOne.body });
  expectStatus(issueReplay, 201, "idempotent voucher issue replay");
  assert.equal((issueReplay.body?.data?.voucher || issueReplay.body?.voucher)?.id, issueOne.voucher.id, "issue replay must retain the same Voucher");
  const issuanceJournal = await issuanceJournalProof(issueOne);
  await activate({ token, companyId, branch: branchTwo, voucher: issueOne.voucher });

  const lookup = await request(`/gift-vouchers/${encodeURIComponent(issueOne.voucher.voucherCode)}`, { token, companyId, branchId: branchTwo.id });
  expectStatus(lookup, 200, "voucher lookup");
  assert.equal((lookup.body?.data || lookup.body)?.voucherCode, issueOne.voucher.voucherCode, "lookup must retain Voucher Code identity");

  const partialKey = key();
  const partialPayload = salePayload({ branch: branchTwo, customer, asset: pricedTwo[0].asset, vouchers: [{ ...issueOne.voucher, faceValue: Number(issueOne.voucher.faceValue) / 2 }] });
  const partialBefore = await counts(companyId);
  const partial = await checkout({ token, companyId, branch: branchTwo, payload: partialPayload, idempotencyKey: partialKey });
  assert.equal(partial.status, 422, `partial Voucher redemption must fail closed, got ${partial.status}`);
  assert.equal(partial.body?.error?.code || partial.body?.code, "GIFT_VOUCHER_FULL_VALUE_REQUIRED", "partial rejection must expose the stable business code");
  assert.deepEqual(await counts(companyId), partialBefore, "partial redemption must leave zero business side effects");

  const fullPayload = salePayload({ branch: branchTwo, customer, asset: pricedTwo[0].asset, vouchers: [issueOne.voucher] });
  const fullKey = key();
  const full = await checkout({ token, companyId, branch: branchTwo, payload: fullPayload, idempotencyKey: fullKey });
  const fullBody = expectStatus(full, 201, "full Voucher redemption through canonical POS");
  const fullInvoice = fullBody?.data || fullBody;
  const redemption = await redemptionProof({ invoiceId: fullInvoice.id, voucherId: issueOne.voucher.id, expectedVoucherAmount: issueOne.voucher.faceValue });
  const replayBefore = await counts(companyId);
  const fullReplay = await checkout({ token, companyId, branch: branchTwo, payload: fullPayload, idempotencyKey: fullKey });
  const fullReplayBody = expectStatus(fullReplay, 201, "idempotent POS replay");
  assert.equal((fullReplayBody?.data || fullReplayBody)?.id, fullInvoice.id, "POS replay must return the original Invoice");
  assert.deepEqual(await counts(companyId), replayBefore, "idempotent replay must not add business rows");
  const changedReplay = await checkout({ token, companyId, branch: branchTwo, payload: { ...fullPayload, notes: "changed payload must conflict" }, idempotencyKey: fullKey });
  assert.equal(changedReplay.status, 409, "changed payload under same POS key must conflict");

  const secondPayload = salePayload({ branch: branchOne, customer, asset: pricedOne[0].asset, vouchers: [issueOne.voucher], cashAmount: pricedOne[0].total - Number(issueOne.voucher.faceValue) });
  const second = await checkout({ token, companyId, branch: branchOne, payload: secondPayload, idempotencyKey: key() });
  assert.ok([409, 422].includes(second.status), "second redemption must fail closed");
  assert.equal(second.body?.error?.code || second.body?.code, "GIFT_VOUCHER_NOT_REDEEMABLE", "second redemption must reject voucher state");

  const wrongBranchTotal = pricedOne[0].total;
  const wrongBranchIssue = await issue({ token, companyId, branch: branchTwo, faceValue: wrongBranchTotal, customerId: customer.id, eligibility: "SELECTED_BRANCHES", eligibleBranchIds: [branchTwo.id] });
  await activate({ token, companyId, branch: branchTwo, voucher: wrongBranchIssue.voucher });
  const wrongBranch = await checkout({ token, companyId, branch: branchOne, payload: salePayload({ branch: branchOne, customer, asset: pricedOne[0].asset, vouchers: [wrongBranchIssue.voucher] }), idempotencyKey: key() });
  assert.equal(wrongBranch.status, 422, "ineligible Branch redemption must fail");
  assert.equal(wrongBranch.body?.error?.code || wrongBranch.body?.code, "GIFT_VOUCHER_BRANCH_INELIGIBLE", "wrong Branch must expose the stable code");

  const inactiveTotal = pricedOne[0].total;
  const inactiveIssue = await issue({ token, companyId, branch: branchOne, faceValue: inactiveTotal, customerId: customer.id });
  const inactive = await checkout({ token, companyId, branch: branchOne, payload: salePayload({ branch: branchOne, customer, asset: pricedOne[0].asset, vouchers: [inactiveIssue.voucher] }), idempotencyKey: key() });
  assert.equal(inactive.status, 409, "issued-but-inactive Voucher redemption must fail");
  assert.equal(inactive.body?.error?.code || inactive.body?.code, "GIFT_VOUCHER_NOT_REDEEMABLE", "inactive Voucher must expose the stable code");

  const mixedTotal = pricedOne[0].total;
  const mixedVoucherValue = Number((mixedTotal / 3).toFixed(4));
  const mixedIssue = await issue({ token, companyId, branch: branchTwo, faceValue: mixedVoucherValue, customerId: customer.id });
  await activate({ token, companyId, branch: branchTwo, voucher: mixedIssue.voucher });
  const mixedCash = Number((mixedTotal - mixedVoucherValue).toFixed(4));
  const mixed = await checkout({ token, companyId, branch: branchOne, payload: salePayload({ branch: branchOne, customer, asset: pricedOne[0].asset, vouchers: [mixedIssue.voucher], cashAmount: mixedCash, notes: "Mixed Gift Voucher acceptance" }), idempotencyKey: key() });
  expectStatus(mixed, 201, "mixed Voucher and cash settlement");

  const multipleTotal = pricedOne[1].total;
  const firstVoucherValue = Number((multipleTotal / 4).toFixed(4));
  const secondVoucherValue = Number((multipleTotal / 5).toFixed(4));
  const multiIssueOne = await issue({ token, companyId, branch: branchOne, faceValue: firstVoucherValue, customerId: customer.id });
  const multiIssueTwo = await issue({ token, companyId, branch: branchOne, faceValue: secondVoucherValue, customerId: customer.id });
  await activate({ token, companyId, branch: branchOne, voucher: multiIssueOne.voucher });
  await activate({ token, companyId, branch: branchOne, voucher: multiIssueTwo.voucher });
  const multiCash = Number((multipleTotal - firstVoucherValue - secondVoucherValue).toFixed(4));
  const multiple = await checkout({ token, companyId, branch: branchOne, payload: salePayload({ branch: branchOne, customer, asset: pricedOne[1].asset, vouchers: [multiIssueOne.voucher, multiIssueTwo.voucher], cashAmount: multiCash, notes: "Multiple Gift Voucher acceptance" }), idempotencyKey: key() });
  expectStatus(multiple, 201, "multiple fully consumed Vouchers and cash settlement");

  const concurrentTotal = pricedOne[2].total;
  const concurrentIssue = await issue({ token, companyId, branch: branchOne, faceValue: concurrentTotal, customerId: customer.id });
  await activate({ token, companyId, branch: branchOne, voucher: concurrentIssue.voucher });
  const concurrentPayload = salePayload({ branch: branchOne, customer, asset: pricedOne[2].asset, vouchers: [concurrentIssue.voucher], notes: "Concurrent Gift Voucher acceptance" });
  const concurrent = await Promise.all([
    checkout({ token, companyId, branch: branchOne, payload: concurrentPayload, idempotencyKey: key() }),
    checkout({ token, companyId, branch: branchOne, payload: concurrentPayload, idempotencyKey: key() }),
  ]);
  assert.equal(concurrent.filter((result) => result.status === 201).length, 1, "concurrent double redemption must have exactly one success");
  assert.equal(concurrent.filter((result) => result.status !== 201).length, 1, "concurrent double redemption must have exactly one rejection");

  const printOriginal = await request(`/gift-vouchers/${encodeURIComponent(issueOne.voucher.voucherCode)}/print-events`, { method: "POST", token, companyId, branchId: branchTwo.id, idempotencyKey: key(), body: { branchId: branchTwo.id } });
  const printOriginalBody = expectStatus(printOriginal, 201, "Voucher original print event");
  const printReprint = await request(`/gift-vouchers/${encodeURIComponent(issueOne.voucher.voucherCode)}/print-events`, { method: "POST", token, companyId, branchId: branchTwo.id, idempotencyKey: key(), body: { branchId: branchTwo.id } });
  const printReprintBody = expectStatus(printReprint, 201, "Voucher reprint event");
  assert.equal((printOriginalBody?.data?.event || printOriginalBody?.event)?.printKind, "original", "first print must be original");
  assert.equal((printReprintBody?.data?.event || printReprintBody?.event)?.printKind, "reprint", "second print must be reprint");
  const printedVoucher = await models.GiftVoucher.findByPk(issueOne.voucher.id);
  assert.equal(printedVoucher.voucherCode, issueOne.voucher.voucherCode, "print/reprint must preserve Voucher Code");
  assert.equal(printedVoucher.voucherNumber, issueOne.voucher.voucherNumber, "print/reprint must preserve Voucher Number");

  const after = await counts(companyId);
  const summary = {
    control: CONTROL,
    database,
    companyId,
    branches: [branchOne.id, branchTwo.id],
    initialCounts: before,
    finalCounts: after,
    delta: delta(before, after),
    issuanceJournal,
    redemption,
    voucherCodePrefix: issueOne.voucher.voucherCode.slice(0, 3),
    printKinds: [(printOriginalBody?.data?.event || printOriginalBody?.event)?.printKind, (printReprintBody?.data?.event || printReprintBody?.event)?.printKind],
    scenarios: {
      issueIdempotency: "PASS", partial: "REJECTED", fullRedemption: "PASS", redemptionIdempotency: "PASS", payloadConflict: "PASS",
      secondRedemption: "REJECTED", branchEligibility: "REJECTED", inactive: "REJECTED", mixedPayment: "PASS", multipleVouchers: "PASS", concurrency: "EXACTLY_ONE_SUCCESS", printReprint: "PASS",
    },
  };
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; })
  .finally(async () => { await models.sequelize.close(); });
