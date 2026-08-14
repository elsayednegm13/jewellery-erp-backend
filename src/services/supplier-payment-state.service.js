const { Op } = require("sequelize");

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

/**
 * Pure: derive the payment state for one PO given its already-aggregated paid sum.
 * @returns {{payableAmount:number, paidAmount:number, remainingAmount:number, paymentStatus:string, canPay:boolean}}
 */
function computePoPaymentState(po, paid = 0) {
  const payableAmount = round4(po.total);
  const paidAmount = round4(paid);
  const remainingAmount = Math.max(0, round4(payableAmount - paidAmount));
  let paymentStatus;
  if (paidAmount <= TOL) paymentStatus = "unpaid";
  else if (remainingAmount > TOL) paymentStatus = "partial";
  else paymentStatus = "paid";
  const canPay = po.status === "received" && po.isConsignment !== true && remainingAmount > TOL;
  return { payableAmount, paidAmount, remainingAmount, paymentStatus, canPay };
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
      [models.sequelize.fn("COALESCE", models.sequelize.fn("SUM", models.sequelize.col("amount")), 0), "paid"],
    ],
    where: {
      companyId,
      type: "cash_out",
      category: "supplier_purchase",
      reference: { [Op.in]: poIds },
    },
    group: ["reference"],
    raw: true,
    transaction,
  });
  for (const r of rows) map.set(r.reference, Number(r.paid) || 0);
  return map;
}

module.exports = { computePoPaymentState, paidByReference, round4, TOL };
