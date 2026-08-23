"use strict";

// Clone-only runtime proof. The target guard intentionally rejects darfus_erp.
const assert = require("node:assert/strict");
const { QueryTypes } = require("sequelize");
const models = require("../src/models");
const sessions = require("../src/services/technical-session.service");

const targetPattern = /^darfus_erp_gbw_profile_02_/;

async function main() {
  const database = (await models.sequelize.query("SELECT current_database() AS db", { type: QueryTypes.SELECT }))[0].db;
  assert.match(database, targetPattern, "GBW02 runtime writes require the exact disposable clone prefix");
  const company = await models.Company.findOne({ order: [["id", "ASC"]] });
  const branch = await models.Branch.findOne({ where: { companyId: company.id, isActive: true }, order: [["id", "ASC"]] });
  const supplier = await models.Supplier.findOne({ where: { companyId: company.id, id: "SUP-GBW02-CLONE" } });
  const user = await models.User.findOne({ where: { companyId: company.id, isActive: true }, order: [["id", "ASC"]] });
  const device = `gbw02-runtime-${Date.now()}`;
  const auth = await sessions.issueTokens(user, { headers: { "x-device-session-id": device }, ip: "127.0.0.1" });
  const headers = { Authorization: `Bearer ${auth.token}`, "X-Device-Session-ID": device, "X-Company-ID": company.id, "X-Branch-ID": branch.id, "Content-Type": "application/json" };
  const request = async (method, path, body, idempotencyKey) => {
    const requestHeaders = { ...headers };
    if (idempotencyKey) requestHeaders["Idempotency-Key"] = idempotencyKey;
    const response = await fetch(`http://127.0.0.1:8120/api/v1${path}`, { method, headers: requestHeaders, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const text = await response.text();
    let parsed; try { parsed = JSON.parse(text); } catch (_) { parsed = { raw: text }; }
    return { status: response.status, body: parsed };
  };
  const contract = await request("GET", "/inventory-v2/gold-by-weight/contract");
  assert.equal(contract.status, 200, JSON.stringify(contract.body));
  const description = contract.body.data.masters.find((row) => row.category === "GOLD_ITEM_DESCRIPTION").label;
  const color = contract.body.data.masters.find((row) => row.category === "GOLD_COLOR").label;
  const itemCode = contract.body.data.barcode.itemCodes.find((row) => row.isActive && row.isClientApproved !== false).code;
  const item = { profile: "GOLD_BY_WEIGHT_JEWELLERY", description, name: description, karat: 21, grossWeight: 10, weightPerUnit: 10, stoneWeight: 2, goldColor: color, makingPerGram: 5, currentMakingPerGram: 5, vatRate: 5 };
  const preview = await request("POST", "/inventory-v2/gold-by-weight/preview", { item });
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.data.weights.netGoldWeight, "8.00000000");
  assert.equal(preview.body.data.weights.pureGoldWeight9999, "7.00000000");
  assert.equal(preview.body.data.purchase.makingTotal, "40.00000000");
  const sale = await request("POST", "/inventory-v2/gold-by-weight/sale-preview", { item, sale: { sellingGoldRate: preview.body.data.current.goldRate, makingPerGram: 3, minimumMakingPerGram: 5 } });
  assert.equal(sale.status, 200, JSON.stringify(sale.body));
  assert.equal(sale.body.data.sale.makingTotal, "24.00000000");
  assert.equal(sale.body.data.sale.approvalRequired, true);
  const count = async () => (await models.sequelize.query(`SELECT
    (SELECT COUNT(*)::int FROM assets) AS assets,
    (SELECT COUNT(*)::int FROM products) AS products,
    (SELECT COUNT(*)::int FROM inventory_asset_movements) AS movements,
    (SELECT COUNT(*)::int FROM journal_entries) AS journals,
    (SELECT COUNT(*)::int FROM asset_origins) AS origins,
    (SELECT COUNT(*)::int FROM asset_purchase_cost_revisions) AS revisions`, { type: QueryTypes.SELECT }))[0];
  const before = await count();
  const body = { id: `GBW02-RUNTIME-DOC-${Date.now()}`, supplierId: supplier.id, branchId: branch.id, warehouseId: branch.id, purchaseDate: "2026-08-17", paymentMethod: "credit", paidAmount: 0, applyVat: true, inventoryV2: true, items: [{ name: description, description, type: "gold-weight", category: "Gold By Weight", inventoryProfile: "GOLD_BY_WEIGHT_JEWELLERY", inventoryCode: "GW", itemCode, quantity: 1, weightPerUnit: item.weightPerUnit, grossWeight: item.grossWeight, unitCost: preview.body.data.purchase.totalPurchaseCost, perPiece: [{ ...item, profile: "GOLD_BY_WEIGHT_JEWELLERY", inventoryProfile: "GOLD_BY_WEIGHT_JEWELLERY", type: "gold-weight", category: "Gold By Weight", inventoryCode: "GW", itemCode, unitCost: preview.body.data.purchase.totalPurchaseCost, goldValuation: { currentGoldRate: preview.body.data.current.goldRate, makingPerGram: 5, currentMakingPerGram: 5, vatRate: 5, currentVatRate: 5 } }] }] };
  const key = `GBW02-RUNTIME-${Date.now()}`;
  const receive = await request("POST", "/purchase-orders/receive", body, key);
  assert.equal(receive.status, 201, JSON.stringify(receive.body));
  const asset = (receive.body.assets || receive.body.data?.assets || receive.body.createdAssets || receive.body.data?.createdAssets || [])[0];
  assert.ok(asset?.id && asset?.barcode, JSON.stringify(receive.body));
  const replay = await request("POST", "/purchase-orders/receive", body, key);
  assert.equal(replay.status, 201, JSON.stringify(replay.body));
  assert.equal((replay.body.assets || replay.body.data?.assets || [])[0]?.id, asset.id);
  const conflict = await request("POST", "/purchase-orders/receive", { ...body, notes: "changed payload" }, key);
  assert.equal(conflict.status, 409, JSON.stringify(conflict.body));
  const legacy = await request("POST", "/purchase-orders/receive", { supplierId: supplier.id, branchId: branch.id, warehouseId: branch.id, inventoryProfile: "GOLD_BY_WEIGHT_JEWELLERY", inventoryV2: false, items: [{ name: description, type: "gold-weight", inventoryProfile: "GOLD_BY_WEIGHT_JEWELLERY", productId: "PRD-FORBIDDEN", quantity: 1, weightPerUnit: 10, unitCost: 100 }] }, `GBW02-LEGACY-${Date.now()}`);
  assert.equal(legacy.status, 422, JSON.stringify(legacy.body));
  assert.equal(legacy.body.error?.code || legacy.body.code, "FINAL_CLIENT_PROFILE_V2_REQUIRED");
  const detail = await request("GET", `/inventory-v2/assets/${encodeURIComponent(asset.id)}`);
  assert.equal(detail.status, 200, JSON.stringify(detail.body));
  assert.equal(Number(detail.body.data.goldDetails.net_gold_weight), 8);
  assert.equal(Number(detail.body.data.currentPurchaseCost.making_total), 40);
  assert.equal(detail.body.data.asset.inventoryProfile, "GOLD_BY_WEIGHT_JEWELLERY");
  const pos = await request("GET", `/pos/search?query=${encodeURIComponent(asset.barcode)}&branchId=${encodeURIComponent(branch.id)}&limit=10`);
  assert.equal(pos.status, 200, JSON.stringify(pos.body));
  const posItems = pos.body.data?.items || pos.body.items || [];
  assert.ok(posItems.some((row) => row.id === asset.id && row.isProduct === false), JSON.stringify(pos.body));
  assert.equal(posItems.some((row) => row.isProduct === true && row.profile === "GOLD_BY_WEIGHT_JEWELLERY"), false);
  const after = await count();
  assert.equal(Number(after.assets) - Number(before.assets), 1);
  assert.equal(Number(after.products) - Number(before.products), 0);
  assert.equal(Number(after.movements) - Number(before.movements), 1);
  assert.equal(Number(after.origins) - Number(before.origins), 1);
  assert.equal(Number(after.revisions) - Number(before.revisions), 1);
  assert.ok(Number(after.journals) - Number(before.journals) >= 1);
  const journalBalance = (await models.sequelize.query("SELECT COALESCE(SUM(jl.debit),0) AS debit, COALESCE(SUM(jl.credit),0) AS credit FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_entry_id WHERE je.source_id=:reference", { replacements: { reference: body.id }, type: QueryTypes.SELECT }))[0];
  console.log(JSON.stringify({ result: "PASS_GBW02_RUNTIME", database, companyId: company.id, branchId: branch.id, assetId: asset.id, barcode: asset.barcode, profile: detail.body.data.asset.inventoryProfile, net: detail.body.data.goldDetails.net_gold_weight, makingTotal: detail.body.data.currentPurchaseCost.making_total, previewPurchaseTotal: preview.body.data.purchase.totalPurchaseCost, previewCurrentTotal: preview.body.data.current.totalValue, saleApprovalRequired: sale.body.data.sale.approvalRequired, legacyRejected: legacy.status, idempotency: { replay: replay.status, conflict: conflict.status }, pos: { status: pos.status, assetResult: true, productFallback: false }, before, after, journalBalance }));
  await sessions.revokeSession(auth.session.id, user.id, "gbw02-runtime-complete");
}

main().catch((error) => { console.error(JSON.stringify({ result: "FAIL_GBW02_RUNTIME", message: error.message, code: error.code, stack: error.stack })); process.exitCode = 1; }).finally(() => models.sequelize.close());
