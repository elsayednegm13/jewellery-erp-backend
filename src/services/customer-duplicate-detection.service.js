"use strict";

const { QueryTypes } = require("sequelize");
const { normalizePhone } = require("./customer-phone.service");

const MAX_CANDIDATES = 25;
const PHONE_MATCH = "EXACT_NORMALIZED_PHONE_MATCH";
const NAME_MATCH = "WEAK_NAME_MATCH";

function normalizeName(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim().toLowerCase();
}

function buildDuplicateSignals(input = {}) {
  const canonicalPhone = input.canonicalPhone ? String(input.canonicalPhone).trim() : "";
  const phone = canonicalPhone ? "" : normalizePhone(input.phone);
  const name = normalizeName(input.name);
  const signalsEvaluated = [];
  if (canonicalPhone) signalsEvaluated.push("PHONE_CANONICAL");
  else if (phone) signalsEvaluated.push("PHONE_NORMALIZED");
  if (name) signalsEvaluated.push("NAME_CASEFOLDED");
  return {
    ...(canonicalPhone ? { canonicalPhone } : {}),
    phone,
    name,
    signalsEvaluated,
  };
}

function classifyCandidate(row, signals) {
  const matchReasons = [];
  if (signals.canonicalPhone && String(row.canonicalPhone || "") === signals.canonicalPhone) {
    matchReasons.push(PHONE_MATCH);
  } else if (signals.phone && normalizePhone(row.phone) === signals.phone) {
    matchReasons.push(PHONE_MATCH);
  }
  if (signals.name && normalizeName(row.name) === signals.name) {
    matchReasons.push(NAME_MATCH);
  }

  if (matchReasons.length === 0) return { classification: "NO_MATCH", matchReasons };
  if (matchReasons.includes(PHONE_MATCH) && matchReasons.includes(NAME_MATCH)) {
    return { classification: "MULTI_SIGNAL_MATCH", matchReasons };
  }
  if (matchReasons.includes(PHONE_MATCH)) {
    return { classification: PHONE_MATCH, matchReasons };
  }
  return { classification: NAME_MATCH, matchReasons };
}

function parseBranchRelationships(value) {
  let rows = value;
  if (typeof rows === "string") {
    try {
      rows = JSON.parse(rows);
    } catch {
      rows = [];
    }
  }
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row) => row && typeof row === "object" && row.branchId)
    .map((row) => ({ branchId: String(row.branchId), isActive: Boolean(row.isActive) }));
}

function toMinimizedCandidate(row, signals) {
  const { classification, matchReasons } = classifyCandidate(row, signals);
  return {
    candidateCustomerId: String(row.id),
    name: String(row.name || ""),
    phone: String(row.phone || ""),
    email: row.email ? String(row.email) : null,
    status: row.status || null,
    tier: row.tier || null,
    branchRelationships: parseBranchRelationships(row.branchRelationships),
    classification,
    matchReasons,
  };
}

async function findPotentialDuplicates({ models, companyId, input = {}, excludeCustomerId = null }) {
  const signals = buildDuplicateSignals(input);
  if (!companyId || signals.signalsEvaluated.length === 0) {
    return { candidates: [], hardDuplicateCandidates: [], signalsEvaluated: signals.signalsEvaluated };
  }

  const predicates = [];
  const replacements = { companyId };
  const exclusion = excludeCustomerId ? "AND c.id <> :excludeCustomerId" : "";
  if (excludeCustomerId) replacements.excludeCustomerId = String(excludeCustomerId);
  if (signals.canonicalPhone) {
    predicates.push("c.canonical_phone = :canonicalPhone");
    replacements.canonicalPhone = signals.canonicalPhone;
  } else if (signals.phone) {
    // Compatibility branch for old callers/tests only. All current customer
    // create/update/duplicate-check production callers pass canonicalPhone.
    predicates.push("ltrim(regexp_replace(c.phone, '[^0-9]', '', 'g'), '0') = :normalizedPhone");
    replacements.normalizedPhone = signals.phone;
  }
  if (signals.name) {
    predicates.push("lower(btrim(c.name)) = :normalizedName");
    replacements.normalizedName = signals.name;
  }

  const rows = await models.sequelize.query(`
    SELECT
      c.id,
      c.name,
      c.phone,
      c.canonical_phone AS "canonicalPhone",
      c.email,
      c.status,
      c.tier,
      COALESCE(
        json_agg(
          json_build_object('branchId', bc.branch_id, 'isActive', bc.is_active)
          ORDER BY bc.branch_id
        ) FILTER (WHERE bc.id IS NOT NULL),
        '[]'::json
      ) AS "branchRelationships"
    FROM customers c
    LEFT JOIN branch_customers bc
      ON bc.customer_id = c.id
     AND bc.company_id = c.company_id
    WHERE c.company_id = :companyId
      AND c.deleted_at IS NULL
      ${exclusion}
      AND (${predicates.join(" OR ")})
    GROUP BY c.id, c.name, c.phone, c.canonical_phone, c.email, c.status, c.tier
    ORDER BY c.id ASC
    LIMIT ${MAX_CANDIDATES}
  `, { replacements, type: QueryTypes.SELECT });

  const candidates = rows.map((row) => toMinimizedCandidate(row, signals));
  const hardDuplicateCandidates = candidates.filter((candidate) => candidate.matchReasons.includes(PHONE_MATCH));
  return { candidates, hardDuplicateCandidates, signalsEvaluated: signals.signalsEvaluated };
}

module.exports = {
  MAX_CANDIDATES,
  PHONE_MATCH,
  NAME_MATCH,
  normalizeName,
  buildDuplicateSignals,
  classifyCandidate,
  toMinimizedCandidate,
  findPotentialDuplicates,
};
