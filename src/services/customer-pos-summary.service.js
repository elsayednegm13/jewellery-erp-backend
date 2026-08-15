"use strict";

const customerCreditService = require("./customer-credit.service");
const { resolvePrimaryAddress } = require("./customer-address.service");

function plain(value) {
  return value && typeof value.toJSON === "function" ? value.toJSON() : value;
}

/**
 * Read-only POS projection for one already branch-authorized Customer.
 * Customer Credit remains owned by the canonical customer-credit service;
 * purchases and loyalty remain Customer's stored read-model fields.
 */
async function getCustomerPosSummary({ models, companyId, customer }) {
  const item = plain(customer);
  const credit = await customerCreditService.getCustomerCreditSummary({
    models,
    companyId,
    customerId: item.id,
    recentLimit: 0,
  });
  const primary = resolvePrimaryAddress(item.addresses);

  return {
    id: item.id,
    name: item.name,
    status: item.status,
    tier: item.tier,
    phone: item.phone,
    primaryAddress: primary.primaryAddress,
    loyaltyPoints: Number(item.loyaltyPoints || 0),
    availableCredit: credit.availableCredit,
    totalPurchases: Number(item.purchases || 0),
    currency: credit.currency,
    meta: {
      source: "customer_pos_summary_read_model",
      primaryAddressSource: primary.source,
      availableCreditSource: "customer_credit_ledger",
      totalPurchasesSource: "customers.purchases",
      readOnly: true,
    },
  };
}

module.exports = { getCustomerPosSummary };
