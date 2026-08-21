"use strict";

/**
 * Gold Sale Pricing Service — the SINGLE canonical server-side pricing authority
 * for gold Asset sales.
 *
 * Supported profiles:
 *   - GOLD_BY_WEIGHT_JEWELLERY : net_gold_weight × gold_rate + net_gold_weight × making_rate
 *   - GOLD_BAR_24K             : weight × gold_rate + certificate amount; VAT on cert only
 *   - GOLD_BY_PIECE            : current_total_cost × (1 + markup%/100) with max-discount rule
 *
 * Design:
 *   - Uses Decimal.js for exact arithmetic (no floating-point rounding issues).
 *   - Reuses the VAT resolver from gold-valuation.service.js (no second resolver).
 *   - Returns an immutable pricing breakdown including approval-required flags.
 *   - Does NOT mutate any data — pure computation.
 *
 * GOLD_BY_PIECE source authority: Gold By Piece.docx Section 5 — Sales Information
 *   SOURCE FIELD            → CANONICAL INPUT                 → SERVER FORMULA
 *   current_total_cost      → asset_current_valuations.total_value → cost basis
 *   markup_percentage(%)    → itemInput.markupPercent OR asset_pricing_policies.markup_percent
 *                           → Markup Value = currentTotalCost × (markupPercent / 100)
 *   total_selling_price     → server-calculated                → currentTotalCost + markupValue
 *   max_discount_percent    → itemInput.maximumDiscountPercent OR pricing_policies.maximum_discount_percent
 *                           → MaxAllowedDiscount = totalSellingPrice × (maxDiscountPercent / 100)
 *   min_allowed_selling_price → server-calculated             → totalSellingPrice − maxAllowedDiscount
 *   proposed_discount       → itemInput.proposedDiscount OR itemInput.discount
 *                           → final_sale_price = totalSellingPrice − proposedDiscount
 *   vat                     → configured VAT rate             → final_sale_price × vatRate / 100
 *   approval_required       → server validation               → proposedDiscount > maxAllowedDiscount
 *                                                                OR finalSalePrice < minAllowedPrice
 */

const Decimal = require("decimal.js");
const goldValuationService = require("./gold-valuation.service");
const goldCenterReferencePriceService = require("./gold-center-reference-price.service");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function decimal(value, field, { required = false, min = 0 } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new Error(`GOLD_SALE_PRICING_${field}_REQUIRED`);
    return null;
  }
  let parsed;
  try { parsed = new Decimal(String(value)); } catch { throw new Error(`GOLD_SALE_PRICING_${field}_INVALID`); }
  if (!parsed.isFinite() || parsed.lt(min)) throw new Error(`GOLD_SALE_PRICING_${field}_INVALID`);
  return parsed;
}

function fixed(value) {
  return new Decimal(value).toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toFixed(8);
}

function fixed4(value) {
  return new Decimal(value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}

function calculateMakingChargeTotal({ itemWeightGrams, makingChargePerGram }) {
  const weight = decimal(itemWeightGrams, "ITEM_WEIGHT_GRAMS", { required: true, min: 0 });
  const rate = decimal(makingChargePerGram, "MAKING_CHARGE_PER_GRAM", { required: true, min: 0 });
  return fixed(weight.times(rate));
}

function calculateGoldByWeightMakingTotal({ netGoldWeight, makingChargePerGram }) {
  const weight = decimal(netGoldWeight, "NET_GOLD_WEIGHT", { required: true, min: 0 });
  const rate = decimal(makingChargePerGram, "MAKING_CHARGE_PER_GRAM", { required: true, min: 0 });
  return fixed(weight.times(rate));
}

// ─── VAT Rate Resolution ────────────────────────────────────────────────────
// Reuses gold-valuation.service.js canonical VAT resolver — NO second resolver.

async function resolveSaleVatRate({ requestedRate, models, companyId, transaction, required = false }) {
  let configuredRate = null;
  if (models && companyId) {
    configuredRate = await goldValuationService.resolveConfiguredVatRate({ models, companyId, transaction });
  }
  // Use the same resolveVatRate from gold-valuation — imported indirectly through
  // the module's own resolution logic. Re-implement the same resolver inline to
  // avoid exposing a private function, but same logic:
  const manual = decimal(requestedRate, "VAT_RATE", { min: 0 });
  if (manual !== null) return Object.freeze({ rate: fixed(manual), source: "MANUAL" });
  if (configuredRate !== undefined && configuredRate !== null && configuredRate !== "") {
    return Object.freeze({ rate: configuredRate, source: "SETTINGS_DEFAULT" });
  }
  if (required) throw new Error("GOLD_SALE_PRICING_VAT_RATE_NOT_CONFIGURED");
  return Object.freeze({ rate: "0.00000000", source: "NOT_APPLICABLE" });
}

// ─── Gold By Weight Jewellery Sale Pricing ──────────────────────────────────

/**
 * Calculate server-authoritative sale pricing for a GOLD_BY_WEIGHT_JEWELLERY asset.
 *
 * @param {object} p
 * @param {string|number} p.netGoldWeight     Net gold weight used for gold value
 * @param {string|number} p.itemWeightGrams   Trusted physical gross weight for display/audit
 * @param {string|number} p.makingWeightGrams Making basis; defaults to net gold weight
 * @param {string|number} p.sellingGoldRate   Gold rate per gram used for sale
 * @param {string|number} p.makingChargePerGram  Making charge per gram for sale
 * @param {string|number|null} p.minimumMakingPerGram  Minimum allowed making per gram (from asset config)
 * @param {string|number|null} p.vatRate      Explicit VAT rate (for weight jewellery, VAT on gold+making)
 * @param {string|null} p.configuredVatRate   Fallback configured VAT rate from settings
 * @returns {object} Frozen pricing breakdown
 */
function calculateGoldByWeightSalePrice({
  netGoldWeight,
  itemWeightGrams = netGoldWeight,
  makingWeightGrams = netGoldWeight,
  sellingGoldRate,
  makingChargePerGram,
  minimumMakingPerGram = null,
  vatRate = null,
  configuredVatRate = null,
}) {
  const weight = decimal(netGoldWeight, "NET_GOLD_WEIGHT", { required: true, min: 0 });
  const physicalWeight = decimal(itemWeightGrams, "ITEM_WEIGHT_GRAMS", { required: true, min: 0 });
  const makingWeight = decimal(makingWeightGrams, "MAKING_WEIGHT_GRAMS", { required: true, min: 0 });
  const goldRate = decimal(sellingGoldRate, "SELLING_GOLD_RATE", { required: true, min: 0 });
  const makingRate = decimal(makingChargePerGram, "MAKING_CHARGE_PER_GRAM", { required: true, min: 0 });
  const minMaking = decimal(minimumMakingPerGram, "MINIMUM_MAKING_PER_GRAM", { min: 0 });

  const goldValue = weight.times(goldRate);
  const makingTotal = new Decimal(calculateGoldByWeightMakingTotal({
    netGoldWeight: makingWeight,
    makingChargePerGram: makingRate,
  }));
  const subtotal = goldValue.plus(makingTotal);

  // VAT resolution — for weight jewellery, VAT is on the full subtotal (gold + making)
  const manual = decimal(vatRate, "VAT_RATE", { min: 0 });
  let resolvedVatRate, vatSource;
  if (manual !== null) {
    resolvedVatRate = manual;
    vatSource = "MANUAL";
  } else if (configuredVatRate !== undefined && configuredVatRate !== null && configuredVatRate !== "") {
    resolvedVatRate = new Decimal(String(configuredVatRate));
    vatSource = "SETTINGS_DEFAULT";
  } else {
    resolvedVatRate = new Decimal(0);
    vatSource = "NOT_APPLICABLE";
  }

  const vatBase = subtotal;
  const vatAmount = subtotal.times(resolvedVatRate).div(100);
  const total = subtotal.plus(vatAmount);

  // Approval check: below minimum making
  const approvalRequired = Boolean(minMaking && makingRate.lt(minMaking));

  return Object.freeze({
    profile: "GOLD_BY_WEIGHT_JEWELLERY",
    netGoldWeight: fixed(weight),
    itemWeightGrams: fixed(physicalWeight),
    sellingGoldRate: fixed(goldRate),
    goldValue: fixed(goldValue),
    makingChargePerGram: fixed(makingRate),
    makingTotal: fixed(makingTotal),
    minimumMakingPerGram: minMaking ? fixed(minMaking) : null,
    subtotal: fixed(subtotal),
    vatRate: fixed(resolvedVatRate),
    vatRateSource: vatSource,
    vatBase: fixed(vatBase),
    vatAmount: fixed(vatAmount),
    total: fixed(total),
    // Financial posting fields (DECIMAL(15,4) compatible)
    invoiceSubtotal: fixed4(subtotal),
    invoiceTax: fixed4(vatAmount),
    invoiceTotal: fixed4(total),
    invoicePrice: fixed4(subtotal),  // per-line price = goldValue + makingTotal
    approvalRequired,
    approvalReason: approvalRequired
      ? `Making charge per gram (${fixed(makingRate)}) is below minimum (${fixed(minMaking)})`
      : null,
  });
}

// ─── Gold Bar 24K Sale Pricing ──────────────────────────────────────────────

/**
 * Calculate server-authoritative sale pricing for a GOLD_BAR_24K asset.
 *
 * Key rule: VAT applies ONLY to the certificate amount, NOT to gold value.
 *
 * @param {object} p
 * @param {string|number} p.netGoldWeight        Net gold weight of the bar
 * @param {string|number} p.sellingGoldRate       Gold rate per gram for sale
 * @param {string|number} p.certificateSaleAmount Certificate charge to customer
 * @param {string|number|null} p.minimumCertificateCharge Minimum allowed certificate charge
 * @param {string|number|null} p.vatRate          Explicit VAT rate (applied to certificate ONLY)
 * @param {string|null} p.configuredVatRate       Fallback configured VAT rate from settings
 * @returns {object} Frozen pricing breakdown
 */
function calculateGoldBar24KSalePrice({
  netGoldWeight,
  sellingGoldRate,
  certificateSaleAmount,
  minimumCertificateCharge = null,
  vatRate = null,
  configuredVatRate = null,
}) {
  const weight = decimal(netGoldWeight, "NET_GOLD_WEIGHT", { required: true, min: 0 });
  const goldRate = decimal(sellingGoldRate, "SELLING_GOLD_RATE", { required: true, min: 0 });
  const certAmount = decimal(certificateSaleAmount, "CERTIFICATE_SALE_AMOUNT", { required: true, min: 0 });
  const minCert = decimal(minimumCertificateCharge, "MINIMUM_CERTIFICATE_CHARGE", { min: 0 });

  const goldValue = weight.times(goldRate);

  // VAT resolution — for 24K, VAT is on CERTIFICATE ONLY
  const manual = decimal(vatRate, "VAT_RATE", { min: 0 });
  let resolvedVatRate, vatSource;
  if (manual !== null) {
    resolvedVatRate = manual;
    vatSource = "MANUAL";
  } else if (configuredVatRate !== undefined && configuredVatRate !== null && configuredVatRate !== "") {
    resolvedVatRate = new Decimal(String(configuredVatRate));
    vatSource = "SETTINGS_DEFAULT";
  } else {
    // A missing retail certificate charge is a valid zero-charge policy. In
    // that case there is no taxable certificate base, so VAT is not required;
    // if a certificate charge is later configured, fail closed instead.
    if (certAmount.isZero()) {
      resolvedVatRate = new Decimal(0);
      vatSource = "NOT_APPLICABLE";
    } else {
      throw new Error("GOLD_SALE_PRICING_VAT_RATE_NOT_CONFIGURED");
    }
  }

  // Gold VAT = 0 (enforced by design)
  const goldVat = new Decimal(0);
  // Certificate VAT = certificate amount × VAT rate
  const certificateVat = certAmount.times(resolvedVatRate).div(100);

  // Subtotal = goldValue + certificateAmount (pre-tax)
  const subtotal = goldValue.plus(certAmount);
  // Total = goldValue + certificateAmount + certificateVAT
  const total = goldValue.plus(certAmount).plus(certificateVat);

  // Approval check: below minimum certificate charge
  const approvalRequired = Boolean(minCert && certAmount.lt(minCert));

  return Object.freeze({
    profile: "GOLD_BAR_24K",
    netGoldWeight: fixed(weight),
    sellingGoldRate: fixed(goldRate),
    goldValue: fixed(goldValue),
    goldVat: "0.00000000",  // ALWAYS 0 — gold is not taxed for 24K
    certificateSaleAmount: fixed(certAmount),
    minimumCertificateCharge: minCert ? fixed(minCert) : null,
    certificateVat: fixed(certificateVat),
    vatRate: fixed(resolvedVatRate),
    vatRateSource: vatSource,
    vatBase: fixed(certAmount),  // VAT base = certificate amount ONLY
    vatAmount: fixed(certificateVat),
    subtotal: fixed(subtotal),
    total: fixed(total),
    // Financial posting fields (DECIMAL(15,4) compatible)
    invoiceSubtotal: fixed4(subtotal),
    invoiceTax: fixed4(certificateVat),
    invoiceTotal: fixed4(total),
    invoicePrice: fixed4(subtotal),  // per-line price = gold + certificate (pre-tax)
    approvalRequired,
    approvalReason: approvalRequired
      ? `Certificate charge (${fixed(certAmount)}) is below minimum (${fixed(minCert)})`
      : null,
  });
}

// ─── Gold By Piece Sale Pricing ─────────────────────────────────────────────

/**
 * Calculate server-authoritative sale pricing for a GOLD_BY_PIECE asset.
 *
 * Source authority: Gold By Piece.docx Section 5 — Sales Information
 *
 * Formulas (verbatim from source):
 *   Markup Value           = Current Total Cost × (Markup Percentage / 100)
 *   Total Selling Price    = Current Total Cost + Markup Value
 *   Max Allowed Discount   = Total Selling Price × (Max Discount Percentage / 100)
 *   Min Allowed Selling Price = Total Selling Price − Max Allowed Discount
 *   Final Sale Price (pre-VAT) = Total Selling Price − Proposed Discount
 *   VAT Amount             = Final Sale Price × VAT Rate / 100
 *   Net Selling Price (incl. VAT) = Final Sale Price + VAT Amount
 *
 * Approval required when:
 *   - proposedDiscount > maxAllowedDiscount, OR
 *   - finalSalePrice < minAllowedSellingPrice
 *
 * @param {object} p
 * @param {string|number} p.currentTotalCost     Current total cost from asset_current_valuations
 * @param {string|number} p.markupPercent         Markup percentage (required, >= 0)
 * @param {string|number|null} p.maximumDiscountPercent  Max allowed discount % (optional, >= 0)
 * @param {string|number|null} p.proposedDiscount        Proposed discount amount (optional, >= 0)
 * @param {string|number|null} p.vatRate          Explicit VAT rate override
 * @param {string|null} p.configuredVatRate       Fallback configured VAT rate from settings
 * @returns {object} Frozen pricing breakdown with approvalRequired flag
 */
function calculateGoldByPieceSalePrice({
  currentTotalCost,
  markupPercent,
  maximumDiscountPercent = null,
  proposedDiscount = null,
  vatRate = null,
  configuredVatRate = null,
}) {
  // ── Inputs ──────────────────────────────────────────────────────────────────
  const cost = decimal(currentTotalCost, "CURRENT_TOTAL_COST", { required: true, min: 0 });
  const markup = decimal(markupPercent, "MARKUP_PERCENT", { required: true, min: 0 });
  const maxDiscPct = decimal(maximumDiscountPercent, "MAXIMUM_DISCOUNT_PERCENT", { min: 0 });
  const discount = decimal(proposedDiscount, "PROPOSED_DISCOUNT", { min: 0 });

  // ── Source formulas ──────────────────────────────────────────────────────────
  // Total Selling Price = Current Total Cost + Markup Value
  // (example from source: cost=1000, markup=20% → price=1200)
  const markupValue = cost.times(markup).div(100);
  const totalSellingPrice = cost.plus(markupValue);

  // Maximum Allowed Discount = Total Selling Price × (Max Discount % / 100)
  // Minimum Allowed Selling Price = Total Selling Price − Max Allowed Discount
  const maxAllowedDiscount = maxDiscPct ? totalSellingPrice.times(maxDiscPct).div(100) : new Decimal(0);
  const minAllowedSellingPrice = totalSellingPrice.minus(maxAllowedDiscount);

  // Final Sale Price (pre-VAT) = Total Selling Price − Proposed Discount
  const effectiveDiscount = discount || new Decimal(0);
  const finalSalePrice = totalSellingPrice.minus(effectiveDiscount);

  // ── VAT resolution ────────────────────────────────────────────────────────
  // For Gold By Piece, VAT applies to the final sale price (pre-VAT)
  const manualVat = decimal(vatRate, "VAT_RATE", { min: 0 });
  let resolvedVatRate, vatSource;
  if (manualVat !== null) {
    resolvedVatRate = manualVat;
    vatSource = "MANUAL";
  } else if (configuredVatRate !== undefined && configuredVatRate !== null && configuredVatRate !== "") {
    resolvedVatRate = new Decimal(String(configuredVatRate));
    vatSource = "SETTINGS_DEFAULT";
  } else {
    resolvedVatRate = new Decimal(0);
    vatSource = "NOT_APPLICABLE";
  }

  const vatAmount = finalSalePrice.times(resolvedVatRate).div(100);
  const netSellingPriceIncVat = finalSalePrice.plus(vatAmount);

  // ── Approval gate ─────────────────────────────────────────────────────────
  // Rules from source: "لا يمكن أن يكون سعر البيع أقل من الحد الأدنى المسموح به"
  //                    "أي تجاوز للحد الأقصى للخصم يتطلب صلاحية إضافية"
  let approvalRequired = false;
  let approvalReason = null;

  if (maxDiscPct && effectiveDiscount.gt(maxAllowedDiscount)) {
    approvalRequired = true;
    approvalReason = `Proposed discount (${fixed(effectiveDiscount)}) exceeds maximum allowed discount (${fixed(maxAllowedDiscount)}) for Gold By Piece asset`;
  } else if (maxDiscPct && finalSalePrice.lt(minAllowedSellingPrice)) {
    // Belt-and-suspenders: if final price is below minimum (after all discounts)
    approvalRequired = true;
    approvalReason = `Final sale price (${fixed(finalSalePrice)}) is below minimum allowed selling price (${fixed(minAllowedSellingPrice)}) for Gold By Piece asset`;
  }

  return Object.freeze({
    profile: "GOLD_BY_PIECE",
    // ── Cost basis ────────────────────────────────────────────────────────
    currentTotalCost: fixed(cost),
    // ── Markup pricing ────────────────────────────────────────────────────
    markupPercent: fixed(markup),
    markupValue: fixed(markupValue),
    totalSellingPrice: fixed(totalSellingPrice),
    // ── Discount rule ─────────────────────────────────────────────────────
    maximumDiscountPercent: maxDiscPct ? fixed(maxDiscPct) : null,
    maxAllowedDiscount: fixed(maxAllowedDiscount),
    minAllowedSellingPrice: fixed(minAllowedSellingPrice),
    proposedDiscount: fixed(effectiveDiscount),
    finalSalePrice: fixed(finalSalePrice),
    // ── VAT ───────────────────────────────────────────────────────────────
    vatRate: fixed(resolvedVatRate),
    vatRateSource: vatSource,
    vatBase: fixed(finalSalePrice),
    vatAmount: fixed(vatAmount),
    netSellingPriceIncVat: fixed(netSellingPriceIncVat),
    // ── Financial posting fields (DECIMAL(15,4) compatible) ───────────────
    // subtotal = finalSalePrice (pre-tax), matches invoice.subtotal convention
    subtotal: fixed(finalSalePrice),
    invoiceSubtotal: fixed4(finalSalePrice),
    invoiceTax: fixed4(vatAmount),
    invoiceTotal: fixed4(netSellingPriceIncVat),
    invoicePrice: fixed4(finalSalePrice), // per-line price = final pre-tax sale price
    // ── Approval ──────────────────────────────────────────────────────────
    approvalRequired,
    approvalReason,
  });
}

// Loose Gemstone and Loose Pearl use the same established markup/discount
// algebra as the canonical piece-priced sale.  The cost basis is their
// normalized current valuation, not Product quantity or a frontend total.
function calculateLooseProfileSalePrice({ profile, currentTotalCost, markupPercent = null, sellingPrice = null, maximumDiscountPercent = null, minimumSellingPrice = null, proposedDiscount = null, vatRate = null, configuredVatRate = null }) {
  const cost = decimal(currentTotalCost, "CURRENT_TOTAL_COST", { required: true, min: 0 });
  const direct = decimal(sellingPrice, "SELLING_PRICE", { min: 0 });
  let markup = decimal(markupPercent, "MARKUP_PERCENT", { min: 0 });
  if (!markup && !direct) throw new Error("LOOSE_SALE_PRICING_MARKUP_OR_SELLING_PRICE_REQUIRED");
  const list = direct || cost.times(new Decimal(1).plus(markup.div(100)));
  if (!markup) markup = list.minus(cost).div(cost.isZero() ? 1 : cost).times(100);
  const maxPct = decimal(maximumDiscountPercent, "MAXIMUM_DISCOUNT_PERCENT", { min: 0 });
  const discount = decimal(proposedDiscount, "PROPOSED_DISCOUNT", { min: 0 }) || new Decimal(0);
  const calculatedMinimum = maxPct ? list.minus(list.times(maxPct).div(100)) : list;
  const minimum = decimal(minimumSellingPrice, "MINIMUM_SELLING_PRICE", { min: 0 }) || calculatedMinimum;
  const finalPrice = list.minus(discount);
  if (finalPrice.lt(0)) throw new Error("LOOSE_SALE_PRICING_FINAL_PRICE_INVALID");
  const resolved = decimal(vatRate, "VAT_RATE", { min: 0 }) || (configuredVatRate === null || configuredVatRate === undefined ? new Decimal(0) : decimal(configuredVatRate, "SETTINGS_VAT_RATE", { required: true, min: 0 }));
  const vatAmount = finalPrice.times(resolved).div(100);
  const expectedProfit = finalPrice.minus(cost);
  const maxAllowedDiscount = maxPct ? list.times(maxPct).div(100) : null;
  const approvalRequired = finalPrice.lt(minimum) || Boolean(maxAllowedDiscount && discount.gt(maxAllowedDiscount));
  return Object.freeze({ profile, currentTotalCost: fixed(cost), markupPercent: fixed(markup), totalSellingPrice: fixed(list), maximumDiscountPercent: maxPct ? fixed(maxPct) : null, maxAllowedDiscount: maxAllowedDiscount ? fixed(maxAllowedDiscount) : null, minAllowedSellingPrice: fixed(minimum), proposedDiscount: fixed(discount), finalSalePrice: fixed(finalPrice), vatRate: fixed(resolved), vatRateSource: vatRate !== null && vatRate !== undefined ? "MANUAL" : (configuredVatRate === null || configuredVatRate === undefined ? "NOT_APPLICABLE" : "SETTINGS_DEFAULT"), vatBase: fixed(finalPrice), vatAmount: fixed(vatAmount), netSellingPriceIncVat: fixed(finalPrice.plus(vatAmount)), expectedProfit: fixed(expectedProfit), profitMarginPercent: fixed(cost.isZero() ? 0 : expectedProfit.div(cost).times(100)), subtotal: fixed(finalPrice), invoiceSubtotal: fixed4(finalPrice), invoiceTax: fixed4(vatAmount), invoiceTotal: fixed4(finalPrice.plus(vatAmount)), invoicePrice: fixed4(finalPrice), approvalRequired, approvalReason: approvalRequired ? `Loose profile final sale price is below its approved minimum for asset pricing policy` : null });
}

// ─── Unified Entry Point ────────────────────────────────────────────────────

/**
 * Calculate sale pricing for any supported gold profile.
 *
 * @param {string} profile  GOLD_BY_WEIGHT_JEWELLERY, GOLD_BAR_24K, or GOLD_BY_PIECE
 * @param {object} input    Profile-specific sale pricing inputs
 * @returns {object} Frozen pricing breakdown with approvalRequired flag
 */
function calculateGoldSalePrice(profile, input) {
  if (profile === "GOLD_BY_WEIGHT_JEWELLERY") {
    return calculateGoldByWeightSalePrice(input);
  }
  if (profile === "GOLD_BAR_24K") {
    return calculateGoldBar24KSalePrice(input);
  }
  if (profile === "GOLD_BY_PIECE") {
    return calculateGoldByPieceSalePrice(input);
  }
  throw new Error(`GOLD_SALE_PRICING_PROFILE_UNSUPPORTED:${profile}`);
}

/**
 * Check if an inventory profile is a gold sale pricing profile.
 */
function isGoldSaleProfile(profile) {
  return (
    profile === "GOLD_BY_WEIGHT_JEWELLERY" ||
    profile === "GOLD_BAR_24K" ||
    profile === "GOLD_BY_PIECE" ||
    profile === "CGP_CUSTOMER_GOLD_PURCHASE"
  );
}
function isSalePricingProfile(profile) { return isGoldSaleProfile(profile) || profile === "GEMSTONE_JEWELLERY" || profile === "LOOSE_DIAMOND" || profile === "LOOSE_GEMSTONE" || profile === "LOOSE_PEARL"; }

/**
 * Calculate sale pricing for an Asset instance by reading its persistent
 * gold_details and pricing_policies DB evidence.
 *
 * @param {object} p
 * @param {object} p.asset       Asset model instance
 * @param {object} p.models      Sequelize models
 * @param {string} p.companyId   Company ID
 * @param {object} p.transaction Sequelize transaction
 * @param {object} p.itemInput   Request body item properties
 * @param {string|number|null} [p.configuredVatRate] Settings fallback VAT rate
 * @returns {Promise<object>} Frozen pricing breakdown
 */
async function calculateGoldSalePriceForAsset({
  asset,
  models,
  companyId,
  transaction,
  itemInput = {},
  configuredVatRate = null,
}) {
  const profile = asset.inventoryProfile || asset.profile;
  if (!isSalePricingProfile(profile)) return null;

  if (profile === "GEMSTONE_JEWELLERY" || profile === "LOOSE_DIAMOND" || profile === "LOOSE_GEMSTONE" || profile === "LOOSE_PEARL") {
    const valuationRows = await models.sequelize.query("SELECT total_value FROM asset_current_valuations WHERE asset_id=:assetId", { replacements: { assetId: asset.id }, transaction, type: models.sequelize.QueryTypes.SELECT });
    const pricingRows = await models.sequelize.query("SELECT * FROM asset_pricing_policies WHERE asset_id=:assetId", { replacements: { assetId: asset.id }, transaction, type: models.sequelize.QueryTypes.SELECT });
    const valuation = valuationRows[0]; const pricing = pricingRows[0] || {};
    return calculateLooseProfileSalePrice({ profile, currentTotalCost: valuation?.total_value, markupPercent: itemInput.markupPercent ?? pricing.markup_percent, sellingPrice: itemInput.sellingPrice ?? itemInput.price ?? asset.price, maximumDiscountPercent: itemInput.maximumDiscountPercent ?? pricing.maximum_discount_percent, minimumSellingPrice: itemInput.minimumSellingPrice ?? pricing.minimum_selling_price, proposedDiscount: itemInput.proposedDiscount ?? itemInput.discount, vatRate: itemInput.vatRate ?? null, configuredVatRate });
  }

  const [goldDetailsRows] = await models.sequelize.query(
    "SELECT * FROM asset_gold_details WHERE asset_id=:assetId",
    { replacements: { assetId: asset.id }, transaction, type: models.sequelize.QueryTypes.SELECT }
  );
  const goldDetails = goldDetailsRows || null;

  const [pricingPolicyRows] = await models.sequelize.query(
    "SELECT * FROM asset_pricing_policies WHERE asset_id=:assetId",
    { replacements: { assetId: asset.id }, transaction, type: models.sequelize.QueryTypes.SELECT }
  );
  const pricingPolicy = pricingPolicyRows || null;

  const vatRate = itemInput.vatRate !== undefined && itemInput.vatRate !== null ? itemInput.vatRate : null;

  // ── GOLD_BY_PIECE: source-backed markup/discount pricing ─────────────────
  if (profile === "GOLD_BY_PIECE") {
    // Current Total Cost comes from asset_current_valuations.total_value
    // (the persistent normalized valuation row, not metadata)
    const valuationRows = await models.sequelize.query(
      "SELECT total_value FROM asset_current_valuations WHERE asset_id=:assetId",
      { replacements: { assetId: asset.id }, transaction, type: models.sequelize.QueryTypes.SELECT }
    );
    const currentTotalCost =
      valuationRows[0]?.total_value ??
      asset.purchaseCost ??
      asset.cost ??
      itemInput.currentTotalCost;
    if (currentTotalCost === undefined || currentTotalCost === null || Number(currentTotalCost) < 0) {
      throw new Error("GOLD_SALE_PRICING_CURRENT_TOTAL_COST_REQUIRED");
    }
    // Markup %: from itemInput (sale-time) or persisted pricing policy
    const markupPercent =
      itemInput.markupPercent ??
      itemInput.markup_percent ??
      pricingPolicy?.markup_percent;
    if (markupPercent === undefined || markupPercent === null || markupPercent === "") {
      throw new Error("GOLD_SALE_PRICING_MARKUP_PERCENT_REQUIRED");
    }
    // Max Discount %: optional — from itemInput or pricing policy
    const maximumDiscountPercent =
      itemInput.maximumDiscountPercent ??
      itemInput.maximum_discount_percent ??
      pricingPolicy?.maximum_discount_percent ??
      null;
    // Proposed discount amount: from itemInput (the actual discount given to customer)
    const proposedDiscount =
      itemInput.proposedDiscount ??
      itemInput.discount ??
      null;

    return calculateGoldByPieceSalePrice({
      currentTotalCost,
      markupPercent,
      maximumDiscountPercent,
      proposedDiscount,
      vatRate,
      configuredVatRate,
    });
  }

  // ── GOLD_BY_WEIGHT_JEWELLERY / GOLD_BAR_24K: weight-based pricing ─────────
  const netGoldWeight = goldDetails?.net_gold_weight ?? asset.netGoldWeight ?? asset.grossWeight ?? itemInput.weight ?? itemInput.netGoldWeight;
  const itemWeightGrams = asset.grossWeight ?? asset.currentWeight ?? asset.netWeight ?? itemInput.itemWeightGrams ?? itemInput.weight;
  if (netGoldWeight === undefined || netGoldWeight === null || Number(netGoldWeight) <= 0) {
    throw new Error("GOLD_SALE_PRICING_NET_GOLD_WEIGHT_REQUIRED");
  }

  const explicitSellingGoldRate = itemInput.sellingGoldRate ?? itemInput.goldRate ?? itemInput.pricePerGram;
  // POS historically submitted the Asset's persisted sale price rather than
  // a separate per-gram gold rate. Preserve that request contract without
  // trusting client totals: derive the compatibility rate from the server
  // Asset price and canonical net weight. New callers may still provide an
  // explicit sellingGoldRate, which remains authoritative for that request.
  const sellingGoldRate = explicitSellingGoldRate === undefined || explicitSellingGoldRate === null || explicitSellingGoldRate === ""
    ? (() => {
      const legacyPrice = decimal(asset.price, "ASSET_PRICE", { required: true, min: 0 });
      const legacyWeight = decimal(netGoldWeight, "NET_GOLD_WEIGHT", { required: true, min: 0 });
      if (legacyWeight.isZero()) throw new Error("GOLD_SALE_PRICING_SELLING_GOLD_RATE_REQUIRED");
      return legacyPrice.div(legacyWeight).toFixed(8);
    })()
    : explicitSellingGoldRate;

  if (profile === "GOLD_BY_WEIGHT_JEWELLERY" || profile === "CGP_CUSTOMER_GOLD_PURCHASE") {
    // A supplier asset may have no retail-making policy yet.  In that case a
    // zero making charge is the explicit absence of a retail charge; it must
    // not fall back to acquisition cost or Asset.price.
    const makingChargePerGram = itemInput.sellingMakingPerGram ?? itemInput.makingChargePerGram ?? itemInput.makingCharge ?? pricingPolicy?.selling_making_per_gram ?? 0;
    const minimumMakingPerGram = itemInput.minimumMakingPerGram ?? pricingPolicy?.minimum_making_per_gram ?? null;

    return calculateGoldByWeightSalePrice({
      netGoldWeight,
      itemWeightGrams,
      // Gold By Weight Jewellery follows the 01B net-weight authority. CGP
      // is a separate acquisition path and retains its established basis.
      makingWeightGrams: profile === "GOLD_BY_WEIGHT_JEWELLERY" ? netGoldWeight : itemWeightGrams,
      sellingGoldRate,
      makingChargePerGram,
      minimumMakingPerGram,
      vatRate,
      configuredVatRate,
    });
  }

  if (profile === "GOLD_BAR_24K") {
    // A null certificate_charge means no retail certificate fee is configured.
    // Treat it as zero rather than reusing the supplier purchase certificate
    // cost; the purchase certificate remains acquisition-only evidence.
    const certificateSaleAmount = itemInput.certificateSaleAmount ?? itemInput.certificateCharge ?? pricingPolicy?.certificate_charge ?? 0;
    const minimumCertificateCharge = itemInput.minimumCertificateCharge ?? pricingPolicy?.minimum_certificate_charge ?? null;

    return calculateGoldBar24KSalePrice({
      netGoldWeight,
      sellingGoldRate,
      certificateSaleAmount,
      minimumCertificateCharge,
      vatRate,
      configuredVatRate,
    });
  }

  throw new Error(`GOLD_SALE_PRICING_PROFILE_UNSUPPORTED:${profile}`);
}

module.exports = {
  calculateMakingChargeTotal,
  calculateGoldByWeightMakingTotal,
  calculateGoldByWeightSalePrice,
  calculateGoldBar24KSalePrice,
  calculateGoldByPieceSalePrice,
  calculateLooseProfileSalePrice,
  calculateGoldSalePrice,
  calculateGoldSalePriceForAsset,
  resolveCanonicalSellingGoldRate,
  isGoldSaleProfile,
  isSalePricingProfile,
  resolveSaleVatRate,
};

/** Resolve one current Gold Center rate with a request-scoped cache. */
async function resolveCanonicalSellingGoldRate({ models, companyId, currency = "AED", karat, cache, transaction }) {
  const normalizedKarat = Number(karat);
  if (!Number.isInteger(normalizedKarat) || normalizedKarat <= 0 || normalizedKarat > 24) throw new Error("GOLD_SALE_PRICING_KARAT_INVALID");
  if (!models || !companyId) throw new Error("GOLD_SALE_PRICING_CONTEXT_REQUIRED");
  const normalizedCurrency = String(currency || "AED").trim().toUpperCase();
  const key = [companyId, normalizedCurrency, normalizedKarat].join(":");
  if (cache?.rates?.has(key)) return cache.rates.get(key);
  const now = new Date();
  let rows = await models.GoldPrice.findAll({
    where: { companyId, currency: normalizedCurrency, karat: normalizedKarat, approvalStatus: "APPROVED" },
    order: [["approvedAt", "DESC"], ["id", "DESC"]],
    ...(transaction ? { transaction } : {}),
  });
  // Preserve the existing Gold Center authority's compatibility fallback:
  // a company may use an approved global row, never another company's row.
  if (!rows.length) rows = await models.GoldPrice.findAll({
    where: { companyId: null, currency: normalizedCurrency, karat: normalizedKarat, approvalStatus: "APPROVED" },
    order: [["approvedAt", "DESC"], ["id", "DESC"]],
    ...(transaction ? { transaction } : {}),
  });
  const executable = rows.find((row) => (!row.validFrom || new Date(row.validFrom) <= now) && (!row.validUntil || new Date(row.validUntil) > now));
  let rate = executable ? decimal(executable.pricePerGram, "CURRENT_GOLD_RATE", { required: true, min: 0 }).toFixed(8) : null;
  if (!rate) {
    const snapshotKey = [companyId, normalizedCurrency].join(":");
    let snapshot = cache?.snapshots?.get(snapshotKey);
    if (!snapshot) {
      snapshot = await goldCenterReferencePriceService.getReferenceSnapshot(companyId, normalizedCurrency);
      if (cache?.snapshots) cache.snapshots.set(snapshotKey, snapshot);
    }
    const row = snapshot?.prices?.find((price) => Number(price.karat) === normalizedKarat);
    if (!row || !Number.isFinite(Number(row.pricePerGram)) || Number(row.pricePerGram) <= 0) {
      const error = new Error(snapshot?.warning || "GOLD_SALE_PRICING_CURRENT_GOLD_RATE_UNAVAILABLE");
      error.code = snapshot?.warning || "GOLD_SALE_PRICING_CURRENT_GOLD_RATE_UNAVAILABLE";
      throw error;
    }
    rate = decimal(row.pricePerGram, "CURRENT_GOLD_RATE", { required: true, min: 0 }).toFixed(8);
  }
  if (cache?.rates) cache.rates.set(key, rate);
  return rate;
}
