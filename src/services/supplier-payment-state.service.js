const { Op } = require("sequelize");
const Decimal = require("decimal.js");
const { ACCOUNT_ROLE_CATALOG } = require("./financial-account-catalog.service");

/**
 * Supplier purchase-order payment state — Phase 17B.
 *
 * Source of truth (mirrors POST /purchase-orders/:id/pay):
 *   payable = PurchaseOrder.total
 *   paid    = SUM(CashTransaction.amount) WHERE type=cash_out,
 *             category="supplier_purchase", reference=PO.id (per company)
 * Supplier.due is NEVER used. No DB writes here (read/compute only).
 */

const TOL = 0.01;
const round4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;
const round2 = (n) => new Decimal(n || 0).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();

/**
 * Pure: derive the payment state for one PO given its already-aggregated paid sum.
 * @returns {{payableAmount:number, paidAmount:number, remainingAmount:number, paymentStatus:string, canPay:boolean}}
 */
function computePoPaymentState(po, paid = 0, postedPayable = undefined) {
  const originalPayable = round2(postedPayable ?? po.postedPayableAmount ?? po.total);
  const payableAmount = originalPayable;
  const paidAmount = round2(paid);
  const remainingAmount = Math.max(0, round2(payableAmount - paidAmount));
  let paymentStatus;
  if (paidAmount <= 0) paymentStatus = "unpaid";
  else if (remainingAmount > 0) paymentStatus = "partial";
  else paymentStatus = "paid";
  const canPay = po.status === "received" && po.isConsignment !== true && remainingAmount > 0;
  return { originalPayable, payableAmount, paid: paidAmount, paidAmount, remainingAmount, paymentStatus, canPay };
}

/**
 * One grouped query for all PO ids (no N+1): reference -> SUM(amount paid).
 * @returns {Promise<Map<string, number>>}
 */
async function paidByReference(models, companyId, poIds, transaction) {
  const map = new Map();
  if (!Array.isArray(poIds) || poIds.length === 0) return map;
  const rows = await models.CashTransaction.findAll({
    attributes: [
      "reference",
      "type",
      "category",
      [models.sequelize.fn("COALESCE", models.sequelize.fn("SUM", models.sequelize.col("amount")), 0), "paid"],
    ],
    where: {
      companyId,
      reference: { [Op.in]: poIds },
      [Op.or]: [
        { type: "cash_out", category: "supplier_purchase" },
        { type: "cash_in", category: "supplier_payment_reversal" },
      ],
    },
    group: ["reference", "type", "category"],
    raw: true,
    transaction,
  });
  for (const r of rows) {
    const current = map.get(r.reference) || 0;
    const amount = round2(r.paid);
    map.set(r.reference, round2(current + (r.type === "cash_in" ? -amount : amount)));
  }
  return map;
}

/**
 * Posted AP is the settlement authority. It is read from the posted purchase
 * journal's semantic SUPPLIER_PAYABLE line, never from the raw 8DP PO total.
 */
async function postedPayableByReference(models, companyId, poIds, transaction) {
  const map = new Map();
  if (!Array.isArray(poIds) || poIds.length === 0) return map;
  const entries = await models.JournalEntry.findAll({
    attributes: ["id", "sourceId"],
    where: { companyId, sourceType: "purchase_order", sourceId: { [Op.in]: poIds }, status: "posted" },
    raw: true,
    transaction,
  });
  if (!entries.length) return map;
  const payableMappings = await models.BranchFinancialMapping.findAll({
    attributes: ["accountId"],
    where: { companyId, mappingType: "SUPPLIER_PAYABLE", channel: null, isActive: true },
    raw: true,
    transaction,
  });
  const mappedAccountIds = payableMappings.map((mapping) => mapping.accountId).filter(Boolean);
  const lines = await models.JournalLine.findAll({
    attributes: ["journalEntryId", "credit"],
    where: {
      journalEntryId: { [Op.in]: entries.map((entry) => entry.id) },
      [Op.or]: [
        { accountCode: ACCOUNT_ROLE_CATALOG.SUPPLIER_PAYABLE.code },
        ...(mappedAccountIds.length ? [{ accountId: { [Op.in]: mappedAccountIds } }] : []),
      ],
    },
    raw: true,
    transaction,
  });
  const entryToPo = new Map(entries.map((entry) => [entry.id, entry.sourceId]));
  for (const line of lines) {
    const poId = entryToPo.get(line.journalEntryId);
    if (!poId) continue;
    map.set(poId, round2((map.get(poId) || 0) + Number(line.credit || 0)));
  }
  return map;
}

/** Read-only payment/reversal evidence for the supplier PO list. */
async function paymentHistoryByReference(models, companyId, poIds, transaction) {
  const map = new Map();
  if (!Array.isArray(poIds) || poIds.length === 0) return map;
  const rows = await models.CashTransaction.findAll({
    attributes: ["id", "amount", "account", "reference", "type", "category", "date", "description", "journalEntryId", "createdAt"],
    where: {
      companyId,
      reference: { [Op.in]: poIds },
      [Op.or]: [
        { type: "cash_out", category: "supplier_purchase" },
        { type: "cash_in", category: "supplier_payment_reversal" },
      ],
    },
    order: [["createdAt", "ASC"]],
    raw: true,
    transaction,
  });
  const originalJournalIds = rows.filter((row) => row.type === "cash_out").map((row) => row.journalEntryId).filter(Boolean);
  const reversals = originalJournalIds.length
    ? await models.JournalEntry.findAll({
      attributes: ["reversalOf"],
      where: { companyId, reversalOf: { [Op.in]: originalJournalIds } },
      raw: true,
      transaction,
    })
    : [];
  const reversed = new Set(reversals.map((row) => row.reversalOf));
  for (const row of rows) {
    const list = map.get(row.reference) || [];
    list.push({
      id: row.id,
      amount: round2(row.amount),
      account: row.account,
      reference: row.reference,
      type: row.type === "cash_in" ? "supplier_payment_reversal" : "supplier_payment",
      date: row.date,
      description: row.description,
      journalEntryId: row.journalEntryId,
      createdAt: row.createdAt,
      reversible: row.type === "cash_out" && !reversed.has(row.journalEntryId),
    });
    map.set(row.reference, list);
  }
  return map;
}

module.exports = {
  computePoPaymentState,
  paidByReference,
  postedPayableByReference,
  paymentHistoryByReference,
  round2,
  round4,
  TOL,
};
