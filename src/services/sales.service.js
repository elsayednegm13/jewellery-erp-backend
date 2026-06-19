const { ValidationError } = require("../utils/errors");

/**
 * Sales service — the single source of truth for SALE CALCULATION rules so that
 * every sale path (POS checkout, reservation/deposit draft, future returns/exchanges)
 * computes VAT, totals, payment status and installment schedules identically.
 *
 * These are pure helpers (no DB writes). The transactional orchestration stays in
 * the routes, but the math/validation that used to be duplicated lives here.
 */

function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Compute invoice money fields from the line subtotal + charges and the company
 * VAT rate. Backend is the authority — callers must pass the settings-derived rate.
 *
 * @param {object} p
 * @param {number} p.subtotal       sum of item prices (net, before charges/discount)
 * @param {number} [p.makingCharge]
 * @param {number} [p.stoneValue]
 * @param {number} [p.discount]
 * @param {number} p.vatRatePercent VAT rate as a percentage (e.g. 14, 15)
 * @returns {{subtotal:number, taxBase:number, tax:number, total:number, vatRate:number}}
 */
function computeTotals({ subtotal = 0, makingCharge = 0, stoneValue = 0, discount = 0, vatRatePercent = 0 }) {
  const sub = Number(subtotal) || 0;
  const rate = Number(vatRatePercent) || 0;
  const taxBase = Math.max(0, sub + (Number(makingCharge) || 0) + (Number(stoneValue) || 0) - (Number(discount) || 0));
  const tax = roundMoney(taxBase * (rate / 100));
  const total = roundMoney(taxBase + tax);
  return { subtotal: sub, taxBase, tax, total, vatRate: rate };
}

/**
 * Build an installment schedule. Last instalment absorbs any rounding remainder so
 * the rows always sum exactly to `remaining`.
 *
 * @returns {Array<{sequence:number, dueDate:string, amount:number, paidAmount:number, status:string}>}
 */
function buildInstallmentSchedule({ remaining, installmentCount, frequency = "monthly", firstDueDate, customDays }) {
  const count = parseInt(installmentCount, 10) || 0;
  const rem = roundMoney(remaining);
  if (count <= 0) return [];
  const per = roundMoney(rem / count);
  const base = firstDueDate ? new Date(firstDueDate) : new Date();
  const rows = [];
  for (let n = 1; n <= count; n++) {
    const due = new Date(base);
    if (frequency === "weekly") {
      due.setDate(due.getDate() + (n - 1) * 7);
    } else if (frequency === "custom" && customDays) {
      due.setDate(due.getDate() + (n - 1) * parseInt(customDays, 10));
    } else {
      due.setMonth(due.getMonth() + (n - 1));
    }
    const amount = n === count ? roundMoney(rem - per * (count - 1)) : per;
    rows.push({ sequence: n, dueDate: due.toISOString().slice(0, 10), amount, paidAmount: 0, status: "pending" });
  }
  return rows;
}

function hasZeroDownPermission(user) {
  return Boolean(user && ((user.permissions && user.permissions.includes("pos.installment.zeroDownPayment")) || user.isAdmin));
}

/**
 * Resolve payment outcome (paid/remaining/status) + installment schedule for a sale,
 * applying all payment-method-specific validation and the company installment rules.
 * Throws ValidationError on invalid input. No DB access.
 *
 * @param {object} p
 * @param {string} p.paymentMethod  cash|card|transfer|split|installment|deposit
 * @param {number} p.total          gross invoice total (incl. VAT)
 * @param {object} p.body           the raw request body (downPayment, installmentCount, paymentSplits, deposit, ...)
 * @param {object} p.installmentRules settings.installment
 * @param {object} [p.user]         req.user (for zero-down permission)
 * @returns {{paidAmount:number, remainingAmount:number, status:string, installmentsToCreate:Array}}
 */
function resolvePayment({ paymentMethod, total, body = {}, installmentRules = {}, user }) {
  let paidAmount = 0;
  let remainingAmount = 0;
  let status = "due";
  let installmentsToCreate = [];

  if (paymentMethod === "installment") {
    const downPayment = Number(body.downPayment) || 0;
    const installmentCount = parseInt(body.installmentCount, 10) || 0;
    const frequency = body.installmentFrequency || installmentRules.defaultFrequency || "monthly";

    if (installmentRules.enabled === false) {
      throw new ValidationError("البيع بالتقسيط غير مفعّل في إعدادات النظام");
    }
    if (downPayment > total) {
      throw new ValidationError("الدفعة الأولى لا يمكن أن تتجاوز القيمة الإجمالية للفاتورة");
    }
    const maxInstallments = Number(installmentRules.maxInstallments) || 0;
    if (maxInstallments > 0 && installmentCount > maxInstallments) {
      throw new ValidationError(`عدد الأقساط يتجاوز الحد الأقصى المسموح به (${maxInstallments})`);
    }
    if (downPayment === 0) {
      const zeroAllowed = installmentRules.allowZeroDownPayment || false;
      if (!zeroAllowed && !hasZeroDownPermission(user)) {
        throw new ValidationError("البيع بالتقسيط يتطلب دفعة أولى بناءً على إعدادات النظام");
      }
    }
    const minDownPct = Number(installmentRules.minDownPaymentPercent) || 0;
    if (minDownPct > 0 && downPayment > 0) {
      const requiredDown = roundMoney(total * (minDownPct / 100));
      if (downPayment < requiredDown) {
        throw new ValidationError(`الدفعة الأولى يجب ألا تقل عن ${minDownPct}% من الإجمالي (${requiredDown})`);
      }
    }

    if (downPayment === total) {
      paidAmount = total;
      remainingAmount = 0;
      status = "paid";
    } else {
      if (installmentCount <= 0) {
        throw new ValidationError("عدد الأقساط يجب أن يكون أكبر من الصفر");
      }
      paidAmount = downPayment;
      remainingAmount = roundMoney(total - downPayment);
      status = "partial";
      installmentsToCreate = buildInstallmentSchedule({
        remaining: remainingAmount,
        installmentCount,
        frequency,
        firstDueDate: body.firstDueDate,
        customDays: body.customDays,
      });
    }
  } else if (paymentMethod === "split") {
    const splits = Array.isArray(body.paymentSplits) ? body.paymentSplits : [];
    let splitTotal = 0;
    for (const split of splits) splitTotal += Number(split.amount) || 0;
    if (Math.abs(splitTotal - total) > 0.01) {
      throw new ValidationError("مجموع الدفعات لا يساوي إجمالي الفاتورة");
    }
    paidAmount = total;
    remainingAmount = 0;
    status = "paid";
  } else if (paymentMethod === "deposit") {
    const depositVal = Number(body.deposit) || 0;
    if (depositVal <= 0) {
      throw new ValidationError("قيمة العربون يجب أن تكون أكبر من الصفر");
    }
    paidAmount = depositVal;
    remainingAmount = roundMoney(Math.max(0, total - depositVal));
    status = remainingAmount === 0 ? "paid" : "partial";
  } else {
    paidAmount = total;
    remainingAmount = 0;
    status = "paid";
  }

  return { paidAmount, remainingAmount, status, installmentsToCreate };
}

module.exports = { roundMoney, computeTotals, buildInstallmentSchedule, resolvePayment };
