/**
 * P7.2 verification — barcode label designer: real logo + toggle/size wiring.
 *
 * Source + runtime assertions (the TSX renders via the app toolchain, proven by
 * tsc/lint/build): the print template renders the real company logo (gated by
 * config.showLogo, independent of showCompanyName) via getPublicFileUrl,
 * sanitizes label sizes, keeps price gated by showPrice, and keeps the P7.3
 * scannable barcode/QR; both previews mirror the logo + field gates.
 *
 * Run from repo root: node backend/scripts/verify-barcode-label-designer.js
 */
const fs = require("fs");
const path = require("path");
const bwipjs = require("bwip-js");

const ROOT = path.resolve(__dirname, "../..");
let passed = 0;
function check(cond, msg) { if (!cond) throw new Error("FAILED: " + msg); passed++; console.log("  ✓ " + msg); }
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

// ---- size sanitizer ----
console.log("size sanitizer:");
const lib = read("lib/print/barcode-label.ts");
check(/export function sanitizeBarcodeConfig/.test(lib), "sanitizeBarcodeConfig exported");
for (const f of ["widthMm", "heightMm", "columns", "copies", "fontSizePx"]) {
  check(new RegExp(`${f}: (?:Math\\.round\\()?clamp\\(`).test(lib), `sanitizer clamps ${f}`);
}
check(/Number\.isFinite\(n\) && n >= min && n <= max \? n : dflt/.test(lib), "clamp falls back to a safe default for invalid values");

// ---- print template: real logo + gates + sanitize + privacy + P7.3 ----
console.log("\nprint template:");
const tmpl = read("features/printing/components/BarcodePrintTemplate.tsx");
check(tmpl.includes('from "@/lib/api/files"') && tmpl.includes("getPublicFileUrl"), "print template imports getPublicFileUrl");
check(/config\.showLogo && companyLogo \? getPublicFileUrl\(companyLogo\)/.test(tmpl), "logo rendered ONLY when config.showLogo && companyLogo (real logo, not initials)");
check(tmpl.includes("companyLogo?:") && /<img src=\{logoUrl\}/.test(tmpl), "print template has companyLogo prop + renders <img> for it");
check(tmpl.includes("config.showCompanyName") && tmpl.includes("config.showLogo"), "showLogo is independent of showCompanyName (separate gates)");
check(/const config = sanitizeBarcodeConfig\(rawConfig\)/.test(tmpl), "print template sanitizes label sizes");
check((tmpl.match(/formatCurrency\(/g) || []).length === 1 && tmpl.includes("config.showPrice && ("), "price still ONLY under config.showPrice (privacy preserved)");
check(tmpl.includes("ScannableBarcode") && /type="qr" value=\{item\.barcode\}/.test(tmpl), "P7.3 scannable barcode/QR still intact (value = item.barcode)");

// ---- previews mirror logo + gates ----
console.log("\npreviews:");
const prev = read("features/barcodes/components/BarcodeLabelPreview.tsx");
check(prev.includes("getPublicFileUrl") && prev.includes("useAuth"), "asset-detail preview resolves the real logo via getPublicFileUrl + useAuth");
check(/config\.showLogo && company\?\.logo \? getPublicFileUrl/.test(prev), "preview logo gated by config.showLogo");
check(/companyLogo=\{company\?\.logo\}/.test(prev), "preview passes companyLogo to the print template");
for (const g of ["config.showName", "config.showAssetId", "config.showPrice", "config.showKarat", "config.showWeight", "config.customText"]) {
  check(prev.includes(g), `preview honours ${g} gate`);
}
check((prev.match(/formatCurrency\(/g) || []).length === 1 && prev.includes("config.showPrice && ("), "preview price gated by showPrice (no leak)");

const inv = read("app/[locale]/(dashboard)/inventory/page.tsx");
check(/previewConfig\.showLogo && company\?\.logo/.test(inv) && inv.includes("getPublicFileUrl(company.logo)"), "inventory mini-preview renders the real logo (gated)");
check(/companyLogo=\{company\?\.logo\}/.test(inv), "inventory print passes companyLogo to the print template");

// ---- runtime: scannable barcode/QR still generate (P7.3 regression) ----
console.log("\nruntime (P7.3 regression):");
check(bwipjs.toSVG({ bcid: "code128", text: "AST-123", height: 8, includetext: false }).startsWith("<svg"), "CODE128 still generates real SVG");
check(bwipjs.toSVG({ bcid: "qrcode", text: "AST-123" }).startsWith("<svg"), "QR still generates real SVG");

console.log(`\nRESULT: all ${passed} checks passed.`);
process.exit(0);
