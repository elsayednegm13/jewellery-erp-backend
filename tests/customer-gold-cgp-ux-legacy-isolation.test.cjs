const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const isolation = require("../src/services/cgp-legacy-isolation.service");

const root = path.resolve(__dirname, "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const sales = read("app/[locale]/(dashboard)/sales/page.tsx");
const sidebar = read("components/layout/sidebar.tsx");
const legacyPage = read("app/[locale]/(dashboard)/sales/customer-gold/page.tsx");
const workspace = read("features/gold-purchases/components/GoldPurchaseDraftWorkspace.tsx");
const supplierPage = read("app/[locale]/(dashboard)/suppliers/purchases/page.tsx");

assert.match(sales, /href="\/sales\/customer-gold\/drafts"/);
assert.match(sales, /شراء الذهب من العميل \(CGP\)/);
assert.doesNotMatch(sales, /href="\/sales\/customer-gold"/);
assert.doesNotMatch(sales, /شراء كسر/);
assert.match(sales, /href="\/sales\/customer-gold\/history"/);
assert.match(sidebar, /href: "\/sales\/customer-gold\/drafts"/);
assert.match(sidebar, /label: "customerGold"/);
assert.match(workspace, /postGoldPurchaseDraft/);
assert.match(workspace, /ترحيل عملية الشراء/);
assert.match(workspace, /لا ينشئ Draft/);
assert.match(workspace, /data-cgp-readonly-result/);
assert.match(workspace, /historicalReadOnly/);
assert.match(workspace, /وصف القطعة \/ اسمها في المخزون/);
assert.match(read("backend/src/routes/gold-purchase.routes.js"), /business-view/);
assert.match(read("backend/src/services/cgp-business-view.service.js"), /settlementSummary/);
assert.match(read("backend/src/routes/gold-purchase.routes.js"), /settlements/);
assert.match(workspace, /data-cgp-settlement-form/);
assert.match(workspace, /settleCgpDraft/);
assert.match(read("backend/src/services/cgp-posting.service.js"), /itemDescription/);
assert.match(read("backend/src/services/cgp-inventory-consumer.service.js"), /assetName/);
assert.doesNotMatch(workspace, /goldapi\.io|goldapi/);
assert.doesNotMatch(legacyPage, /gold\/deposit/);
assert.doesNotMatch(legacyPage, /method:\s*["']POST/);
assert.doesNotMatch(supplierPage, /Batch 6/);

assert.equal(isolation.isCanonicalCgpCutoverActive({}), true);
assert.throws(() => isolation.assertLegacyCustomerGoldAcquisitionAllowed({ env: {} }), /Legacy customer gold acquisition/);
assert.doesNotThrow(() => isolation.assertLegacyCustomerGoldAcquisitionAllowed({ env: { [isolation.CGP_LEGACY_ISOLATION_ENV]: "false" } }));

console.log("CUSTOMER_GOLD_STATIC_VERIFIER: PASS");
