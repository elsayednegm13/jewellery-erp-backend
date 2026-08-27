const { JournalEntry, JournalLine, sequelize } = require("../models");
const logger = require("../utils/logger");
const { AppError } = require("../utils/errors");
const accountingLockService = require("./accounting-lock.service");
const financialAccountResolver = require("./financial-account-resolver.service");

/**
 * Financial Posting Engine
 * ------------------------------------------------------------------
 * Turns business events (sale, return, purchase, cash movement) into
 * balanced double-entry journal entries, following the docs:
 *   Event → Accounting Mapping → Auto Journal Generation
 *
 * Design rules:
 *  - Every entry MUST balance (sum of debit === sum of credit).
 *  - Accounts are resolved from explicit Branch mappings or the pre-provisioned
 *    catalog. Missing configuration fails before any journal is written.
 *  - Each entry is linked to its source (sourceType / sourceId) for
 *    full traceability.
 */

// Canonical display metadata retained for journal previews. Persistent posting
// accounts are provisioned by financial-bootstrap.service and resolved through
// explicit Branch mappings; this object never creates database rows.
const CHART = {
  "1000": { name: "Assets", nameAr: "الأصول", type: "asset", nature: "debit", level: 1, parent: null },
  "1100": { name: "Cash & Bank", nameAr: "النقد والبنوك", type: "asset", nature: "debit", level: 2, parent: "1000" },
  "1110": { name: "Cash on Hand", nameAr: "نقد في الخزنة", type: "asset", nature: "debit", level: 3, parent: "1100" },
  "1120": { name: "Bank Accounts", nameAr: "الحسابات البنكية", type: "asset", nature: "debit", level: 3, parent: "1100" },
  "1200": { name: "Inventory", nameAr: "المخزون", type: "asset", nature: "debit", level: 2, parent: "1000" },
  // Per-karat inventory sub-accounts (P5.1 — used only when accountingByKarat is on).
  "1210": { name: "Inventory Gold 18K", nameAr: "مخزون ذهب 18", type: "asset", nature: "debit", level: 3, parent: "1200" },
  "1211": { name: "Inventory Gold 21K", nameAr: "مخزون ذهب 21", type: "asset", nature: "debit", level: 3, parent: "1200" },
  "1212": { name: "Inventory Gold 22K", nameAr: "مخزون ذهب 22", type: "asset", nature: "debit", level: 3, parent: "1200" },
  "1213": { name: "Inventory Gold 24K", nameAr: "مخزون ذهب 24", type: "asset", nature: "debit", level: 3, parent: "1200" },
  "1219": { name: "Inventory Other / Non-Gold", nameAr: "مخزون أخرى / غير ذهب", type: "asset", nature: "debit", level: 3, parent: "1200" },
  "1300": { name: "Accounts Receivable", nameAr: "ذمم العملاء", type: "asset", nature: "debit", level: 2, parent: "1000" },
  // Phase 12E foundation — Input VAT (recoverable purchase VAT).
  "1400": { name: "Input VAT Recoverable", nameAr: "ضريبة مدخلات قابلة للخصم", type: "asset", nature: "debit", level: 2, parent: "1000" },
  "2000": { name: "Liabilities", nameAr: "الخصوم", type: "liability", nature: "credit", level: 1, parent: null },
  "2100": { name: "Accounts Payable", nameAr: "ذمم الموردين", type: "liability", nature: "credit", level: 2, parent: "2000" },
  "2200": { name: "VAT Payable", nameAr: "ضريبة القيمة المضافة", type: "liability", nature: "credit", level: 2, parent: "2000" },
  // Phase 12E foundation — RCM Output VAT, kept SEPARATE from 2200 so the VAT
  // return can distinguish normal output VAT from reverse-charge output VAT.
  // Not used by any posting yet (12F).
  "2210": { name: "RCM Output VAT", nameAr: "ضريبة احتساب عكسي مستحقة", type: "liability", nature: "credit", level: 2, parent: "2000" },
  "2300": { name: "Customer Deposits", nameAr: "عرابين العملاء", type: "liability", nature: "credit", level: 2, parent: "2000" },
  "2400": { name: "Gift Voucher Liability", nameAr: "التزام قسائم الهدايا", type: "liability", nature: "credit", level: 2, parent: "2000" },
  "3000": { name: "Equity", nameAr: "حقوق الملكية", type: "equity", nature: "credit", level: 1, parent: null },
  "4000": { name: "Revenue", nameAr: "الإيرادات", type: "revenue", nature: "credit", level: 1, parent: null },
  "4100": { name: "Jewelry Sales", nameAr: "مبيعات المجوهرات", type: "revenue", nature: "credit", level: 2, parent: "4000" },
  // Per-karat sales-revenue sub-accounts (P5.1 — used only when accountingByKarat is on).
  "4110": { name: "Sales Revenue Gold 18K", nameAr: "إيراد مبيعات ذهب 18", type: "revenue", nature: "credit", level: 3, parent: "4100" },
  "4111": { name: "Sales Revenue Gold 21K", nameAr: "إيراد مبيعات ذهب 21", type: "revenue", nature: "credit", level: 3, parent: "4100" },
  "4112": { name: "Sales Revenue Gold 22K", nameAr: "إيراد مبيعات ذهب 22", type: "revenue", nature: "credit", level: 3, parent: "4100" },
  "4113": { name: "Sales Revenue Gold 24K", nameAr: "إيراد مبيعات ذهب 24", type: "revenue", nature: "credit", level: 3, parent: "4100" },
  "4119": { name: "Sales Revenue Other / Non-Gold", nameAr: "إيراد مبيعات أخرى / غير ذهب", type: "revenue", nature: "credit", level: 3, parent: "4100" },
  "4200": { name: "Gold Profit", nameAr: "أرباح الذهب", type: "revenue", nature: "credit", level: 2, parent: "4000" },
  "4900": { name: "Other Income", nameAr: "إيرادات أخرى", type: "revenue", nature: "credit", level: 2, parent: "4000" },
  "5000": { name: "Cost of Goods Sold", nameAr: "تكلفة البضاعة المباعة", type: "expense", nature: "debit", level: 1, parent: null },
  // Per-karat COGS sub-accounts (P5.1 — used only when accountingByKarat is on).
  "5010": { name: "COGS Gold 18K", nameAr: "تكلفة مبيعات ذهب 18", type: "expense", nature: "debit", level: 2, parent: "5000" },
  "5011": { name: "COGS Gold 21K", nameAr: "تكلفة مبيعات ذهب 21", type: "expense", nature: "debit", level: 2, parent: "5000" },
  "5012": { name: "COGS Gold 22K", nameAr: "تكلفة مبيعات ذهب 22", type: "expense", nature: "debit", level: 2, parent: "5000" },
  "5013": { name: "COGS Gold 24K", nameAr: "تكلفة مبيعات ذهب 24", type: "expense", nature: "debit", level: 2, parent: "5000" },
  "5019": { name: "COGS Other / Non-Gold", nameAr: "تكلفة مبيعات أخرى / غير ذهب", type: "expense", nature: "debit", level: 2, parent: "5000" },
  "6000": { name: "Operating Expenses", nameAr: "المصروفات التشغيلية", type: "expense", nature: "debit", level: 1, parent: null },
  "6100": { name: "Salaries & Wages", nameAr: "الرواتب والأجور", type: "expense", nature: "debit", level: 2, parent: "6000" },
};

const TREASURY_MAPPING_ROLE = Object.freeze({
  cash: "CASH_TREASURY",
  bank: "BANK_ACCOUNT",
});

function treasuryMappingRole(value = "cash") {
  const method = String(value || "cash").toLowerCase();
  return method.includes("card") || method.includes("bank") ||
    method.includes("شبك") || method.includes("transfer") || method.includes("تحويل")
    ? TREASURY_MAPPING_ROLE.bank
    : TREASURY_MAPPING_ROLE.cash;
}

// Per-karat GL account codes (P5.1 foundation). NOT used by any posting until
// P5.2/P5.3 enable split posting behind the accountingByKarat flag. Unknown /
// null / non-gold karats fall back to the "Other" (*9) sub-accounts.
const KARAT_ACCOUNTS = {
  18: { inventory: "1210", cogs: "5010", revenue: "4110" },
  21: { inventory: "1211", cogs: "5011", revenue: "4111" },
  22: { inventory: "1212", cogs: "5012", revenue: "4112" },
  24: { inventory: "1213", cogs: "5013", revenue: "4113" },
};
const KARAT_OTHER = { inventory: "1219", cogs: "5019", revenue: "4119" };

/**
 * Resolve the inventory / COGS / revenue GL codes for a karat.
 * @param {number|string|null} karat
 * @returns {{inventory:string, cogs:string, revenue:string}}
 */
function karatAccounts(karat) {
  const k = parseInt(karat, 10);
  return KARAT_ACCOUNTS[k] || KARAT_OTHER;
}

const round = (n) => Math.round((Number(n) || 0) * 100) / 100;
const round4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;
const MONEY_SCALE_4 = 10000n;

function moneyToUnits4(value) {
  const text = String(value ?? "").trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/.test(text)) throw new Error("Invalid DECIMAL(15,4) posting amount.");
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * MONEY_SCALE_4 + BigInt(`${fraction}0000`.slice(0, 4));
}

function moneyFromUnits4(units) {
  const value = BigInt(units);
  return `${value / MONEY_SCALE_4}.${(value % MONEY_SCALE_4).toString().padStart(4, "0")}`;
}

// Group sale/return line items by karat bucket (18/21/22/24 or "other"),
// summing cost (cost*qty) and revenue basis (price*qty) per bucket. Insertion
// order is preserved so the LAST bucket can absorb any rounding remainder.
function groupItemsByKarat(items = []) {
  const map = new Map();
  for (const it of items) {
    const k = parseInt(it.karat, 10);
    const key = [18, 21, 22, 24].includes(k) ? k : "other";
    const g = map.get(key) || { key, cost: 0, basis: 0 };
    g.cost += (Number(it.cost) || 0) * (Number(it.quantity) || 1);
    g.basis += (Number(it.price) || 0) * (Number(it.quantity) || 1);
    map.set(key, g);
  }
  return [...map.values()];
}

/**
 * Build the per-karat revenue + COGS + inventory journal lines for a sale or a
 * return. The revenue lines sum EXACTLY to `revenueTotal` (= net-of-VAT
 * subtotal) and the COGS/Inventory lines sum EXACTLY to `totalCost`; any
 * rounding remainder is pushed onto the last karat bucket. VAT and the
 * cash/bank/AR lines are NOT produced here (the caller keeps those unchanged).
 *
 * @param {object} p
 * @param {Array}  p.items
 * @param {number} p.revenueTotal  net subtotal to split across karats
 * @param {number} p.totalCost     COGS total to split across karats
 * @param {boolean} p.reverse      false=sale (Cr revenue, Dr COGS, Cr inv),
 *                                 true=return (Dr revenue, Cr COGS, Dr inv)
 */
function karatSplitLines({ items = [], revenueTotal = 0, totalCost = 0, reverse = false }) {
  const groups = groupItemsByKarat(items);
  const lines = [];
  if (groups.length === 0) return lines;

  // Revenue allocation by price basis (exact: last bucket absorbs remainder).
  const totalBasis = round(groups.reduce((s, g) => s + g.basis, 0));
  let revAllocated = 0;
  groups.forEach((g, i) => {
    const codes = karatAccounts(g.key === "other" ? null : g.key);
    const isLast = i === groups.length - 1;
    const rev = isLast
      ? round(revenueTotal - revAllocated)
      : (totalBasis > 0 ? round(revenueTotal * (g.basis / totalBasis)) : 0);
    if (!isLast) revAllocated = round(revAllocated + rev);
    if (rev !== 0) {
      lines.push({ accountCode: codes.revenue, debit: reverse ? rev : 0, credit: reverse ? 0 : rev, description: `إيراد مبيعات ${g.key}` });
    }
  });

  // COGS + Inventory allocation by cost (exact: last bucket absorbs remainder).
  if (round(totalCost) !== 0) {
    let costAllocated = 0;
    groups.forEach((g, i) => {
      const codes = karatAccounts(g.key === "other" ? null : g.key);
      const isLast = i === groups.length - 1;
      const c = isLast ? round(totalCost - costAllocated) : round(g.cost);
      if (!isLast) costAllocated = round(costAllocated + c);
      if (c !== 0) {
        // sale: Dr COGS / Cr Inventory ; return: Cr COGS / Dr Inventory
        lines.push({ accountCode: codes.cogs, debit: reverse ? 0 : c, credit: reverse ? c : 0, description: `تكلفة مبيعات ${g.key}` });
        lines.push({ accountCode: codes.inventory, debit: reverse ? c : 0, credit: reverse ? 0 : c, description: `مخزون ${g.key}` });
      }
    });
  }
  return lines;
}

/**
 * Per-karat inventory DEBIT lines for a purchase receipt. Each item's line
 * amount is its total cost (totalCost, else unitCost/cost × quantity). The
 * lines sum EXACTLY to `total` (PO total) — the last karat bucket absorbs any
 * rounding remainder. Non-gold / unknown karats → the "Other" inventory (1219).
 */
function karatPurchaseInventoryLines(items = [], total = 0) {
  const map = new Map();
  for (const it of items) {
    const k = parseInt(it.karat, 10);
    const key = [18, 21, 22, 24].includes(k) ? k : "other";
    const amt = Number(it.totalCost) || (Number(it.unitCost != null ? it.unitCost : it.cost) || 0) * (Number(it.quantity) || 1);
    const g = map.get(key) || { key, amount: 0 };
    g.amount += amt;
    map.set(key, g);
  }
  const groups = [...map.values()];
  const lines = [];
  let allocated = 0;
  groups.forEach((g, i) => {
    const code = karatAccounts(g.key === "other" ? null : g.key).inventory;
    const isLast = i === groups.length - 1;
    const amt = isLast ? round(total - allocated) : round(g.amount);
    if (!isLast) allocated = round(allocated + amt);
    if (amt !== 0) lines.push({ accountCode: code, debit: amt, credit: 0, description: `استلام مخزون ${g.key}` });
  });
  return lines;
}

class PostingService {
  /**
   * Whether to split sale/return postings by karat. Honours an explicit
   * opts.accountingByKarat override (passed by a route), else reads the company
   * setting. Defaults to false (and on any error) so posting never breaks.
   */
  async resolveAccountingByKarat(companyId, opts = {}) {
    if (opts.accountingByKarat !== undefined) return Boolean(opts.accountingByKarat);
    try {
      const settingsService = require("./settings.service");
      const s = await settingsService.getCompanySettings(companyId, { transaction: opts.transaction });
      return Boolean(s.accountingByKarat);
    } catch {
      return false;
    }
  }

  /**
   * Core: create a balanced journal entry from a set of lines.
   * @param {string} companyId
   * @param {object} opts { description, date, sourceType, sourceId, postedBy, transaction, branchId }
   * @param {Array} lines [{ accountCode, debit, credit, description }]
   * @returns {JournalEntry} with lines
   */
  async postEntry(companyId, opts, lines) {
    if (opts?.precision === 4) {
      const debitUnits = lines.reduce((sum, line) => sum + moneyToUnits4(line.debit || 0), 0n);
      const creditUnits = lines.reduce((sum, line) => sum + moneyToUnits4(line.credit || 0), 0n);
      if (debitUnits !== creditUnits) throw new Error("Unbalanced exact journal entry. Posting rejected.");
      if (debitUnits <= 0n) throw new Error("Empty exact journal entry. Posting rejected.");
      return this.postExactFourDecimalEntry(companyId, opts, lines, debitUnits);
    }
    // The persisted JournalLine values are rounded to cents below. Build the
    // totals from those same values and require exact cent equality. A
    // tolerance that admits 0.01 creates a posted, financially unbalanced
    // journal without an approved residual-line authority.
    const roundedLines = lines.map((line) => ({
      ...line,
      debit: round(line.debit),
      credit: round(line.credit),
    }));
    const totalDebit = round(roundedLines.reduce((s, l) => s + l.debit, 0));
    const totalCredit = round(roundedLines.reduce((s, l) => s + l.credit, 0));

    // Posting validation: reject unbalanced entries.
    if (Math.round(totalDebit * 100) !== Math.round(totalCredit * 100)) {
      throw new Error(
        `Unbalanced journal entry: debit ${totalDebit} ≠ credit ${totalCredit}. Posting rejected.`
      );
    }
    if (totalDebit === 0) {
      throw new Error("Empty journal entry: total debit/credit is zero. Posting rejected.");
    }

    const execute = async (t) => {
      const stamp = Date.now();
      const entryId = opts.id || `JE-${stamp}`;
      const date = opts.date || new Date().toISOString().slice(0, 10);
      await accountingLockService.assertDateUnlocked(companyId, date, {
        transaction: t,
        operation: opts.sourceType || "journal_posting"
      });

      const resolvedLines = [];
      for (const line of lines) {
        const account = await financialAccountResolver.resolvePostingAccount({
          companyId,
          branchId: opts.branchId || null,
          accountId: line.accountId || null,
          accountCode: line.accountCode || null,
          mappingRole: line.mappingRole || null,
          transaction: t,
        });
        if (!account) throw new Error("Explicit posting account is inactive or outside the operational branch.");
        resolvedLines.push({ line, account });
      }

      const entry = await JournalEntry.create(
        {
          id: entryId,
          companyId,
          branchId: opts.branchId || null,
          description: opts.description || "Auto-generated entry",
          date,
          status: "posted",
          amount: totalDebit,
          totalDebit,
          totalCredit,
          sourceType: opts.sourceType || null,
          sourceId: opts.sourceId || null,
          postedBy: opts.postedBy || "System",
          postedAt: new Date().toISOString(),
        },
        { transaction: t }
      );

      let i = 0;
      for (let lineIndex = 0; lineIndex < resolvedLines.length; lineIndex += 1) {
        const { account } = resolvedLines[lineIndex];
        const line = roundedLines[lineIndex];
        const debit = line.debit;
        const credit = line.credit;

        await JournalLine.create(
          {
            id: `${entryId}-L${++i}`,
            journalEntryId: entryId,
            accountId: account.id,
            accountCode: account.code,
            accountName: account.nameAr,
            debit,
            credit,
            description: line.description || opts.description || "",
          },
          { transaction: t }
        );

        // Update running account balance according to its natural side.
        const delta = account.nature === "debit" ? debit - credit : credit - debit;
        await account.increment("balance", { by: delta, transaction: t });
      }

      logger.info(
        `[Posting] Entry ${entryId} posted (${opts.sourceType}:${opts.sourceId}) — ` +
          `Dr ${totalDebit} / Cr ${totalCredit}`
      );

      const lineRows = await JournalLine.findAll({ where: { journalEntryId: entryId }, transaction: t });
      const json = entry.toJSON();
      json.lines = lineRows.map((r) => r.toJSON());
      return json;
    };

    if (opts && opts.transaction) {
      return execute(opts.transaction);
    } else {
      return sequelize.transaction(execute);
    }
  }

  async postExactFourDecimalEntry(companyId, opts, lines, totalUnits) {
    const execute = async (t) => {
      const entryId = opts.id || `JE-${Date.now()}`;
      const date = opts.date || new Date().toISOString().slice(0, 10);
      await accountingLockService.assertDateUnlocked(companyId, date, { transaction: t, operation: opts.sourceType || "journal_posting" });
      const resolvedLines = [];
      for (const line of lines) {
        const account = await financialAccountResolver.resolvePostingAccount({ companyId, branchId: opts.branchId || null, accountId: line.accountId || null, accountCode: line.accountCode || null, mappingRole: line.mappingRole || null, transaction: t });
        if (!account) throw new Error("Explicit posting account is inactive or outside the operational branch.");
        resolvedLines.push({ line, account });
      }
      const total = moneyFromUnits4(totalUnits);
      const entry = await JournalEntry.create({ id: entryId, companyId, branchId: opts.branchId || null, description: opts.description || "Auto-generated entry", date, status: "posted", amount: total, totalDebit: total, totalCredit: total, sourceType: opts.sourceType || null, sourceId: opts.sourceId || null, postedBy: opts.postedBy || "System", postedAt: new Date().toISOString() }, { transaction: t });
      let index = 0;
      for (const { line, account } of resolvedLines) {
        const debit = moneyFromUnits4(moneyToUnits4(line.debit || 0));
        const credit = moneyFromUnits4(moneyToUnits4(line.credit || 0));
        await JournalLine.create({ id: `${entryId}-L${++index}`, journalEntryId: entryId, accountId: account.id, accountCode: account.code, accountName: account.nameAr, debit, credit, description: line.description || opts.description || "" }, { transaction: t });
        const debitUnits = moneyToUnits4(debit);
        const creditUnits = moneyToUnits4(credit);
        const deltaUnits = account.nature === "debit" ? debitUnits - creditUnits : creditUnits - debitUnits;
        if (deltaUnits >= 0n) {
          await account.increment("balance", { by: moneyFromUnits4(deltaUnits), transaction: t, silent: true });
        } else {
          await account.decrement("balance", { by: moneyFromUnits4(-deltaUnits), transaction: t, silent: true });
        }
      }
      const lineRows = await JournalLine.findAll({ where: { journalEntryId: entryId }, transaction: t });
      return { ...entry.toJSON(), lines: lineRows.map((row) => row.toJSON()) };
    };
    return opts?.transaction ? execute(opts.transaction) : sequelize.transaction(execute);
  }

  /**
   * Build & post the journal entry for a SALES invoice.
   *   Dr  Cash/Bank/AR        total (incl. VAT)
   *   Cr    Jewelry Sales       subtotal (net of VAT)
   *   Cr    VAT Payable         tax
   *   Dr  COGS               cost            (if cost known)
   *   Cr    Inventory           cost
   */
  async postInvoiceEntry(invoice, items = [], postedBy = "System", opts = {}) {
    const companyId = invoice.companyId;
    // An Invoice/Tax total may legitimately carry four decimal places. In
    // that case, every posting leg must retain the same precision; rounding
    // each leg to cents independently can create a 0.01 imbalance.
    const hasSubCentAmount = [
      invoice.total,
      invoice.tax,
      invoice.subtotal,
      ...(Array.isArray(invoice.paymentSplits) ? invoice.paymentSplits.map((split) => split?.amount) : []),
    ].some((value) => Math.abs(round4(value) - round(value)) > 0);
    const moneyRound = hasSubCentAmount ? round4 : round;
    const total = moneyRound(invoice.total);
    const tax = moneyRound(invoice.tax);
    const subtotal = moneyRound(invoice.subtotal != null ? invoice.subtotal : total - tax);
    const cost = moneyRound(items.reduce((s, it) => s + (Number(it.cost) || 0) * (Number(it.quantity) || 1), 0));

    // Reservation Complete-sale supplies all roles from the strict branch
    // resolver. It therefore cannot reach a company-code fallback while
    // posting the Invoice and its COGS entry.
    if (opts.finalSaleAccounts) {
      const roles = opts.finalSaleAccounts;
      const required = ["accountsReceivable", "salesRevenue", "vatPayable", "inventoryAsset", "costOfGoodsSold"];
      if (required.some((key) => !roles[key]?.id)) throw new Error("Complete-sale posting requires explicit branch financial roles.");
      const byKarat = await this.resolveAccountingByKarat(companyId, opts);
      if (byKarat) throw new Error("Per-karat Complete-sale posting requires explicit branch role mappings.");
      const lines = [
        { accountId: roles.accountsReceivable.id, debit: total, credit: 0, description: `فاتورة ${invoice.id}` },
        { accountId: roles.salesRevenue.id, debit: 0, credit: subtotal, description: "إيراد مبيعات" },
      ];
      if (tax > 0) lines.push({ accountId: roles.vatPayable.id, debit: 0, credit: tax, description: "ضريبة القيمة المضافة" });
      if (cost > 0) {
        lines.push({ accountId: roles.costOfGoodsSold.id, debit: cost, credit: 0, description: "تكلفة البضاعة المباعة" });
        lines.push({ accountId: roles.inventoryAsset.id, debit: 0, credit: cost, description: "تخفيض المخزون" });
      }
      return this.postEntry(companyId, {
        description: `قيد بيع — فاتورة ${invoice.id} (${invoice.customerName || "عميل"})`,
        date: (invoice.date || "").slice(0, 10) || undefined,
        sourceType: "invoice",
        sourceId: invoice.id,
        postedBy,
        transaction: opts.transaction,
        branchId: invoice.branchId || opts.branchId,
        ...(hasSubCentAmount ? { precision: 4 } : {}),
      }, lines);
    }

    // Choose the debit-side account from payment method / status.
    const method = String(invoice.paymentMethod || "").toLowerCase();
    const isCredit = ["due", "partial", "installment", "credit"].includes(String(invoice.status || "").toLowerCase());
    const debitMappingRole = isCredit ? "ACCOUNTS_RECEIVABLE" : treasuryMappingRole(method);

    const lines = [];

    // Installment sale: split the debit between the down-payment (cash/bank)
    // and the financed remainder (Accounts Receivable).
    const downPayment = moneyRound(invoice.downPayment);
    if (invoice.type === "installment" && downPayment > 0 && downPayment < total) {
      lines.push({ mappingRole: treasuryMappingRole(method), debit: downPayment, credit: 0, description: `مقدّم فاتورة ${invoice.id}` });
      lines.push({ mappingRole: "ACCOUNTS_RECEIVABLE", debit: moneyRound(total - downPayment), credit: 0, description: `أقساط مستحقة ${invoice.id}` });
    } else if (method === "split" && Array.isArray(invoice.paymentSplits) && invoice.paymentSplits.length > 0) {
      const voucherSettlements = new Map(
        (Array.isArray(opts.giftVoucherSettlements) ? opts.giftVoucherSettlements : [])
          .map((settlement) => [String(settlement.voucherId), settlement])
      );
      for (const split of invoice.paymentSplits) {
        const splitMethod = String(split.method || "").toLowerCase();
        const splitAmt = moneyRound(split.amount);
        if (splitMethod === "gift_voucher") {
          const settlement = voucherSettlements.get(String(split.giftVoucherId || ""));
          if (!settlement || !settlement.liabilityAccountId || moneyRound(settlement.amount) !== splitAmt) {
            throw new Error("Gift Voucher settlement must supply an exact semantic liability account.");
          }
          lines.push({ accountId: settlement.liabilityAccountId, debit: splitAmt, credit: 0, description: `تسوية التزام قسيمة هدية ${settlement.voucherCode || ""}`.trim() });
        } else {
          lines.push({ mappingRole: treasuryMappingRole(splitMethod), debit: splitAmt, credit: 0, description: `دفع مجزأ ${splitMethod} - فاتورة ${invoice.id}` });
        }
      }
    } else {
      if (method === "gift_voucher") {
        throw new Error("Gift Voucher settlement requires canonical split payment handling.");
      }
      lines.push({ mappingRole: debitMappingRole, debit: total, credit: 0, description: `فاتورة ${invoice.id}` });
    }

    const byKarat = await this.resolveAccountingByKarat(companyId, opts);
    if (byKarat) {
      // Revenue / COGS / Inventory split across karats (VAT + debit side stay as-is).
      lines.push(...karatSplitLines({ items, revenueTotal: subtotal, totalCost: cost, reverse: false }));
      if (tax > 0) {
        lines.push({ accountCode: "2200", debit: 0, credit: tax, description: "ضريبة القيمة المضافة" });
      }
    } else {
      lines.push({ accountCode: "4100", debit: 0, credit: subtotal, description: "إيراد مبيعات" });
      if (tax > 0) {
        lines.push({ accountCode: "2200", debit: 0, credit: tax, description: "ضريبة القيمة المضافة" });
      }
      if (cost > 0) {
        lines.push({ accountCode: "5000", debit: cost, credit: 0, description: "تكلفة البضاعة المباعة" });
        lines.push({ accountCode: "1200", debit: 0, credit: cost, description: "تخفيض المخزون" });
      }
    }

    return this.postEntry(
      companyId,
      {
        description: `قيد بيع — فاتورة ${invoice.id} (${invoice.customerName || "عميل"})`,
        date: (invoice.date || "").slice(0, 10) || undefined,
        sourceType: "invoice",
        sourceId: invoice.id,
        postedBy,
        transaction: opts.transaction,
        branchId: invoice.branchId || opts.branchId,
        ...(hasSubCentAmount ? { precision: 4 } : {})
      },
      lines
    );
  }

  /**
   * Build & post the reversing entry for a RETURN invoice (mirror of a sale).
   */
  async postReturnEntry(invoice, items = [], postedBy = "System", opts = {}) {
    const companyId = invoice.companyId;
    const total = round(invoice.total);
    const tax = round(invoice.tax);
    const subtotal = round(invoice.subtotal != null ? invoice.subtotal : total - tax);
    const cost = round(items.reduce((s, it) => s + (Number(it.cost) || 0) * (Number(it.quantity) || 1), 0));

    // Phase 21.2 + Phase 30: the return money leg splits between customer
    // receivable relief and the excess owed back to the customer. The excess is
    // settled across mapped cash, mapped bank, and/or mapped customer-deposit
    // liability accounts per the operator's settlement choice. Callers pass
    // amounts only; Branch mappings remain the account authority.
    // When cashRefundAmount is omitted (legacy callers) this falls back to the
    // previous behaviour — a full mapped cash refund — so the entry still
    // balances to `total`. One return journal remains the GL owner.
    const receivableRelief = round(opts.receivableReliefAmount != null ? opts.receivableReliefAmount : 0);
    const cashRefund = round(opts.cashRefundAmount != null ? opts.cashRefundAmount : total - receivableRelief);
    const bankRefund = round(opts.bankRefundAmount != null ? opts.bankRefundAmount : 0);
    const customerCredit = round(opts.customerCreditAmount != null ? opts.customerCreditAmount : 0);
    const moneyLegLines = [];
    if (receivableRelief > 0) {
      moneyLegLines.push({ mappingRole: "ACCOUNTS_RECEIVABLE", debit: 0, credit: receivableRelief, description: `تخفيض ذمم العميل — مرتجع فاتورة ${invoice.id}` });
    }
    if (cashRefund > 0) {
      moneyLegLines.push({ mappingRole: "CASH_TREASURY", debit: 0, credit: cashRefund, description: `مرتجع نقدي — فاتورة ${invoice.id}` });
    }
    if (bankRefund > 0) {
      moneyLegLines.push({ mappingRole: "BANK_ACCOUNT", debit: 0, credit: bankRefund, description: `مرتجع بنكي — فاتورة ${invoice.id}` });
    }
    if (customerCredit > 0) {
      moneyLegLines.push({ mappingRole: "RESERVATION_ADVANCE_LIABILITY", debit: 0, credit: customerCredit, description: `رصيد دائن للعميل — مرتجع فاتورة ${invoice.id}` });
    }

    const byKarat = await this.resolveAccountingByKarat(companyId, opts);
    const lines = [];
    if (byKarat) {
      // Reverse the sale split: Dr revenue / Cr COGS / Dr inventory, per karat.
      lines.push(...karatSplitLines({ items, revenueTotal: subtotal, totalCost: cost, reverse: true }));
      if (tax > 0) lines.push({ accountCode: "2200", debit: tax, credit: 0, description: "عكس ضريبة" });
      lines.push(...moneyLegLines);
    } else {
      lines.push({ accountCode: "4100", debit: subtotal, credit: 0, description: "عكس إيراد مبيعات" });
      if (tax > 0) lines.push({ accountCode: "2200", debit: tax, credit: 0, description: "عكس ضريبة" });
      lines.push(...moneyLegLines);
      if (cost > 0) {
        lines.push({ accountCode: "1200", debit: cost, credit: 0, description: "إرجاع للمخزون" });
        lines.push({ accountCode: "5000", debit: 0, credit: cost, description: "عكس التكلفة" });
      }
    }

    return this.postEntry(
      companyId,
      {
        description: `قيد مرتجع — فاتورة ${invoice.id}`,
        date: (invoice.date || "").slice(0, 10) || undefined,
        sourceType: "return",
        sourceId: invoice.id,
        postedBy,
        transaction: opts.transaction,
        branchId: invoice.branchId || opts.branchId
      },
      lines
    );
  }

  /**
   * Build & post the journal entry for a TREASURY cash movement.
   *   cash_in  : Dr  cash/bank        Cr  counter (default Other Income)
   *   cash_out : Dr  counter (default Expenses)   Cr  cash/bank
   *   transfer : Dr  toAccount        Cr  fromAccount
   */
  async postCashEntry(tx, postedBy = "System", opts = {}) {
    const companyId = tx.companyId;
    const amount = round(tx.amount);
    const sourceMappingRole = treasuryMappingRole(tx.account);

    let lines;
    let label;
    if (tx.type === "transfer") {
      const destinationMappingRole = treasuryMappingRole(tx.toAccount);
      label = `تحويل خزينة — ${tx.description || tx.id}`;
      lines = [
        { accountId: opts.toTreasuryAccountId || null, mappingRole: destinationMappingRole, debit: amount, credit: 0, description: tx.category || "تحويل" },
        { accountId: opts.treasuryAccountId || null, mappingRole: sourceMappingRole, debit: 0, credit: amount, description: tx.category || "تحويل" },
      ];
    } else if (tx.type === "cash_out") {
      label = `صرف نقدي — ${tx.category || tx.description || tx.id}`;
      lines = [
        {
          accountId: opts.counterAccountId || null,
          accountCode: opts.counterAccountId ? null : tx.counterAccountCode || null,
          mappingRole: opts.counterAccountId || tx.counterAccountCode ? null : "DEFAULT_EXPENSE",
          debit: amount,
          credit: 0,
          description: tx.category || "مصروف",
        },
        { accountId: opts.treasuryAccountId || null, mappingRole: sourceMappingRole, debit: 0, credit: amount, description: tx.category || "مصروف" },
      ];
    } else {
      // cash_in (default)
      label = `قبض نقدي — ${tx.category || tx.description || tx.id}`;
      lines = [
        { accountId: opts.treasuryAccountId || null, mappingRole: sourceMappingRole, debit: amount, credit: 0, description: tx.category || "إيراد" },
        {
          accountId: opts.counterAccountId || null,
          accountCode: opts.counterAccountId ? null : tx.counterAccountCode || null,
          mappingRole: opts.counterAccountId || tx.counterAccountCode ? null : "OTHER_INCOME",
          debit: 0,
          credit: amount,
          description: tx.category || "إيراد",
        },
      ];
    }

    return this.postEntry(
      companyId,
      {
        description: tx.description || label,
        date: (tx.date || "").slice(0, 10) || undefined,
        sourceType: "cash_transaction",
        sourceId: tx.id,
        postedBy,
        transaction: opts.transaction,
        branchId: tx.branchId || opts.branchId
      },
      lines
    );
  }

  /**
   * Customer deposit / advance: money received against a future order.
   *   Dr  Cash/Bank        Cr  Customer Deposits (2300, liability)
   */
  async postDepositEntry(invoice, postedBy = "System", opts = {}) {
    const companyId = invoice.companyId;
    const receivedAmount = opts.receivedAmount !== undefined && opts.receivedAmount !== null
      ? opts.receivedAmount
      : invoice.deposit !== undefined && invoice.deposit !== null
        ? invoice.deposit
        : invoice.paidAmount !== undefined && invoice.paidAmount !== null
          ? invoice.paidAmount
          : 0;
    const amount = round(receivedAmount);
    const method = String(invoice.paymentMethod || "").toLowerCase();
    return this.postEntry(
      companyId,
      {
        description: `عربون — ${invoice.customerName || "عميل"} (${invoice.id})`,
        date: (invoice.date || "").slice(0, 10) || undefined,
        sourceType: "deposit",
        sourceId: invoice.id,
        postedBy,
        transaction: opts.transaction,
        branchId: invoice.branchId || opts.branchId
      },
      [
        { mappingRole: treasuryMappingRole(method), debit: amount, credit: 0, description: "عربون مستلم" },
        { mappingRole: "RESERVATION_ADVANCE_LIABILITY", debit: 0, credit: amount, description: "التزام عربون عميل" },
      ]
    );
  }

  /**
   * Reservation advance payment:
   *   Dr  selected Cash/Bank account
   *   Cr  configured Customer Reservation Advances account
   *
   * The credit account is supplied by validated company accounting settings.
   * There is intentionally no fallback to 2300 and no sales/VAT/AR/COGS line.
   */
  async postReservationPaymentEntry(payment, postedBy = "System", opts = {}) {
    const companyId = payment.companyId;
    const amount = round(payment.amount);
    const debitAccountId = opts.treasuryAccountId;
    const creditAccountId = opts.advancesAccountId;
    const debitAccountCode = opts.treasuryAccountCode || payment.treasuryAccountCode;
    const creditAccountCode = opts.advancesAccountCode || payment.advancesAccountCode;

    if (!debitAccountId && !debitAccountCode) throw new Error("Reservation payment treasury account is required");
    if (!creditAccountId && !creditAccountCode) throw new Error("Reservation advances account is not configured");

    return this.postEntry(
      companyId,
      {
        description: `دفعة حجز — ${payment.reservationId} / ${payment.receiptNumber}`,
        date: payment.receivedAt ? new Date(payment.receivedAt).toISOString().slice(0, 10) : undefined,
        sourceType: "reservation_payment",
        sourceId: payment.id,
        postedBy,
        transaction: opts.transaction,
        branchId: payment.branchId || opts.branchId
      },
      [
        { accountId: debitAccountId || null, accountCode: debitAccountId ? null : debitAccountCode, debit: amount, credit: 0, description: `قبض دفعة حجز ${payment.receiptNumber}` },
        { accountId: creditAccountId || null, accountCode: creditAccountId ? null : creditAccountCode, debit: 0, credit: amount, description: `التزام دفعات حجوزات ${payment.reservationId}` },
      ]
    );
  }

  /**
   * Reservation final-sale settlement:
   *   Dr  configured Customer Reservation Advances account
   *   Cr  Accounts Receivable / Customer Control
   *
   * The sales invoice itself is posted separately through postInvoiceEntry so
   * revenue, VAT, COGS, and inventory stay on the established invoice path.
   */
  async postReservationAdvanceSettlementEntry(reservation, amount, postedBy = "System", opts = {}) {
    const companyId = reservation.companyId;
    const amt = round(amount);
    const advancesAccountCode = opts.advancesAccountCode;
    if (!advancesAccountCode && !opts.advancesAccountId) throw new Error("Reservation advances account is not configured");
    if (opts.advancesAccountId && !opts.receivableAccountId) throw new Error("Reservation settlement receivable account is not configured");

    return this.postEntry(
      companyId,
      {
        description: `تسوية دفعات حجز — ${reservation.id} / ${opts.invoiceId || reservation.finalInvoiceId || ""}`,
        date: opts.date ? String(opts.date).slice(0, 10) : undefined,
        sourceType: "reservation_settlement",
        sourceId: reservation.id,
        postedBy,
        transaction: opts.transaction,
        branchId: reservation.branchId || opts.branchId
      },
      [
        opts.advancesAccountId
          ? { accountId: opts.advancesAccountId, debit: amt, credit: 0, description: `تسوية التزام دفعات حجز ${reservation.id}` }
          : { accountCode: advancesAccountCode, debit: amt, credit: 0, description: `تسوية التزام دفعات حجز ${reservation.id}` },
        opts.receivableAccountId
          ? { accountId: opts.receivableAccountId, debit: 0, credit: amt, description: `تسوية ذمم فاتورة حجز ${opts.invoiceId || reservation.finalInvoiceId || ""}` }
          : { accountCode: "1300", debit: 0, credit: amt, description: `تسوية ذمم فاتورة حجز ${opts.invoiceId || reservation.finalInvoiceId || ""}` },
      ]
    );
  }

  /**
   * Reservation refund execution before final sale:
   *   Dr  configured Customer Reservation Advances account
   *   Cr  selected Cash/Bank account
   *
   * No revenue, VAT, COGS, inventory, or AR line is posted here because no final
   * sales invoice exists for a cancelled reservation refund.
   */
  async postReservationRefundEntry(refund, postedBy = "System", opts = {}) {
    const companyId = refund.companyId;
    const amt = round(refund.amount);
    const advancesAccountId = opts.advancesAccountId;
    const treasuryAccountId = opts.treasuryAccountId;
    const advancesAccountCode = opts.advancesAccountCode;
    const treasuryAccountCode = opts.treasuryAccountCode || refund.treasuryAccountCode;
    if (!advancesAccountId && !advancesAccountCode) throw new Error("Reservation advances account is not configured");
    if (!treasuryAccountId && !treasuryAccountCode) throw new Error("Reservation refund treasury account is required");

    return this.postEntry(
      companyId,
      {
        description: `استرداد دفعات حجز — ${refund.reservationId}`,
        date: refund.executedAt ? new Date(refund.executedAt).toISOString().slice(0, 10) : undefined,
        sourceType: "reservation_refund",
        sourceId: refund.id,
        postedBy,
        transaction: opts.transaction,
        branchId: refund.branchId || opts.branchId
      },
      [
        { accountId: advancesAccountId || null, accountCode: advancesAccountId ? null : advancesAccountCode, debit: amt, credit: 0, description: `إقفال التزام دفعات حجز ${refund.reservationId}` },
        { accountId: treasuryAccountId || null, accountCode: treasuryAccountId ? null : treasuryAccountCode, debit: 0, credit: amt, description: `صرف استرداد حجز ${refund.reservationId}` },
      ]
    );
  }

  /**
   * Supplier purchase receiving:
   *   Dr  Inventory (1200)              total received cost
   *   Cr  mapped Cash/Bank               paid amount, if any
   *   Cr  Accounts Payable (2100)       unpaid balance
   */
  async postPurchaseEntry(purchaseOrder, paidAmount = 0, paymentMethod = "credit", postedBy = "System", opts = {}) {
    const companyId = purchaseOrder.companyId;
    const total = round(purchaseOrder.total);
    const method = String(paymentMethod || "").toLowerCase();

    // Phase 12G — purchase VAT / RCM, driven ONLY by the PurchaseOrder snapshot
    // fields (12F) + optional settings account codes (12E). Default path (no VAT
    // fields set) is byte-identical to before: Case A below. NO VAT amount is
    // ever ADDED on top of inventory — recoverable input VAT and RCM SPLIT the
    // gross so there is no double-count.
    const TOL = 0.01;
    const isRcm = purchaseOrder.isRcm === true;
    const isRecoverable = purchaseOrder.isRecoverable !== false; // default true
    const taxBase = round(purchaseOrder.taxBase || 0);
    const inputVat = round(purchaseOrder.inputVatAmount || 0);
    const rcmVat = round(purchaseOrder.rcmVatAmount || 0);
    const vatRate = Number(purchaseOrder.vatRate || 0);
    const rcmRate = Number(purchaseOrder.rcmRate || 0);
    const inputVatAccountCode = opts.inputVatAccountCode || "1400";
    const rcmOutputAccountCode = opts.rcmOutputAccountCode || "2210";

    // General validation (before any write — postEntry is the only write).
    if (taxBase < 0 || inputVat < 0 || rcmVat < 0) throw new Error("Purchase VAT amounts cannot be negative");
    if (vatRate < 0 || vatRate > 100 || rcmRate < 0 || rcmRate > 100) throw new Error("Purchase VAT rate must be between 0 and 100");

    let inventoryDebit;     // amount capitalised into inventory
    let supplierPayable;    // gross owed to the supplier (cash + AP)
    const vatLines = [];
    if (isRcm) {
      // Case D — reverse charge: supplier is NOT paid VAT; buyer self-accounts.
      if (inputVat > 0) throw new Error("RCM purchase must not carry ordinary input VAT");
      if (rcmVat <= 0) throw new Error("RCM purchase requires a positive rcmVatAmount");
      if (taxBase <= 0) throw new Error("RCM purchase requires a positive taxBase");
      if (Math.abs(total - taxBase) > TOL) throw new Error("RCM purchase total must equal taxBase (supplier is not paid VAT)");
      inventoryDebit = taxBase;
      supplierPayable = taxBase;
      vatLines.push({ accountCode: inputVatAccountCode, debit: rcmVat, credit: 0, description: "ضريبة مدخلات احتساب عكسي" });
      vatLines.push({ accountCode: rcmOutputAccountCode, debit: 0, credit: rcmVat, description: "ضريبة مخرجات احتساب عكسي" });
    } else if (isRecoverable && inputVat > 0) {
      // Case B — recoverable input VAT: SPLIT the gross (no double-count).
      if (taxBase <= 0) throw new Error("Recoverable input VAT requires a positive taxBase");
      if (Math.abs(taxBase + inputVat - total) > TOL) throw new Error("taxBase + inputVatAmount must equal total");
      inventoryDebit = taxBase;
      supplierPayable = total;
      vatLines.push({ accountCode: inputVatAccountCode, debit: inputVat, credit: 0, description: "ضريبة مدخلات قابلة للخصم" });
    } else {
      // Case A (no VAT) / Case C (non-recoverable → VAT stays in inventory cost).
      inventoryDebit = total;
      supplierPayable = total;
    }

    const paidIn = round(paidAmount);
    if (paidIn > supplierPayable + TOL) throw new Error("Paid amount cannot exceed the amount payable to the supplier");
    const paid = Math.min(paidIn, supplierPayable);
    const payable = round(supplierPayable - paid);

    // Inventory DEBIT side: split by karat when the flag is on AND items are
    // supplied (via opts.items = the receive route's normalizedItems). When off,
    // or items missing, fall back to the single 1200 account (unchanged).
    const byKarat = await this.resolveAccountingByKarat(companyId, opts);
    const items = Array.isArray(opts.items) ? opts.items : null;
    const lines = [];
    if (byKarat && items && items.length) {
      lines.push(...karatPurchaseInventoryLines(items, inventoryDebit));
    } else {
      lines.push({ accountCode: "1200", debit: inventoryDebit, credit: 0, description: `استلام مخزون من المورد ${purchaseOrder.supplierName}` });
    }

    // VAT lines (recoverable input VAT / RCM) — never added on top of inventory.
    lines.push(...vatLines);

    // Credit side (cash / bank / AP) — gross owed to the supplier.
    if (paid > 0) {
      lines.push({ mappingRole: treasuryMappingRole(method), debit: 0, credit: paid, description: `دفع للمورد ${purchaseOrder.supplierName}` });
    }
    if (payable > 0) {
      lines.push({ mappingRole: "SUPPLIER_PAYABLE", debit: 0, credit: payable, description: `ذمم مورد ${purchaseOrder.supplierName}` });
    }

    return this.postEntry(
      companyId,
      {
        description: `قيد استلام مشتريات — أمر ${purchaseOrder.id}`,
        date: (purchaseOrder.receivedDate || purchaseOrder.date || "").slice(0, 10) || undefined,
        sourceType: "purchase_order",
        sourceId: purchaseOrder.id,
        postedBy,
        transaction: opts.transaction,
        branchId: purchaseOrder.branchId || opts.branchId,
      },
      lines
    );
  }

  /**
   * Gift voucher issued: customer pays, we owe goods/services later.
   *   Dr  Cash/Bank        Cr  Gift Voucher Liability (2400)
   */
  async postVoucherIssueEntry(voucher, postedBy = "System", opts = {}) {
    const companyId = voucher.companyId;
    const amount = round(voucher.value);
    const method = String(voucher.paymentMethod || "").toLowerCase();
    return this.postEntry(
      companyId,
      {
        description: `إصدار قسيمة هدية ${voucher.code}`,
        sourceType: "gift_voucher_issue",
        sourceId: voucher.id,
        postedBy,
        transaction: opts.transaction,
        branchId: voucher.branchId || opts.branchId
      },
      [
        { mappingRole: treasuryMappingRole(method), debit: amount, credit: 0, description: "بيع قسيمة هدية" },
        { accountCode: "2400", debit: 0, credit: amount, description: "التزام قسيمة هدية" },
      ]
    );
  }

  /**
   * Gift voucher redeemed: liability is settled as it is spent.
   *   Dr  Gift Voucher Liability (2400)   Cr  Jewelry Sales (4100)
   */
  async postVoucherRedeemEntry(voucher, amount, postedBy = "System", opts = {}) {
    const companyId = voucher.companyId;
    const amt = round(amount);
    return this.postEntry(
      companyId,
      {
        description: `استخدام قسيمة هدية ${voucher.code}`,
        sourceType: "gift_voucher_redeem",
        sourceId: voucher.id,
        postedBy,
        transaction: opts.transaction,
        branchId: voucher.branchId || opts.branchId
      },
      [
        { accountCode: "2400", debit: amt, credit: 0, description: "صرف من التزام القسيمة" },
        { accountCode: "4100", debit: 0, credit: amt, description: "إيراد مقابل القسيمة" },
      ]
    );
  }

  /**
   * Installment collection: customer pays an instalment, reducing receivables.
   *   Dr  Cash/Bank        Cr  Accounts Receivable (1300)
   */
  async postInstallmentPayment(installment, amount, paymentMethod = "Cash", postedBy = "System", opts = {}) {
    const companyId = installment.companyId;
    // Installment collections are a four-decimal business domain. Preserve the
    // exact amount through Journal lines and Account.balance; display rounding
    // belongs at the presentation boundary, never in accounting posting.
    const amt = moneyFromUnits4(moneyToUnits4(amount));
    const method = String(paymentMethod).toLowerCase();
    const collectionEventId = String(opts.collectionEventId || "").trim();
    if (!collectionEventId) {
      throw new AppError("Installment collection requires a durable payment event", 422, "INSTALLMENT_COLLECTION_EVENT_REQUIRED");
    }
    return this.postEntry(
      companyId,
      {
        description: `تحصيل قسط #${installment.sequence} — فاتورة ${installment.invoiceId}`,
        // An installment may be collected more than once.  The durable Payment
        // created by the route is the financial event, while the installment is
        // only the aggregate being reduced.
        sourceType: "installment_collection",
        sourceId: collectionEventId,
        postedBy,
        transaction: opts.transaction,
        branchId: opts.branchId || installment.branchId || null,
        precision: 4
      },
      [
        { mappingRole: treasuryMappingRole(method), debit: amt, credit: 0, description: "تحصيل قسط" },
        { mappingRole: "ACCOUNTS_RECEIVABLE", debit: 0, credit: amt, description: "سداد ذمم العميل" },
      ]
    );
  }

  /**
   * Salary payment for a payslip:
   *   Dr  Salaries & Wages (6100)     Cr  Cash/Bank
   */
  async postPayrollEntry(payslip, paymentMethod = "Cash", postedBy = "System", opts = {}) {
    const companyId = payslip.companyId;
    const amount = round(payslip.net);
    const method = String(paymentMethod).toLowerCase();
    return this.postEntry(
      companyId,
      {
        description: `صرف راتب ${payslip.employeeName || payslip.employeeId} — ${payslip.period}`,
        sourceType: "payroll",
        sourceId: payslip.id,
        postedBy,
        transaction: opts.transaction,
        branchId: payslip.branchId || opts.branchId
      },
      [
        { accountCode: "6100", debit: amount, credit: 0, description: "رواتب وأجور موظفين" },
        { mappingRole: treasuryMappingRole(method), debit: 0, credit: amount, description: "صرف رواتب" }
      ]
    );
  }

  /**
   * Preview lines for a sale WITHOUT persisting — used by the POS
   * Journal Preview before the invoice is posted.
   */
  previewInvoiceLines({ total, tax, subtotal, cost = 0, paymentMethod = "Cash", status = "paid" }) {
    total = round(total);
    tax = round(tax);
    subtotal = round(subtotal != null ? subtotal : total - tax);
    cost = round(cost);
    const method = String(paymentMethod).toLowerCase();
    const isCredit = ["due", "partial", "installment", "credit"].includes(String(status).toLowerCase());
    let debitCode = "1110";
    if (isCredit) debitCode = "1300";
    else if (method.includes("card") || method.includes("bank") || method.includes("شبك") || method.includes("تحويل"))
      debitCode = "1120";

    const acc = (code) => ({ code, name: CHART[code]?.nameAr || code });
    const lines = [
      { account: acc(debitCode), debit: total, credit: 0 },
      { account: acc("4100"), debit: 0, credit: subtotal },
    ];
    if (tax > 0) lines.push({ account: acc("2200"), debit: 0, credit: tax });
    if (cost > 0) {
      lines.push({ account: acc("5000"), debit: cost, credit: 0 });
      lines.push({ account: acc("1200"), debit: 0, credit: cost });
    }
    const totalDebit = round(lines.reduce((s, l) => s + l.debit, 0));
    const totalCredit = round(lines.reduce((s, l) => s + l.credit, 0));
    return { lines, totalDebit, totalCredit, balanced: Math.abs(totalDebit - totalCredit) < 0.01 };
  }
}

module.exports = new PostingService();
module.exports.CHART = CHART;
module.exports.karatAccounts = karatAccounts;
