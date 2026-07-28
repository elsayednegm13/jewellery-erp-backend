"use strict";

const { Op } = require("sequelize");
const { FINAL_SALE_ROLE_DEFINITIONS } = require("./company-bootstrap.service");

const STATES = Object.freeze({
  UNINITIALIZED: "UNINITIALIZED",
  SETUP_REQUIRED: "SETUP_REQUIRED",
  SETUP_IN_PROGRESS: "SETUP_IN_PROGRESS",
  READY: "READY",
  RECOVERY_REQUIRED: "RECOVERY_REQUIRED",
  CONFIGURATION_CONFLICT: "CONFIGURATION_CONFLICT"
});
const GLOBAL_SETUP_ID = "GLOBAL";

function publicStatus(state) {
  const action = state === STATES.SETUP_REQUIRED ? "SETUP"
    : state === STATES.READY ? "LOGIN"
      : state === STATES.SETUP_IN_PROGRESS ? "WAIT"
        : "CONTACT_ADMIN";
  return { state, action };
}

/** Derive a non-enumerating, server-authoritative first-run state. */
async function resolveSetupState(models, { transaction = null, lock = false } = {}) {
  const readOpts = { transaction };
  // PostgreSQL does not permit FOR UPDATE on aggregate COUNT queries. The
  // bootstrap service already owns the transaction-scoped advisory lock; this
  // optional row lock is therefore limited to the durable singleton marker.
  const markerOpts = lock && transaction ? { ...readOpts, lock: transaction.LOCK.UPDATE } : readOpts;
  const [marker, companyCount, activeSuperAdminCount] = await Promise.all([
    models.FirstRunSetupState.findByPk(GLOBAL_SETUP_ID, markerOpts),
    models.Company.count(readOpts),
    models.User.count({ where: { accountType: "super_admin", isActive: true }, ...readOpts })
  ]);

  if (companyCount > 1) return { state: STATES.CONFIGURATION_CONFLICT, marker };
  if (marker?.state === STATES.SETUP_IN_PROGRESS) return { state: STATES.SETUP_IN_PROGRESS, marker };
  if (companyCount === 0 && activeSuperAdminCount === 0 && !marker) return { state: STATES.SETUP_REQUIRED, marker: null };
  if (companyCount === 0 || activeSuperAdminCount === 0) return { state: STATES.RECOVERY_REQUIRED, marker };

  const company = await models.Company.findOne({ ...readOpts, order: [["createdAt", "ASC"]] });
  const branchCount = await models.Branch.count({ where: { companyId: company.id, isActive: true }, ...readOpts });
  if (branchCount < 1) return { state: STATES.RECOVERY_REQUIRED, marker };
  const branch = await models.Branch.findOne({ where: { companyId: company.id, isActive: true }, ...readOpts, order: [["createdAt", "ASC"]] });
  const [financialRoleCount, branchFinancialMappingCount] = await Promise.all([
    models.SystemAccountRole.count({
    where: { companyId: company.id, branchId: branch.id, roleCode: { [Op.in]: Object.values(FINAL_SALE_ROLE_DEFINITIONS).map((entry) => entry.roleCode) } },
    ...readOpts
    }),
    models.BranchFinancialMapping.count({ where: { companyId: company.id, branchId: branch.id, isActive: true }, ...readOpts })
  ]);
  if (financialRoleCount !== Object.keys(FINAL_SALE_ROLE_DEFINITIONS).length || branchFinancialMappingCount < 2) return { state: STATES.RECOVERY_REQUIRED, marker };
  if (marker?.state !== STATES.READY) return { state: STATES.RECOVERY_REQUIRED, marker };
  return { state: STATES.READY, marker };
}

module.exports = { STATES, GLOBAL_SETUP_ID, publicStatus, resolveSetupState };
