"use strict";

const { QueryTypes } = require("sequelize");
const models = require("../models");
const settingsService = require("./settings.service");
const companyTaxPolicyService = require("./company-tax-policy.service");
const financialBootstrapService = require("./financial-bootstrap.service");

const REFERENCE_DATASET_ID = "INVENTORY_REFERENCE_MASTER_DATA";

function readyCheck({ code, label, requiredFor, details = null }) {
  return { status: "READY", code, label, requiredFor, details };
}

function blockedCheck({ code, label, requiredFor, details = null }) {
  return { status: "BLOCKED", code, label, requiredFor, details };
}

function optionalCheck({ code, label, details = null }) {
  return { status: "OPTIONAL", code, label, requiredFor: "OPTIONAL", details };
}

function hasExplicitTaxPolicy(policy = {}) {
  const enabled = Array.isArray(policy.enabledTaxTreatments) ? policy.enabledTaxTreatments : [];
  return policy.vatRegistered !== null
    && policy.vatRegistered !== undefined
    && policy.vatRate !== null
    && policy.vatRate !== undefined
    && enabled.length > 0
    && policy.defaultTaxTreatment
    && enabled.includes(policy.defaultTaxTreatment)
    && policy.preciousGoodsRcmEnabled !== null
    && policy.preciousGoodsRcmEnabled !== undefined;
}

/**
 * Pure readiness authority. It deliberately receives facts rather than
 * request data so the server route cannot let a frontend payload override
 * company or branch scope.
 */
function evaluateOperationalReadinessSnapshot(snapshot, { workflow = "SUPPLIER_RECEIVE" } = {}) {
  const company = snapshot.company || {};
  const branch = snapshot.branch || null;
  const locationCount = Number(snapshot.activeLocationCount || 0);
  const supplierCount = Number(snapshot.activeSupplierCount || 0);
  const taxPolicy = snapshot.taxPolicy || {};
  const financial = snapshot.financialFoundation || {};
  const reference = snapshot.referenceMasterData || {};
  const companyIdentityReady = Boolean(company.exists && String(company.businessName || "").trim() && String(company.workspace || "").trim() && String(company.currency || "").trim());
  const referenceReady = reference.state === "READY" && Number(reference.profileCount || 0) > 0;
  const taxReady = hasExplicitTaxPolicy(taxPolicy);
  const financialReady = financial.status === "READY";
  const activeBranchReady = Boolean(branch?.id && branch.isActive !== false);
  const activeLocationReady = locationCount > 0;
  const supplierReady = supplierCount > 0;

  const checks = {
    companyIdentity: companyIdentityReady
      ? readyCheck({ code: "COMPANY_CONTEXT_READY", label: "Company context is present.", requiredFor: "SYSTEM_REQUIRED", details: { companyId: company.id, businessName: company.businessName, currency: company.currency, country: company.country || null, trnPresent: Boolean(String(company.taxNumber || "").trim()) } })
      : blockedCheck({ code: "COMPANY_CONTEXT_REQUIRED", label: "A complete company context is required.", requiredFor: "SYSTEM_REQUIRED" }),
    taxPolicy: taxReady
      ? readyCheck({ code: "TAX_POLICY_READY", label: "Company tax policy is explicitly configured.", requiredFor: "TAXABLE_SUPPLIER_RECEIVE", details: { jurisdiction: taxPolicy.jurisdiction, vatRegistered: taxPolicy.vatRegistered, vatRate: taxPolicy.vatRate, enabledTaxTreatments: taxPolicy.enabledTaxTreatments, defaultTaxTreatment: taxPolicy.defaultTaxTreatment, preciousGoodsRcmEnabled: taxPolicy.preciousGoodsRcmEnabled, trnPresent: Boolean(String(company.taxNumber || "").trim()) } })
      : blockedCheck({ code: "TAX_POLICY_UNCONFIGURED", label: "Tax policy needs explicit configuration before taxable supplier receive.", requiredFor: "TAXABLE_SUPPLIER_RECEIVE", details: { trnPresent: Boolean(String(company.taxNumber || "").trim()) } }),
    activeBranch: activeBranchReady
      ? readyCheck({ code: "ACTIVE_BRANCH_READY", label: "An active branch is available for the current company.", requiredFor: "OPERATIONAL_RECEIVE_REQUIRED", details: { branchId: branch.id, branchName: branch.name } })
      : blockedCheck({ code: "ACTIVE_BRANCH_REQUIRED", label: "An active branch is required for operational inventory work.", requiredFor: "OPERATIONAL_RECEIVE_REQUIRED" }),
    activeInventoryLocation: activeLocationReady
      ? readyCheck({ code: "ACTIVE_LOCATION_READY", label: "An active DB-backed inventory location is available in the selected branch.", requiredFor: "OPERATIONAL_RECEIVE_REQUIRED", details: { count: locationCount } })
      : blockedCheck({ code: "NO_ACTIVE_LOCATION", label: "No active inventory location exists for the selected branch.", requiredFor: "OPERATIONAL_RECEIVE_REQUIRED" }),
    supplierAvailable: supplierReady
      ? readyCheck({ code: "SUPPLIER_AVAILABLE", label: "An active supplier is available for supplier purchase receive.", requiredFor: "REQUIRED_FOR_SUPPLIER_PURCHASE", details: { count: supplierCount } })
      : blockedCheck({ code: "NO_ACTIVE_SUPPLIER", label: "No active supplier is available for supplier purchase receive.", requiredFor: "REQUIRED_FOR_SUPPLIER_PURCHASE" }),
    financialFoundation: financialReady
      ? readyCheck({ code: "FINANCIAL_FOUNDATION_READY", label: "Branch financial roles and mappings are ready.", requiredFor: "OPERATIONAL_RECEIVE_REQUIRED_IF_POSTING_IS_CANONICAL", details: { version: financial.version || null } })
      : blockedCheck({ code: "FINANCIAL_FOUNDATION_REQUIRED", label: "Financial posting roles and mappings need configuration.", requiredFor: "OPERATIONAL_RECEIVE_REQUIRED_IF_POSTING_IS_CANONICAL", details: { financial } }),
    referenceMasterData: referenceReady
      ? readyCheck({ code: "REFERENCE_MASTER_DATA_READY", label: "Reference inventory master data is initialized.", requiredFor: "SYSTEM_REQUIRED", details: { state: reference.state, profileCount: Number(reference.profileCount || 0) } })
      : blockedCheck({ code: "REFERENCE_MASTER_DATA_REQUIRED", label: "Reference inventory master data is not ready.", requiredFor: "SYSTEM_REQUIRED", details: reference }),
  };

  const systemBlockers = [];
  if (checks.companyIdentity.status === "BLOCKED") systemBlockers.push({ code: checks.companyIdentity.code, scope: "SYSTEM" });
  if (checks.referenceMasterData.status === "BLOCKED") systemBlockers.push({ code: checks.referenceMasterData.code, scope: "SYSTEM" });
  if (checks.activeBranch.status === "BLOCKED") systemBlockers.push({ code: checks.activeBranch.code, scope: "SYSTEM_CONTEXT" });

  const operationalBlockers = [];
  if (checks.referenceMasterData.status === "BLOCKED") operationalBlockers.push({ code: checks.referenceMasterData.code, scope: "SYSTEM_REQUIRED" });
  if (checks.activeBranch.status === "BLOCKED") operationalBlockers.push({ code: checks.activeBranch.code, scope: "OPERATIONAL" });
  if (checks.activeInventoryLocation.status === "BLOCKED") operationalBlockers.push({ code: checks.activeInventoryLocation.code, scope: "OPERATIONAL" });
  if (checks.financialFoundation.status === "BLOCKED") operationalBlockers.push({ code: checks.financialFoundation.code, scope: "OPERATIONAL" });
  if (workflow === "SUPPLIER_RECEIVE" && checks.supplierAvailable.status === "BLOCKED") operationalBlockers.push({ code: checks.supplierAvailable.code, scope: "SUPPLIER_PURCHASE" });
  if (workflow === "SUPPLIER_RECEIVE" && taxPolicy.vatRegistered === true && checks.taxPolicy.status === "BLOCKED") operationalBlockers.push({ code: checks.taxPolicy.code, scope: "TAXABLE_SUPPLIER_RECEIVE" });

  return {
    workflow,
    systemFirstRunReady: systemBlockers.length === 0,
    operationalReceiveReady: operationalBlockers.length === 0,
    checks,
    blockers: [...systemBlockers, ...operationalBlockers.filter((item) => !systemBlockers.some((existing) => existing.code === item.code))],
    policy: {
      companyScoped: true,
      branchAware: true,
      serverAuthoritative: true,
      readinessEvaluationWrites: 0,
      supplierRequiredOnlyForSupplierPurchase: true,
      taxRequiredOnlyForTaxableSupplierReceive: true,
    },
  };
}

async function readReferenceMasterData(companyId, transaction = null) {
  const [state, profileRows] = await Promise.all([
    models.InventoryMasterDataBootstrapState.findOne({ where: { companyId, datasetId: REFERENCE_DATASET_ID }, transaction }),
    models.sequelize.query("SELECT COUNT(*)::int AS count FROM profile_master_data WHERE company_id=:companyId AND is_active=true", { replacements: { companyId }, transaction, type: QueryTypes.SELECT }),
  ]);
  return { state: state?.state || "MISSING", profileCount: Number(profileRows[0]?.count || 0), datasetId: REFERENCE_DATASET_ID, version: state?.currentVersion || null };
}

async function getOperationalReadiness({ companyId, branchId, workflow = "SUPPLIER_RECEIVE", transaction = null }) {
  if (!companyId) throw Object.assign(new Error("A company context is required."), { statusCode: 422, errorCode: "COMPANY_CONTEXT_REQUIRED" });
  const [company, branch, settings, taxPolicy, referenceMasterData] = await Promise.all([
    models.Company.findOne({ where: { id: companyId }, transaction }),
    branchId ? models.Branch.findOne({ where: { id: branchId, companyId, isActive: true }, transaction }) : null,
    settingsService.getCompanySettings(companyId, { transaction }),
    companyTaxPolicyService.getCompanyTaxPolicy(companyId, { transaction }),
    readReferenceMasterData(companyId, transaction),
  ]);
  const [activeLocationCount, activeSupplierCount, financialFoundation] = await Promise.all([
    branch?.id ? models.InventoryLocation.count({ where: { companyId, branchId: branch.id, isActive: true }, transaction }) : 0,
    models.Supplier.count({ where: { companyId, status: "active" }, transaction }),
    branch?.id ? financialBootstrapService.evaluateReadiness({ models, companyId, branchId: branch.id, transaction }) : { status: "BLOCKED", blockers: [{ code: "FINANCIAL_CONTEXT_REQUIRED" }] },
  ]);
  const snapshot = {
    company: company ? { id: company.id, exists: true, businessName: company.businessName, workspace: company.workspace, country: company.country, currency: company.currency, taxNumber: company.taxNumber } : { exists: false },
    branch: branch ? { id: branch.id, name: branch.name, isActive: branch.isActive } : null,
    activeLocationCount,
    activeSupplierCount,
    taxPolicy,
    financialFoundation,
    referenceMasterData,
  };
  const result = evaluateOperationalReadinessSnapshot(snapshot, { workflow });
  return {
    ...result,
    company: { id: company?.id || null, businessName: company?.businessName || null, currency: settings.currency || company?.currency || null, country: company?.country || null, trnPresent: Boolean(String(company?.taxNumber || "").trim()) },
    branch: result.checks.activeBranch.details || null,
    taxPolicy: result.checks.taxPolicy.details || { configured: false },
    referenceMasterData: result.checks.referenceMasterData.details || referenceMasterData,
  };
}

module.exports = { REFERENCE_DATASET_ID, hasExplicitTaxPolicy, evaluateOperationalReadinessSnapshot, getOperationalReadiness };
