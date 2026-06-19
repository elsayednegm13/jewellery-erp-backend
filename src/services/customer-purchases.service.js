const logger = require("../utils/logger");

/**
 * Recalculate customer's lifetime net purchases total from invoices.
 * Enforces "Option B — Net Purchases" rule:
 * purchases = sales - returns - credit notes +/- exchange net difference
 *
 * @param {object} models
 * @param {string} companyId
 * @param {string} customerId
 * @param {object} [options]
 * @param {object} [options.transaction]
 */
async function recalculateCustomerNetPurchases(models, companyId, customerId, options = {}) {
  if (!customerId) return 0;

  const invoices = await models.Invoice.findAll({
    where: {
      companyId,
      customerId
    },
    transaction: options.transaction
  });

  let netPurchases = 0;

  for (const invoice of invoices) {
    const type = String(invoice.type || "").toLowerCase();
    const status = String(invoice.status || "").toLowerCase();
    const total = Number(invoice.total) || 0;

    // Exclude cancelled/void/draft/deleted invoices
    if (["cancelled", "canceled", "void", "draft", "deleted"].includes(status)) {
      continue;
    }

    if (["return", "credit_note", "credit-note", "refund"].includes(type)) {
      // Invoices table return totals are stored as negative (e.g. -Total),
      // but let's take absolute value and subtract it to handle any representation.
      netPurchases -= Math.abs(total);
      continue;
    }

    if (type === "exchange") {
      // Exchanges represent difference (newAsset - returnedAsset) which can be positive or negative.
      netPurchases += total;
      continue;
    }

    // Default: sale / installment / deposit
    netPurchases += total;
  }

  // Ensure purchases cannot go negative, and round to 2 decimals
  netPurchases = Math.max(0, Math.round(netPurchases * 100) / 100);

  await models.Customer.update(
    { purchases: netPurchases },
    {
      where: {
        id: customerId,
        companyId
      },
      transaction: options.transaction
    }
  );

  logger.info(`[PurchasesRecalc] Customer ${customerId} net purchases updated to ${netPurchases}`);
  return netPurchases;
}

module.exports = {
  recalculateCustomerNetPurchases
};
