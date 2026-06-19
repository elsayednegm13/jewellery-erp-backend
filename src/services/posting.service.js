const { Account, JournalEntry, JournalLine, sequelize } = require("../models");
const logger = require("../utils/logger");

/**
 * Financial Posting Engine
 * ------------------------------------------------------------------
 * Turns business events (sale, return, purchase, cash movement) into
 * balanced double-entry journal entries, following the docs:
 *   Event → Accounting Mapping → Auto Journal Generation
 *
 * Design rules:
 *  - Every entry MUST balance (sum of debit === sum of credit).
 *  - Accounts are resolved by CODE and auto-created if missing, so the
 *    engine is self-healing on both fresh and existing databases.
 *  - Each entry is linked to its source (sourceType / sourceId) for
 *    full traceability.
 */

// Canonical Chart of Accounts for jewellery retail.
// code → definition. Used to auto-create any account the engine needs.
const CHART = {
  "1000": { name: "Assets", nameAr: "الأصول", type: "asset", nature: "debit", level: 1, parent: null },
  "1100": { name: "Cash & Bank", nameAr: "النقد والبنوك", type: "asset", nature: "debit", level: 2, parent: "1000" },
  "1110": { name: "Cash on Hand", nameAr: "نقد في الخزنة", type: "asset", nature: "debit", level: 3, parent: "1100" },
  "1120": { name: "Bank Accounts", nameAr: "الحسابات البنكية", type: "asset", nature: "debit", level: 3, parent: "1100" },
  "1200": { name: "Inventory", nameAr: "المخزون", type: "asset", nature: "debit", level: 2, parent: "1000" },
  "1300": { name: "Accounts Receivable", nameAr: "ذمم العملاء", type: "asset", nature: "debit", level: 2, parent: "1000" },
  "2000": { name: "Liabilities", nameAr: "الخصوم", type: "liability", nature: "credit", level: 1, parent: null },
  "2100": { name: "Accounts Payable", nameAr: "ذمم الموردين", type: "liability", nature: "credit", level: 2, parent: "2000" },
  "2200": { name: "VAT Payable", nameAr: "ضريبة القيمة المضافة", type: "liability", nature: "credit", level: 2, parent: "2000" },
  "2300": { name: "Customer Deposits", nameAr: "عرابين العملاء", type: "liability", nature: "credit", level: 2, parent: "2000" },
  "2400": { name: "Gift Voucher Liability", nameAr: "التزام قسائم الهدايا", type: "liability", nature: "credit", level: 2, parent: "2000" },
  "3000": { name: "Equity", nameAr: "حقوق الملكية", type: "equity", nature: "credit", level: 1, parent: null },
  "4000": { name: "Revenue", nameAr: "الإيرادات", type: "revenue", nature: "credit", level: 1, parent: null },
  "4100": { name: "Jewelry Sales", nameAr: "مبيعات المجوهرات", type: "revenue", nature: "credit", level: 2, parent: "4000" },
  "4200": { name: "Gold Profit", nameAr: "أرباح الذهب", type: "revenue", nature: "credit", level: 2, parent: "4000" },
  "4900": { name: "Other Income", nameAr: "إيرادات أخرى", type: "revenue", nature: "credit", level: 2, parent: "4000" },
  "5000": { name: "Cost of Goods Sold", nameAr: "تكلفة البضاعة المباعة", type: "expense", nature: "debit", level: 1, parent: null },
  "6000": { name: "Operating Expenses", nameAr: "المصروفات التشغيلية", type: "expense", nature: "debit", level: 1, parent: null },
  "6100": { name: "Salaries & Wages", nameAr: "الرواتب والأجور", type: "expense", nature: "debit", level: 2, parent: "6000" },
};

// Map a treasury account keyword to its GL account code.
const TREASURY_ACCOUNT = { cash: "1110", bank: "1120" };

const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

class PostingService {
  /**
   * Resolve an account by code for a company, creating it from the
   * canonical chart if it does not yet exist.
   */
  async ensureAccount(companyId, code, transaction) {
    let account = await Account.findOne({ where: { companyId, code }, transaction });
    if (account) return account;

    const def = CHART[code];
    if (!def) {
      throw new Error(`Unknown account code "${code}" — not in canonical chart of accounts.`);
    }
    account = await Account.create(
      {
        id: `ACC-${code}-${companyId}`.slice(0, 60),
        companyId,
        code,
        name: def.name,
        nameAr: def.nameAr,
        type: def.type,
        nature: def.nature,
        parentId: def.parent ? `ACC-${def.parent}` : null,
        balance: 0,
        isActive: true,
        level: def.level,
      },
      { transaction }
    );
    logger.info(`[Posting] Auto-created account ${code} (${def.nameAr}) for ${companyId}`);
    return account;
  }

  /**
   * Core: create a balanced journal entry from a set of lines.
   * @param {string} companyId
   * @param {object} opts { description, date, sourceType, sourceId, postedBy, transaction, branchId }
   * @param {Array} lines [{ accountCode, debit, credit, description }]
   * @returns {JournalEntry} with lines
   */
  async postEntry(companyId, opts, lines) {
    const totalDebit = round(lines.reduce((s, l) => s + (Number(l.debit) || 0), 0));
    const totalCredit = round(lines.reduce((s, l) => s + (Number(l.credit) || 0), 0));

    // Posting validation: reject unbalanced entries.
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
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
      for (const line of lines) {
        const account = await this.ensureAccount(companyId, line.accountCode, t);
        const debit = round(line.debit);
        const credit = round(line.credit);

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
    const total = round(invoice.total);
    const tax = round(invoice.tax);
    const subtotal = round(invoice.subtotal != null ? invoice.subtotal : total - tax);
    const cost = round(items.reduce((s, it) => s + (Number(it.cost) || 0) * (Number(it.quantity) || 1), 0));

    // Choose the debit-side account from payment method / status.
    const method = String(invoice.paymentMethod || "").toLowerCase();
    const isCredit = ["due", "partial", "installment", "credit"].includes(String(invoice.status || "").toLowerCase());
    let debitCode = "1110"; // Cash on Hand
    if (isCredit) debitCode = "1300"; // Accounts Receivable
    else if (method.includes("card") || method.includes("bank") || method.includes("شبك") || method.includes("تحويل"))
      debitCode = "1120"; // Bank

    const lines = [];

    // Installment sale: split the debit between the down-payment (cash/bank)
    // and the financed remainder (Accounts Receivable).
    const downPayment = round(invoice.downPayment);
    if (invoice.type === "installment" && downPayment > 0 && downPayment < total) {
      const cashCode = method.includes("card") || method.includes("bank") || method.includes("شبك") || method.includes("تحويل") ? "1120" : "1110";
      lines.push({ accountCode: cashCode, debit: downPayment, credit: 0, description: `مقدّم فاتورة ${invoice.id}` });
      lines.push({ accountCode: "1300", debit: round(total - downPayment), credit: 0, description: `أقساط مستحقة ${invoice.id}` });
    } else if (method === "split" && Array.isArray(invoice.paymentSplits) && invoice.paymentSplits.length > 0) {
      for (const split of invoice.paymentSplits) {
        const splitMethod = String(split.method || "").toLowerCase();
        const splitAmt = round(split.amount);
        const splitCode = splitMethod.includes("card") || splitMethod.includes("bank") || splitMethod.includes("شبك") || splitMethod.includes("transfer") ? "1120" : "1110";
        lines.push({ accountCode: splitCode, debit: splitAmt, credit: 0, description: `دفع مجزأ ${splitMethod} - فاتورة ${invoice.id}` });
      }
    } else {
      lines.push({ accountCode: debitCode, debit: total, credit: 0, description: `فاتورة ${invoice.id}` });
    }

    lines.push({ accountCode: "4100", debit: 0, credit: subtotal, description: "إيراد مبيعات" });
    if (tax > 0) {
      lines.push({ accountCode: "2200", debit: 0, credit: tax, description: "ضريبة القيمة المضافة" });
    }
    if (cost > 0) {
      lines.push({ accountCode: "5000", debit: cost, credit: 0, description: "تكلفة البضاعة المباعة" });
      lines.push({ accountCode: "1200", debit: 0, credit: cost, description: "تخفيض المخزون" });
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
        branchId: invoice.branchId || opts.branchId
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

    const lines = [
      { accountCode: "4100", debit: subtotal, credit: 0, description: "عكس إيراد مبيعات" },
    ];
    if (tax > 0) lines.push({ accountCode: "2200", debit: tax, credit: 0, description: "عكس ضريبة" });
    lines.push({ accountCode: "1110", debit: 0, credit: total, description: `مرتجع فاتورة ${invoice.id}` });
    if (cost > 0) {
      lines.push({ accountCode: "1200", debit: cost, credit: 0, description: "إرجاع للمخزون" });
      lines.push({ accountCode: "5000", debit: 0, credit: cost, description: "عكس التكلفة" });
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
    const accCode = TREASURY_ACCOUNT[tx.account] || "1110";

    let lines;
    let label;
    if (tx.type === "transfer") {
      const toCode = TREASURY_ACCOUNT[tx.toAccount] || "1120";
      label = `تحويل خزينة — ${tx.description || tx.id}`;
      lines = [
        { accountCode: toCode, debit: amount, credit: 0, description: tx.category || "تحويل" },
        { accountCode: accCode, debit: 0, credit: amount, description: tx.category || "تحويل" },
      ];
    } else if (tx.type === "cash_out") {
      const counter = tx.counterAccountCode || "6000";
      label = `صرف نقدي — ${tx.category || tx.description || tx.id}`;
      lines = [
        { accountCode: counter, debit: amount, credit: 0, description: tx.category || "مصروف" },
        { accountCode: accCode, debit: 0, credit: amount, description: tx.category || "مصروف" },
      ];
    } else {
      // cash_in (default)
      const counter = tx.counterAccountCode || "4900";
      label = `قبض نقدي — ${tx.category || tx.description || tx.id}`;
      lines = [
        { accountCode: accCode, debit: amount, credit: 0, description: tx.category || "إيراد" },
        { accountCode: counter, debit: 0, credit: amount, description: tx.category || "إيراد" },
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
    const amount = round(invoice.deposit || invoice.total);
    const method = String(invoice.paymentMethod || "").toLowerCase();
    const cashCode = method.includes("card") || method.includes("bank") || method.includes("شبك") || method.includes("تحويل") ? "1120" : "1110";
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
        { accountCode: cashCode, debit: amount, credit: 0, description: "عربون مستلم" },
        { accountCode: "2300", debit: 0, credit: amount, description: "التزام عربون عميل" },
      ]
    );
  }

  /**
   * Supplier purchase receiving:
   *   Dr  Inventory (1200)              total received cost
   *   Cr  Cash/Bank (1110/1120)         paid amount, if any
   *   Cr  Accounts Payable (2100)       unpaid balance
   */
  async postPurchaseEntry(purchaseOrder, paidAmount = 0, paymentMethod = "credit", postedBy = "System", opts = {}) {
    const companyId = purchaseOrder.companyId;
    const total = round(purchaseOrder.total);
    const paid = Math.min(round(paidAmount), total);
    const payable = round(total - paid);
    const method = String(paymentMethod || "").toLowerCase();
    const cashCode = method.includes("card") || method.includes("bank") || method.includes("transfer") || method.includes("تحويل") ? "1120" : "1110";
    const lines = [
      { accountCode: "1200", debit: total, credit: 0, description: `استلام مخزون من المورد ${purchaseOrder.supplierName}` },
    ];

    if (paid > 0) {
      lines.push({ accountCode: cashCode, debit: 0, credit: paid, description: `دفع للمورد ${purchaseOrder.supplierName}` });
    }
    if (payable > 0) {
      lines.push({ accountCode: "2100", debit: 0, credit: payable, description: `ذمم مورد ${purchaseOrder.supplierName}` });
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
    const cashCode = method.includes("card") || method.includes("bank") || method.includes("شبك") || method.includes("تحويل") ? "1120" : "1110";
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
        { accountCode: cashCode, debit: amount, credit: 0, description: "بيع قسيمة هدية" },
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
    const amt = round(amount);
    const method = String(paymentMethod).toLowerCase();
    const cashCode = method.includes("card") || method.includes("bank") || method.includes("شبك") || method.includes("تحويل") ? "1120" : "1110";
    return this.postEntry(
      companyId,
      {
        description: `تحصيل قسط #${installment.sequence} — فاتورة ${installment.invoiceId}`,
        sourceType: "installment",
        sourceId: installment.id,
        postedBy,
        transaction: opts.transaction,
        branchId: installment.branch || opts.branchId
      },
      [
        { accountCode: cashCode, debit: amt, credit: 0, description: "تحصيل قسط" },
        { accountCode: "1300", debit: 0, credit: amt, description: "سداد ذمم العميل" },
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
    const cashCode = method.includes("card") || method.includes("bank") || method.includes("شبك") || method.includes("تحويل") ? "1120" : "1110";
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
        { accountCode: cashCode, debit: 0, credit: amount, description: "صرف رواتب" }
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
