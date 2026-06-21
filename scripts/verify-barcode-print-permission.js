/**
 * P7.5a verification — barcode print permission gate.
 *
 * Part A: the printBarcode permission exists in the role matrix with the
 *   intended grants, and admin/owner bypass.
 * Part B: the UI button is gated AND the handlers re-check the permission
 *   (return before printHtmlDocument), in both the inventory batch flow and the
 *   asset-detail preview. No mutations; print output unchanged.
 *
 * Run from repo root: node backend/scripts/verify-barcode-print-permission.js
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "../..");
let passed = 0;
function check(cond, msg) { if (!cond) throw new Error("FAILED: " + msg); passed++; console.log("  ✓ " + msg); }
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

// ---- Part A: permission matrix ----
console.log("Part A — permission matrix:");
const perms = read("lib/permissions/permissions.ts");
check(/printBarcode: boolean;/.test(perms), "printBarcode added to PermissionSet (no migration — frontend matrix)");
const roleGrant = (role) => {
  const block = perms.slice(perms.indexOf(`${role}: {`), perms.indexOf(`${role}: {`) + 400);
  const m = block.match(/printBarcode: (true|false)/);
  return m ? m[1] === "true" : null;
};
check(roleGrant("admin") === true, "admin can print");
check(roleGrant("owner") === true, "owner can print");
check(roleGrant("manager") === true, "manager can print");
check(roleGrant("sales") === true, "sales can print (price/barcode tags)");
check(roleGrant("accountant") === false, "accountant CANNOT print (no inventory tags)");
const useperm = read("hooks/use-permissions.ts");
check(/role === "admin" \|\| role === "owner"\) return true/.test(useperm), "admin/owner bypass in usePermissions");
check(/user\?\.permissions\?\.includes\(permissionName\)/.test(useperm), "other roles checked against their permission set");

// ---- Part B: UI gate + handler guard (inventory) ----
console.log("\nPart B — inventory gate + handler guard:");
const inv = read("app/[locale]/(dashboard)/inventory/page.tsx");
check(/const canPrintBarcode = isAuthorized\("printBarcode"\)/.test(inv), "inventory computes canPrintBarcode from the permission");
check(/disabled=\{!canPrintBarcode\}/.test(inv) && /Barcode print permission required|تحتاج صلاحية/.test(inv), "Print button disabled + tooltip when unauthorized");
// handler guards: both return on !canPrintBarcode, and BEFORE printing.
const printFn = inv.slice(inv.indexOf("const printBarcodeLabels"), inv.indexOf("const handleConfirmPrint"));
check(/if \(!canPrintBarcode\) \{[\s\S]{0,140}return;/.test(printFn), "printBarcodeLabels guards on !canPrintBarcode (handler, not just button)");
const confirmFn = inv.slice(inv.indexOf("const handleConfirmPrint"), inv.indexOf("const handleConfirmPrint") + 2500);
const guardIdx = confirmFn.indexOf("if (!canPrintBarcode)");
const printIdx = confirmFn.indexOf("printHtmlDocument(");
check(guardIdx > -1 && printIdx > -1 && guardIdx < printIdx, "handleConfirmPrint re-checks permission BEFORE printHtmlDocument (no print window for unauthorized)");

// ---- Part B: asset-detail preview also gated (no bypass) ----
console.log("\nasset-detail preview gate:");
const prev = read("features/barcodes/components/BarcodeLabelPreview.tsx");
check(/const canPrintBarcode = isAuthorized\("printBarcode"\)/.test(prev), "preview computes canPrintBarcode");
const pGuard = prev.indexOf("if (!canPrintBarcode)");
const pPrint = prev.indexOf("printHtmlDocument(");
check(pGuard > -1 && pGuard < pPrint, "preview handlePrint guards BEFORE printHtmlDocument");
check(/disabled=\{!canPrintBarcode\}/.test(prev), "preview print button disabled when unauthorized");

// ---- read-only + privacy unchanged ----
console.log("\nno regression:");
check(!/apiClient\(|\.update\(|\.create\(|\.destroy\(/.test(printFn), "print path still performs NO writes (read-only)");
const tmpl = read("features/printing/components/BarcodePrintTemplate.tsx");
check((tmpl.match(/formatCurrency\(/g) || []).length === 1 && tmpl.includes("config.showPrice && ("), "price still gated by showPrice");
check(tmpl.includes("ScannableBarcode"), "ScannableBarcode (P7.3) still used");

console.log(`\nRESULT: all ${passed} checks passed.`);
process.exit(0);
