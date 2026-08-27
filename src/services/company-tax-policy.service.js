"use strict";

const models = require("../models");
const uaeTaxEngine = require("./uae-tax-engine.service");

const POLICY_SETTING_KEYS = Object.freeze([
  "vatRate",
  "vatEnabled",
  "enabledTaxTreatments",
  "defaultTaxTreatment",
  "preciousGoodsRcmEnabled",
]);

function explicitValue(rows, key) {
  const row = rows.find((candidate) => candidate.key === key);
  return row ? row.value : null;
}

async function readExplicitPolicy(companyId, options = {}) {
  const [company, rows] = await Promise.all([
    models.Company.findByPk(companyId, { transaction: options.transaction }),
    models.Setting.findAll({ where: { companyId }, transaction: options.transaction }),
  ]);
  if (!company) {
    const error = new Error("Company not found.");
    error.statusCode = 404;
    error.errorCode = "COMPANY_NOT_FOUND";
    throw error;
  }
  return { company, rows };
}

function toPolicyResponse(company, rows) {
  const policy = {
    jurisdiction: "UAE",
    vatRegistered: company.vatRegistered === undefined ? null : company.vatRegistered,
    trn: company.taxNumber || null,
    vatEnabled: explicitValue(rows, "vatEnabled"),
    vatRate: explicitValue(rows, "vatRate"),
    enabledTaxTreatments: explicitValue(rows, "enabledTaxTreatments"),
    defaultTaxTreatment: explicitValue(rows, "defaultTaxTreatment"),
    preciousGoodsRcmEnabled: explicitValue(rows, "preciousGoodsRcmEnabled"),
    ...uaeTaxEngine.getUaeTaxEngineMetadata(),
  };
  policy.configured = [
    policy.vatRegistered,
    policy.vatEnabled,
    policy.vatRate,
    policy.enabledTaxTreatments,
    policy.defaultTaxTreatment,
    policy.preciousGoodsRcmEnabled,
  ].some((value) => value !== null && value !== undefined);
  return policy;
}

async function getCompanyTaxPolicy(companyId, options = {}) {
  const { company, rows } = await readExplicitPolicy(companyId, options);
  return toPolicyResponse(company, rows);
}

function mergePatch(current, patch) {
  const merged = { ...current };
  for (const key of ["vatRegistered", ...POLICY_SETTING_KEYS]) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) merged[key] = patch[key];
  }
  return merged;
}

async function updateCompanyTaxPolicy({ companyId, patch, transaction }) {
  const current = await getCompanyTaxPolicy(companyId, { transaction });
  const merged = mergePatch(current, patch);
  uaeTaxEngine.validateCompanyTaxPolicy(merged);

  const write = async (t) => {
    const company = await models.Company.findByPk(companyId, { transaction: t, lock: t.LOCK?.UPDATE });
    if (!company) {
      const error = new Error("Company not found.");
      error.statusCode = 404;
      error.errorCode = "COMPANY_NOT_FOUND";
      throw error;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "vatRegistered")) await company.update({ vatRegistered: patch.vatRegistered }, { transaction: t });

    for (const key of POLICY_SETTING_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
      const value = patch[key];
      const row = await models.Setting.findOne({ where: { companyId, key }, transaction: t, lock: t.LOCK?.UPDATE });
      if (value === null || value === undefined) {
        if (row) await row.destroy({ transaction: t });
      } else if (row) {
        await row.update({ value }, { transaction: t });
      } else {
        await models.Setting.create({ companyId, key, value }, { transaction: t });
      }
    }
    return { before: current, after: await getCompanyTaxPolicy(companyId, { transaction: t }) };
  };

  if (transaction) return write(transaction);
  return models.sequelize.transaction(write);
}

module.exports = {
  POLICY_SETTING_KEYS,
  getCompanyTaxPolicy,
  updateCompanyTaxPolicy,
  validateCompanyTaxPolicy: uaeTaxEngine.validateCompanyTaxPolicy,
};
