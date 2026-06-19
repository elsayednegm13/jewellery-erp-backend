const models = require("../models");
const logger = require("../utils/logger");

/**
 * Central company-settings service — the single source of truth for VAT,
 * currency, payment methods, installment rules, invoice numbering, etc.
 *
 * Settings are stored as key/value rows (`settings` table, value is JSONB).
 * This service loads them, coerces types, and merges over safe defaults so
 * callers never deal with raw strings or missing keys. When a default is used
 * for a missing key it is logged (debug) so we can spot mis-configured tenants.
 *
 * NOTE: no business value (VAT rate, payment methods, …) is hardcoded in any
 * consumer — they all read it from here. The defaults below are *fallbacks*
 * only, applied when a company has no row for that key yet.
 */

const DEFAULTS = {
  vatRate: 5, // percent — safe fallback only; real value comes from the settings row
  currency: "AED",
  decimalPrecision: 2,
  paymentMethods: ["cash", "card", "transfer", "split", "installment", "deposit"],
  invoicePrefix: "INV-2026",
  invoiceNumbering: "sequence",
  dateFormat: "YYYY-MM-DD",
  lowStockThreshold: 1,
  installment: {
    enabled: true,
    allowZeroDownPayment: false,
    defaultFrequency: "monthly",
    maxInstallments: 24,
    minDownPaymentPercent: 0,
  },
};

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toBool(value, fallback) {
  if (value === undefined || value === null) return fallback;
  return value === true || value === "true" || value === 1 || value === "1";
}

function parseMaybeJson(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * Load and normalize settings for a company.
 * @param {string} companyId
 * @param {object} [options]
 * @param {import('sequelize').Transaction} [options.transaction]
 * @returns {Promise<object>} normalized settings (always populated, never throws on missing keys)
 */
async function getCompanySettings(companyId, options = {}) {
  let raw = {};
  let company = null;

  try {
    const rows = await models.Setting.findAll({
      where: { companyId },
      transaction: options.transaction,
    });
    raw = rows.reduce((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {});
  } catch (err) {
    logger.error(`[Settings] Failed to load settings for company ${companyId}: ${err.message}`);
  }

  try {
    company = await models.Company.findByPk(companyId, { transaction: options.transaction });
  } catch {
    /* company lookup is best-effort; currency falls back below */
  }

  const usedDefault = [];
  const pick = (key, coerce, fallback) => {
    if (raw[key] === undefined || raw[key] === null || raw[key] === "") {
      usedDefault.push(key);
      return fallback;
    }
    return coerce ? coerce(raw[key]) : raw[key];
  };

  const installmentRaw = parseMaybeJson(raw.installment) || {};

  const settings = {
    vatRate: pick("vatRate", (v) => toNumber(v, DEFAULTS.vatRate), DEFAULTS.vatRate),
    currency: (() => {
      const { normalizeCurrencyCode } = require("../utils/currency");
      const cur = company?.currency || pick("currency", String, DEFAULTS.currency);
      return normalizeCurrencyCode(cur);
    })(),
    decimalPrecision: pick("decimalPrecision", (v) => toNumber(v, DEFAULTS.decimalPrecision), DEFAULTS.decimalPrecision),
    paymentMethods: (() => {
      const pm = parseMaybeJson(raw.paymentMethods);
      return Array.isArray(pm) && pm.length ? pm : DEFAULTS.paymentMethods;
    })(),
    invoicePrefix: pick("invoicePrefix", String, DEFAULTS.invoicePrefix),
    invoiceNumbering: pick("invoiceNumbering", String, DEFAULTS.invoiceNumbering),
    dateFormat: pick("dateFormat", String, DEFAULTS.dateFormat),
    lowStockThreshold: pick("lowStockThreshold", (v) => toNumber(v, DEFAULTS.lowStockThreshold), DEFAULTS.lowStockThreshold),
    receipt: parseMaybeJson(raw.receipt) || null,
    installment: {
      // Prefer flat keys (how the settings page saves them) then nested object then default.
      enabled: toBool(
        raw.installmentEnabled !== undefined ? raw.installmentEnabled : installmentRaw.enabled,
        DEFAULTS.installment.enabled
      ),
      allowZeroDownPayment: toBool(
        raw.allowZeroDownPayment !== undefined ? raw.allowZeroDownPayment : installmentRaw.allowZeroDownPayment,
        DEFAULTS.installment.allowZeroDownPayment
      ),
      defaultFrequency:
        (raw.installmentDefaultFrequency || installmentRaw.defaultFrequency || DEFAULTS.installment.defaultFrequency),
      maxInstallments: toNumber(
        raw.installmentMaxCount !== undefined ? raw.installmentMaxCount : installmentRaw.maxInstallments,
        DEFAULTS.installment.maxInstallments
      ),
      minDownPaymentPercent: toNumber(
        raw.installmentMinDownPaymentPercent !== undefined
          ? raw.installmentMinDownPaymentPercent
          : installmentRaw.minDownPaymentPercent,
        DEFAULTS.installment.minDownPaymentPercent
      ),
    },
    // keep the raw map available for any consumer needing an un-normalized key
    _raw: raw,
    company,
  };

  if (usedDefault.length) {
    logger.debug(`[Settings] company ${companyId} using defaults for: ${usedDefault.join(", ")}`);
  }

  return settings;
}

module.exports = { getCompanySettings, DEFAULTS };
