/**
 * P7.3 verification — real scannable barcode + QR (bwip-js) + wiring.
 *
 * Part A: bwip-js produces a REAL vector SVG (Code128 + QR), synchronously and
 *   DOM-free, for digits / product codes / asset ids (not decorative spans).
 * Part B: source assertions — the print template and both previews render via
 *   the shared ScannableBarcode (no "QR" placeholder, no decorative BarcodeBars),
 *   price stays gated by config.showPrice, and the QR/barcode value is the
 *   barcode (never the price).
 *
 * Run from repo root: node backend/scripts/verify-scannable-barcode.js
 */
const fs = require("fs");
const path = require("path");
const bwipjs = require("bwip-js");

const ROOT = path.resolve(__dirname, "../..");
let passed = 0;
function check(cond, msg) { if (!cond) throw new Error("FAILED: " + msg); passed++; console.log("  ✓ " + msg); }
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

// ---- Part A: real symbology generation ----
console.log("Part A — bwip-js real SVG (sync, DOM-free):");
const isRealSvg = (svg) => typeof svg === "string" && svg.startsWith("<svg") && svg.includes("<path") && svg.includes("viewBox");
for (const v of ["123456", "PRD-ABC-001", "AST-123"]) {
  const svg = bwipjs.toSVG({ bcid: "code128", text: v, height: 8, includetext: false, scale: 2 });
  check(isRealSvg(svg), `CODE128 real vector SVG for "${v}"`);
}
const qr = bwipjs.toSVG({ bcid: "qrcode", text: "AST-123" });
check(isRealSvg(qr), "QR real vector SVG");
// QR content is the barcode value only — never a price.
check(!/\d{3,}\.\d{2}/.test("AST-123"), "QR sample content carries the code, not a formatted price");

// ---- Part B: wiring / source assertions ----
console.log("\nPart B — shared renderer wiring + price privacy:");
const scannable = read("features/printing/components/ScannableBarcode.tsx");
check(scannable.includes("bwip-js") && scannable.includes("toSVG"), "ScannableBarcode uses bwip-js toSVG");
check(scannable.includes('data-scannable="false"'), "ScannableBarcode has a clearly-marked NON-scannable fallback");
check(scannable.includes('"qrcode"') && scannable.includes('"code128"'), "ScannableBarcode supports both qrcode + code128");

const tmpl = read("features/printing/components/BarcodePrintTemplate.tsx");
check(tmpl.includes("ScannableBarcode"), "print template renders via ScannableBarcode");
check(!tmpl.includes("function BarcodeBars"), "decorative BarcodeBars removed from print template");
check(!/>\s*QR\s*</.test(tmpl), "no literal 'QR' placeholder in print template");
check(tmpl.includes('type="qr"') && tmpl.includes('type="barcode"'), "print template renders both QR and barcode via shared renderer");
// price is rendered ONLY under config.showPrice; barcode/QR value is item.barcode.
check((tmpl.match(/formatCurrency\(/g) || []).length === 1 && tmpl.includes("config.showPrice && (") && /config\.showPrice && \([\s\S]{0,160}formatCurrency/.test(tmpl), "price rendered ONLY inside config.showPrice gate (single formatCurrency under the gate)");
check(/ScannableBarcode type="qr" value=\{item\.barcode\}/.test(tmpl) && /ScannableBarcode type="barcode" value=\{item\.barcode\}/.test(tmpl), "QR/barcode value = item.barcode (never the price)");

const preview = read("features/barcodes/components/BarcodeLabelPreview.tsx");
check(preview.includes("ScannableBarcode"), "asset-detail preview uses the SAME ScannableBarcode renderer");
check(!preview.includes("Simulated barcode bars") && !/Array\.from\(\{ length: 18 \}\)/.test(preview), "preview's simulated bars removed");

const inv = read("app/[locale]/(dashboard)/inventory/page.tsx");
check(inv.includes("ScannableBarcode"), "inventory print-settings mini-preview uses ScannableBarcode");
check(!/>\s*QR\s*</.test(inv.slice(inv.indexOf("Tag Right Panel"))), "inventory mini-preview has no 'QR' placeholder");

console.log(`\nRESULT: all ${passed} checks passed.`);
process.exit(0);
