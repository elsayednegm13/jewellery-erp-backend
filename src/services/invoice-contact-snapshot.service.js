"use strict";

const { resolvePrimaryAddress } = require("./customer-address.service");

const ADDRESS_SNAPSHOT_KEYS = ["line1", "line2", "city", "country", "postalCode"];

function cleanText(value) {
  if (value === undefined || value === null || typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function projectAddress(address) {
  if (!address || typeof address !== "object") return null;
  const projected = {};
  for (const key of ADDRESS_SNAPSHOT_KEYS) {
    const value = cleanText(address[key]);
    if (value) projected[key] = value;
  }
  return Object.keys(projected).length ? projected : null;
}

function buildCustomerContactSnapshot(customer) {
  if (!customer) {
    return { customerPhoneSnapshot: null, customerAddressSnapshot: null };
  }
  const customerJson = typeof customer.toJSON === "function" ? customer.toJSON() : customer;
  const resolved = resolvePrimaryAddress(customerJson.addresses);
  return {
    customerPhoneSnapshot: cleanText(customerJson.phone),
    customerAddressSnapshot: projectAddress(resolved.primaryAddress),
  };
}

function copyInvoiceContactSnapshot(invoice) {
  if (!invoice) return { customerPhoneSnapshot: null, customerAddressSnapshot: null };
  const value = typeof invoice.toJSON === "function" ? invoice.toJSON() : invoice;
  return {
    customerPhoneSnapshot: cleanText(value.customerPhoneSnapshot),
    customerAddressSnapshot: projectAddress(value.customerAddressSnapshot),
  };
}

module.exports = {
  ADDRESS_SNAPSHOT_KEYS,
  projectAddress,
  buildCustomerContactSnapshot,
  copyInvoiceContactSnapshot,
};
