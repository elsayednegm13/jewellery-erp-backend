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
  // Phase 12E foundation — purchase VAT / RCM config. Read-only foundation: NO
  // posting consumer reads these yet (purchase-VAT posting lands in 12F).
  vatEnabled: true,
  purchaseVatRate: null, // null → falls back to vatRate (resolved below)
  purchaseTaxIncludedDefault: false,
  purchaseVatRecoverableDefault: true,
  inputVatAccountCode: "1400",
  rcmOutputAccountCode: "2210",
  // Phase 15C foundation — gold cost config. Read-only foundation: NO consumer
  // reads these yet (snapshot/calculation land in 15D/15E).
  goldCostSource: "hybrid", // manual | gold_center | hybrid
  goldCostWeightBasis: "net", // net | gross
  allowGoldCostOverride: true,
  goldCostOverridePermission: "goldCost.override",
  nonRecoverableVatCapitalization: true,
  currency: "AED",
  decimalPrecision: 2,
  paymentMethods: ["cash", "card", "transfer", "split", "installment", "deposit"],
  invoicePrefix: "INV-2026",
  invoiceNumbering: "sequence",
  dateFormat: "YYYY-MM-DD",
  lowStockThreshold: 1,
  accountingByKarat: false, // P5.1 foundation flag — split posting not enabled yet
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

  // Resolve sales vatRate first so purchaseVatRate can fall back to it.
  const vatRate = pick("vatRate", (v) => toNumber(v, DEFAULTS.vatRate), DEFAULTS.vatRate);
  const purchaseVatRate =
    raw.purchaseVatRate === undefined || raw.purchaseVatRate === null || raw.purchaseVatRate === ""
      ? vatRate
      : toNumber(raw.purchaseVatRate, vatRate);

  const settings = {
    vatRate,
    // Phase 12E foundation — purchase VAT / RCM config (read-only; no posting
    // reads these yet). Surfaced so 12F implementation is configurable.
    vatEnabled: toBool(raw.vatEnabled, DEFAULTS.vatEnabled),
    purchaseVatRate,
    purchaseTaxIncludedDefault: toBool(raw.purchaseTaxIncludedDefault, DEFAULTS.purchaseTaxIncludedDefault),
    purchaseVatRecoverableDefault: toBool(raw.purchaseVatRecoverableDefault, DEFAULTS.purchaseVatRecoverableDefault),
    inputVatAccountCode: pick("inputVatAccountCode", String, DEFAULTS.inputVatAccountCode),
    rcmOutputAccountCode: pick("rcmOutputAccountCode", String, DEFAULTS.rcmOutputAccountCode),
    // Phase 15C foundation — gold cost config (read-only; no consumer reads
    // these yet, calculation/snapshot land in 15D/15E).
    goldCostSource: pick("goldCostSource", String, DEFAULTS.goldCostSource),
    goldCostWeightBasis: pick("goldCostWeightBasis", String, DEFAULTS.goldCostWeightBasis),
    allowGoldCostOverride: toBool(raw.allowGoldCostOverride, DEFAULTS.allowGoldCostOverride),
    goldCostOverridePermission: pick("goldCostOverridePermission", String, DEFAULTS.goldCostOverridePermission),
    nonRecoverableVatCapitalization: toBool(raw.nonRecoverableVatCapitalization, DEFAULTS.nonRecoverableVatCapitalization),
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
    // P5.1 foundation flag (default false). No posting reads it yet.
    accountingByKarat: toBool(raw.accountingByKarat, DEFAULTS.accountingByKarat),
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
