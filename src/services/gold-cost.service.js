/**
 * Gold cost snapshot helper — Phase 15E.
 *
 * PURE: builds the gold-cost snapshot / metadata for ONE line/asset from a
 * already-fetched per-gram price + the legacy cost the system already uses. It
 * NEVER touches the DB and NEVER changes book cost — 15E only records a snapshot
 * alongside the unchanged legacy cost. Calculation adoption (using computed cost
 * as book cost), override governance and VAT capitalisation are later phases.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const round4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;

/**
 * Phase 15G — distribute a header-level non-recoverable input VAT across lines by
 * net cost weight. Pure. The sum of the result equals inputVatAmount exactly; the
 * last eligible (net > 0) line absorbs the rounding remainder so the capitalised
 * costs reconcile to GL inventory (gross). Lines with net <= 0 get 0.
 * @returns {number[]} allocated VAT per line, aligned to lineNetCosts order.
 */
function allocateNonRecoverableVat({ lineNetCosts = [], inputVatAmount = 0 } = {}) {
  const out = lineNetCosts.map(() => 0);
  const totalNet = lineNetCosts.reduce((s, n) => s + (Number(n) || 0), 0);
  const vat = Number(inputVatAmount) || 0;
  if (totalNet <= 0 || vat <= 0) return out;
  let lastIdx = -1;
  for (let i = 0; i < lineNetCosts.length; i++) if ((Number(lineNetCosts[i]) || 0) > 0) lastIdx = i;
  let allocated = 0;
  for (let i = 0; i < lineNetCosts.length; i++) {
    const net = Number(lineNetCosts[i]) || 0;
    if (net <= 0) continue;
    if (i === lastIdx) {
      out[i] = round4(vat - allocated);
    } else {
      out[i] = round4(vat * (net / totalNet));
      allocated = round4(allocated + out[i]);
    }
  }
  return out;
}

/**
 * @param {object} o
 * @param {"manual"|"gold_center"|"hybrid"} o.goldCostSource
 * @param {number} o.weight     gold weight for this record (net or gross, resolved by caller)
 * @param {string|number|null} o.karat
 * @param {number|null} o.perGram   Gold Center price for the karat (null when unavailable)
 * @param {number|null} o.currentCost  the legacy actual cost already used by the system
 * @param {Date} [o.now]
 * @returns {object} model attributes (camelCase) for PurchaseOrderItem / Asset
 */
function buildGoldCostSnapshot({ goldCostSource = "hybrid", weight = 0, karat = null, perGram = null, currentCost = null, now = new Date() } = {}) {
  const w = Number(weight) || 0;
  const base = {
    costSource: "manual",
    costOverridden: false,
    overrideReason: null,
    overrideBy: null,
    overrideAt: null,
    goldPriceSnapshot: null,
    goldPriceSource: null,
    goldPriceKarat: null,
    goldPriceAt: null,
    computedGoldCost: null,
    netGoldWeight: w > 0 ? round2(w) : null,
    // finalPurchaseCost reflects the legacy actual cost (15E does NOT change it).
    finalPurchaseCost: currentCost != null ? round2(currentCost) : null,
  };

  if (goldCostSource === "manual") return base;

  // hybrid / gold_center: record a snapshot ONLY when price + karat + weight are
  // all available. Missing data is graceful in 15E (no enforcement / no reject).
  if (perGram != null && Number(perGram) > 0 && karat != null && karat !== "" && w > 0) {
    return {
      ...base,
      costSource: goldCostSource,
      goldPriceSnapshot: round2(perGram),
      goldPriceSource: "gold_center",
      goldPriceKarat: String(karat),
      goldPriceAt: now,
      computedGoldCost: round2(w * Number(perGram)),
    };
  }
  return base;
}

/**
 * Phase 15F — classify an explicit final-cost input as a genuine override vs an
 * adoption of the computed reference (or absent). Pure; no governance here.
 * @returns {{ provided:boolean, invalid:boolean, value:number|null, isOverride:boolean }}
 */
function classifyOverride({ overrideInput, computedGoldCost, tol = 0.01 } = {}) {
  if (overrideInput === undefined || overrideInput === null || overrideInput === "") {
    return { provided: false, invalid: false, value: null, isOverride: false };
  }
  const value = Number(overrideInput);
  if (!Number.isFinite(value) || value < 0) {
    return { provided: true, invalid: true, value: null, isOverride: false };
  }
  // Adoption: the chosen final equals the computed reference → NOT an override.
  const adoptsComputed = computedGoldCost != null && Math.abs(value - Number(computedGoldCost)) <= tol;
  return { provided: true, invalid: false, value: round2(value), isOverride: !adoptsComputed };
}

/**
 * Phase 15F — apply a (validated) override/adoption onto a 15E snapshot. Pure:
 * sets finalPurchaseCost + override metadata; NEVER touches computedGoldCost.
 */
function applyOverride(snapshot, { value, isOverride, reason = null, by = null, at = new Date() } = {}) {
  const out = { ...snapshot, finalPurchaseCost: round2(value) };
  if (isOverride) {
    out.costOverridden = true;
    out.overrideReason = reason;
    out.overrideBy = by;
    out.overrideAt = at;
  } else {
    out.costOverridden = false;
    out.overrideReason = null;
    out.overrideBy = null;
    out.overrideAt = null;
  }
  return out;
}

module.exports = { buildGoldCostSnapshot, classifyOverride, applyOverride, allocateNonRecoverableVat, round2, round4 };
