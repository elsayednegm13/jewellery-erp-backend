/**
 * Financial API Contract Suite — Phase 18D.
 *
 * Aggregates the contract-level verify scripts that lock the critical financial
 * API contracts hardened across phases 16B/16D/17B/17C/18B-1/18B-2/18C. Each
 * contract maps to one or more existing verify scripts; this runner executes
 * each unique script as a child process, reports PASS/FAIL per contract, and
 * exits non-zero if any contract fails. It does NOT fabricate success — a
 * contract is green only if its scripts actually ran with exit code 0.
 *
 * Run from backend/ (so each child loads backend/.env → local/dev DB):
 *   cd backend && node scripts/verify-api-contracts.js
 *
 * Coverage:
 *   A Sales draft   — forged client cost/subtotal/tax/total ignored; COGS =
 *                     server Asset.cost/Product.averageCost; totals = server
 *                     computeTotals; stored draft totals = server; post recomputes.
 *   B POS checkout  — Invoice.id globally unique; two companies can both create a
 *                     first POS invoice; invoiceNumber is the human/company ref;
 *                     idempotency replay safe.
 *   C Installments  — amount required & > 0 (0/neg/NaN/Infinity/missing → 422),
 *                     rejected amounts write nothing, idempotent replay safe,
 *                     Payment + CashTransaction + statement effect correct.
 *   D Supplier pay  — paid/remaining/canPay computed from CashTransaction
 *                     reference = PO.id (Supplier.due not source of truth);
 *                     statement closing matches computed remaining.
 *   E Treasury      — missing / <=0 / non-numeric / Infinity amount → 422 with no
 *                     write; valid transaction still posts.
 *   F Customer gold — weight<=0 / ratePerGram<=0 rejected; forged body.cost
 *                     ignored; Asset + GL use server value = weight × ratePerGram.
 *   G Returns/Exch  — credit-note/exchange totals + line cost from the ORIGINAL
 *                     invoice + server VAT; forged body cost/totals ignored.
 *   H Reporting     — VAT output/full reports, trial balance, account statement.
 */
const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const BACKEND = path.resolve(__dirname, "..");
const SCRIPTS = __dirname;

const CONTRACTS = [
  { id: "A", label: "Sales draft ignores forged cost/totals (server COGS + totals)",
    scripts: ["verify-sales-draft-financial-truth.js", "verify-sales-draft-cogs-source.js"] },
  { id: "B", label: "POS invoice id / invoiceNumber contract",
    scripts: ["verify-pos-invoice-id-uniqueness.js"] },
  { id: "C", label: "Installments amount / guard contract",
    scripts: ["verify-installment-payment-statement.js", "verify-installment-treasury-logging.js"] },
  { id: "D", label: "Supplier purchase payment state contract",
    scripts: ["verify-supplier-purchase-payment-state.js", "verify-supplier-statement.js"] },
  { id: "E", label: "Treasury amount guard contract",
    scripts: ["verify-treasury-safety.js", "verify-treasury-customer-gold-contracts.js"] },
  { id: "F", label: "Customer gold forged-cost-ignored contract",
    scripts: ["verify-treasury-customer-gold-contracts.js"] },
  { id: "G", label: "Returns / exchanges forged-payload contract",
    scripts: ["verify-returns-exchange-contract.js"] },
  { id: "H", label: "VAT / trial balance / statement regressions",
    scripts: ["verify-vat-output.js", "verify-vat-report-full.js", "verify-trial-balance.js", "verify-account-statement.js"] },
];

const cache = new Map(); // script name -> { ok, missing, summary, tail }

function runScript(name) {
  if (cache.has(name)) return cache.get(name);
  const full = path.join(SCRIPTS, name);
  if (!fs.existsSync(full)) {
    const res = { ok: false, missing: true, summary: "MISSING SCRIPT", tail: "" };
    cache.set(name, res);
    return res;
  }
  const r = spawnSync("node", [path.join("scripts", name)], { cwd: BACKEND, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const out = `${r.stdout || ""}\n${r.stderr || ""}`;
  const lines = out.split(/\r?\n/);
  // Drop the verbose Sequelize SQL echo so failure reasons stay readable.
  const meaningful = lines.filter((l) => l.trim() && !l.startsWith("[Sequelize]"));
  const resultLine = meaningful.reverse().find((l) => /RESULT: all|VERIFY FAILED|FAILED:/.test(l)) || meaningful[0] || "";
  const ok = r.status === 0;
  const tail = lines.filter((l) => l.trim() && !l.startsWith("[Sequelize]")).slice(-14).join("\n");
  const res = { ok, missing: false, summary: resultLine.trim(), tail };
  cache.set(name, res);
  return res;
}

console.log("\n================  Financial API Contract Suite  ================\n");

let failed = 0;
const failingContracts = [];

for (const c of CONTRACTS) {
  const results = c.scripts.map((s) => ({ name: s, ...runScript(s) }));
  const pass = results.every((r) => r.ok);
  const tag = pass ? "[PASS]" : "[FAIL]";
  console.log(`${tag} ${c.id}. ${c.label}`);
  for (const r of results) {
    const mark = r.ok ? "✓" : (r.missing ? "?" : "✗");
    console.log(`        ${mark} ${r.name}${r.summary ? "  — " + r.summary : ""}`);
  }
  if (!pass) {
    failed++;
    failingContracts.push({ c, results: results.filter((r) => !r.ok) });
  }
}

console.log("\n----------------------------------------------------------------");
if (failed === 0) {
  console.log(`ALL ${CONTRACTS.length} financial API contracts PASS.`);
  process.exit(0);
}

console.log(`${failed} of ${CONTRACTS.length} contracts FAILED:\n`);
for (const f of failingContracts) {
  for (const r of f.results) {
    console.log(`[FAIL] ${f.c.id} — ${r.name}`);
    console.log(r.missing ? "  reason: script not found" : r.tail.split("\n").map((l) => "  " + l).join("\n"));
    console.log("");
  }
}
process.exit(1);
