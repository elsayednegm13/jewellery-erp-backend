const Decimal = require("decimal.js");
const { ValidationError } = require("../utils/errors");

const KARAT_FACTORS = new Map([
  ["18", new Decimal("0.750000")],
  ["21", new Decimal("0.875000")],
  ["22", new Decimal("0.916000")],
  ["24", new Decimal("1.000000")]
]);

function decimal(value, field) {
  try {
    const result = new Decimal(value);
    if (!result.isFinite()) throw new Error("not finite");
    return result;
  } catch {
    throw new ValidationError(`${field} must be a valid decimal`, { [field]: ["invalid_decimal"] });
  }
}

function fixed(value, places) {
  return value.toDecimalPlaces(places, Decimal.ROUND_HALF_UP).toFixed(places);
}

function calculate(input = {}) {
  const karat = decimal(input.karat, "karat");
  const karatKey = karat.toString();
  const expectedPurity = KARAT_FACTORS.get(karatKey);
  if (!expectedPurity) throw new ValidationError("Unsupported karat", { karat: ["unsupported_karat"] });

  const purity = decimal(input.purityFactor ?? input.fineness, "purityFactor");
  if (purity.lte(0) || purity.gt(1)) throw new ValidationError("Purity factor must be greater than zero and at most one", { purityFactor: ["out_of_range"] });
  if (!purity.eq(expectedPurity)) throw new ValidationError("Karat and purity factor are inconsistent", { purityFactor: ["karat_mismatch"] });

  const fineness = decimal(input.fineness ?? purity, "fineness");
  const normalizedFineness = fineness.gt(1) ? fineness.div(1000) : fineness;
  if (!normalizedFineness.eq(purity)) throw new ValidationError("Fineness and purity factor are inconsistent", { fineness: ["purity_mismatch"] });

  const gross = decimal(input.grossWeight, "grossWeight");
  const stone = decimal(input.stoneWeight ?? 0, "stoneWeight");
  if (gross.lte(0)) throw new ValidationError("Gross weight must be positive", { grossWeight: ["must_be_positive"] });
  if (stone.lt(0)) throw new ValidationError("Stone weight cannot be negative", { stoneWeight: ["cannot_be_negative"] });
  if (stone.gte(gross)) throw new ValidationError("Stone weight must be less than gross weight", { stoneWeight: ["must_be_less_than_gross"] });
  const net = gross.minus(stone);
  const pure = net.mul(purity);
  return {
    karat: fixed(karat, 6),
    fineness: fixed(normalizedFineness, 6),
    purityFactor: fixed(purity, 6),
    grossWeight: fixed(gross, 6),
    stoneWeight: fixed(stone, 6),
    netWeight: fixed(net, 6),
    pureGoldWeight: fixed(pure, 6)
  };
}

module.exports = { calculate, KARAT_FACTORS };
