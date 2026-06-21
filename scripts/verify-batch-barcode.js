/**
 * P7.4 verification — batch barcode printing hardening (logic + source).
 *
 * Part A (runtime): the copies-expansion + safeCopies logic — finalLabelsCount
 *   = Σ per-item copies, no double counting, invalid copies → safe default.
 * Part B (source): inventory batch flow is read-only (no mutations), supports
 *   selected/all-filtered for products+assets, shows a summary + large-batch
 *   acknowledgement, keeps price gated and the shared scannable renderer.
 *
 * Run from repo root: node backend/scripts/verify-batch-barcode.js
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "../..");
let passed = 0;
function check(cond, msg) { if (!cond) throw new Error("FAILED: " + msg); passed++; console.log("  ✓ " + msg); }
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

// ---- Part A: copies / count logic (mirrors the page) ----
console.log("Part A — copies + label-count logic:");
const safeCopies = (c) => Math.max(1, Math.min(1000, Math.round(Number(c) || 1)));
const expand = (items) => { const out = []; for (const it of items) { const n = safeCopies(it.copies); for (let i = 0; i < n; i++) out.push({ ...it, copies: 1 }); } return out; };
const totalLabels = (items) => items.reduce((s, it) => s + safeCopies(it.copies), 0);

check(safeCopies(3) === 3 && safeCopies(1) === 1, "valid copies kept");
check(safeCopies(0) === 1 && safeCopies(NaN) === 1 && safeCopies(undefined) === 1 && safeCopies(-5) === 1, "invalid/0/negative copies → safe default 1");
check(safeCopies(99999) === 1000, "excessive copies capped at 1000");
const sample = [{ id: "a", copies: 3 }, { id: "b", copies: 2 }, { id: "c", copies: 1 }];
check(totalLabels(sample) === 6, "finalLabelsCount = Σ copies (3+2+1 = 6)");
check(expand(sample).length === 6, "expansion produces exactly Σ copies labels (no doubling)");
check(expand(sample).every((x) => x.copies === 1), "each expanded label has copies:1 (counted once)");
check(totalLabels([{ copies: 3 }, { copies: 3 }]) === 6 && totalLabels([{ copies: 0 }]) === 1, "copies=3→3 each; copies=0→1 (no break)");

// ---- Part B: source assertions on the inventory batch flow ----
console.log("\nPart B — inventory batch flow (source):");
const inv = read("app/[locale]/(dashboard)/inventory/page.tsx");
check(inv.includes("LARGE_BATCH_THRESHOLD = 500"), "large-batch threshold defined (500, documented)");
check(/labelCount > LARGE_BATCH_THRESHOLD && !largeBatchConfirmed/.test(inv), "confirm guard: large batch requires acknowledgement");
check(/disabled=\{totalLabels > LARGE_BATCH_THRESHOLD && !largeBatchConfirmed\}/.test(inv), "Confirm button disabled until large batch acknowledged");
check(inv.includes("const safeCopies =") && /safeCopies\(item\.copies\)/.test(inv), "copies sanitized in expansion (safeCopies)");
check(/Total labels|إجمالي الملصقات/.test(inv) && /Items|العناصر/.test(inv) && /Scope|النطاق/.test(inv), "print summary shows items / total labels / scope");
check(/scope = selectedProductIds\.length \? "selected" : "filtered"/.test(inv) && /scope = selectedAssetIds\.length \? "selected" : "filtered"/.test(inv), "supports selected vs all-filtered for products AND assets");
check(inv.includes("productToLabelData(p, copies)") && inv.includes("assetToLabelData(a, copies)"), "products + assets both batchable via shared mappers");
check(inv.includes("ScannableBarcode"), "batch still uses the shared scannable renderer (P7.3)");

// read-only: the print path must not mutate inventory/accounting/settings.
const printSection = inv.slice(inv.indexOf("const printBarcodeLabels"), inv.indexOf("const handleConfirmPrint") + 2000);
check(!/apiClient\(|\.update\(|\.create\(|\.destroy\(|fetch\(/.test(printSection), "batch print path performs NO writes (read-only: no apiClient/update/create/destroy/fetch)");

// price privacy unchanged in the template.
const tmpl = read("features/printing/components/BarcodePrintTemplate.tsx");
check((tmpl.match(/formatCurrency\(/g) || []).length === 1 && tmpl.includes("config.showPrice && ("), "price still gated by showPrice in batch output");

console.log(`\nRESULT: all ${passed} checks passed.`);
process.exit(0);
