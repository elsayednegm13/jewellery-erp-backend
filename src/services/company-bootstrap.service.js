"use strict";

const models = require("../models");
const { AppError } = require("../utils/errors");

const SYSTEM_ACCOUNT_ROLES = Object.freeze({
  CUSTOMER_DEPOSIT_LIABILITY: "CUSTOMER_DEPOSIT_LIABILITY",
});

function roleError(code, ar, en) {
  return new AppError(`${ar} | ${en}`, 422, code);
}

function depositAccountInvalid() {
  return roleError("CUSTOMER_DEPOSIT_ROLE_INVALID", "حساب دفعات العملاء المرتبط غير صالح للفرع الحالي.", "The mapped customer-deposit account is invalid for the effective branch.");
}

async function assertDepositAccount(companyId, branchId, accountId, transaction) {
  const account = await models.Account.findOne({
    where: { id: accountId, companyId, branchId, isActive: true }, transaction,
    lock: transaction ? transaction.LOCK.UPDATE : undefined,
  });
  if (!account || account.type !== "liability" || account.nature !== "credit") throw depositAccountInvalid();
  return account;
}

async function assertBranch(companyId, branchId, transaction) {
  const branch = await models.Branch.findOne({ where: { id: branchId, companyId, isActive: true }, transaction, lock: transaction ? transaction.LOCK.UPDATE : undefined });
  if (!branch) throw roleError("CUSTOMER_DEPOSIT_ROLE_NOT_CONFIGURED", "الفرع التشغيلي غير صالح أو غير نشط.", "The effective operational branch is invalid or inactive.");
  return branch;
}

async function findRoleRows(companyId, branchId, roleCode, transaction) {
  return models.SystemAccountRole.findAll({ where: { companyId, branchId, roleCode }, transaction, lock: transaction ? transaction.LOCK.UPDATE : undefined });
}

async function resolveSystemAccountRole(companyId, branchId, roleCode, transaction) {
  if (!branchId) throw roleError("CUSTOMER_DEPOSIT_ROLE_NOT_CONFIGURED", "حساب دفعات العملاء التلقائي غير مهيأ للفرع الحالي.", "The automatic customer-deposit account is not configured for the effective branch.");
  await assertBranch(companyId, branchId, transaction);
  const rows = await findRoleRows(companyId, branchId, roleCode, transaction);
  if (rows.length === 0) throw roleError("CUSTOMER_DEPOSIT_ROLE_NOT_CONFIGURED", "حساب دفعات العملاء التلقائي غير مهيأ للفرع الحالي.", "The automatic customer-deposit account is not configured for the effective branch.");
  if (rows.length !== 1) throw roleError("CUSTOMER_DEPOSIT_ROLE_DUPLICATE", "تم العثور على أكثر من ربط لحساب دفعات العملاء للفرع.", "More than one customer-deposit mapping was found for the branch.");
  if (roleCode !== SYSTEM_ACCOUNT_ROLES.CUSTOMER_DEPOSIT_LIABILITY) throw new AppError("Unsupported system account role.", 422, "SYSTEM_ACCOUNT_ROLE_UNSUPPORTED");
  return assertDepositAccount(companyId, branchId, rows[0].accountId, transaction);
}

async function legacyRole(companyId, roleCode, transaction) {
  return models.SystemAccountRole.findAll({ where: { companyId, branchId: null, roleCode }, transaction, lock: transaction ? transaction.LOCK.UPDATE : undefined });
}

async function bootstrapBranchAccounts(companyId, branchId, { transaction: providedTransaction } = {}) {
  const run = async (transaction) => {
    const report = { companyId, branchId, created: [], adopted: [], alreadyPresent: [], blockers: [], warnings: [] };
    const branch = await models.Branch.findOne({ where: { id: branchId, companyId, isActive: true }, transaction, lock: transaction.LOCK.UPDATE });
    if (!branch) { report.blockers.push({ code: "BRANCH_SCOPE_INVALID" }); return report; }
    const roleCode = SYSTEM_ACCOUNT_ROLES.CUSTOMER_DEPOSIT_LIABILITY;
    const rows = await findRoleRows(companyId, branchId, roleCode, transaction);
    if (rows.length > 1) { report.blockers.push({ code: "CUSTOMER_DEPOSIT_ROLE_DUPLICATE" }); return report; }
    if (rows.length === 1) {
      try { const account = await assertDepositAccount(companyId, branchId, rows[0].accountId, transaction); report.alreadyPresent.push({ roleCode, accountId: account.id }); }
      catch (error) { report.blockers.push({ code: error.errorCode || "CUSTOMER_DEPOSIT_ROLE_INVALID" }); }
      return report;
    }

    const activeBranches = await models.Branch.count({ where: { companyId, isActive: true }, transaction });
    const legacyRows = await legacyRole(companyId, roleCode, transaction);
    if (legacyRows.length > 1) { report.blockers.push({ code: "CUSTOMER_DEPOSIT_ROLE_DUPLICATE" }); return report; }
    if (legacyRows.length === 1) {
      if (activeBranches !== 1) { report.blockers.push({ code: "CUSTOMER_DEPOSIT_ROLE_MANUAL_REVIEW" }); return report; }
      const legacyAccount = await models.Account.findOne({ where: { id: legacyRows[0].accountId, companyId, isActive: true }, transaction, lock: transaction.LOCK.UPDATE });
      if (!legacyAccount || legacyAccount.type !== "liability" || legacyAccount.nature !== "credit") { report.blockers.push({ code: "CUSTOMER_DEPOSIT_ROLE_INVALID" }); return report; }
      await legacyAccount.update({ branchId }, { transaction });
      await legacyRows[0].update({ branchId, updatedBy: "branch-bootstrap" }, { transaction });
      report.adopted.push({ roleCode, accountId: legacyAccount.id, branchId });
      return report;
    }

    const accountId = `ACC-${companyId}-${branchId}-CUSTOMER-DEPOSIT-LIABILITY`;
    const account = await models.Account.create({
      id: accountId, companyId, branchId, code: `SYS-CUSTOMER-DEPOSIT-${branch.code}`,
      name: `Customer Deposit Liability — ${branch.name}`, nameAr: `التزامات دفعات العملاء — ${branch.name}`,
      type: "liability", nature: "credit", balance: 0, isActive: true, level: 1,
    }, { transaction });
    await models.SystemAccountRole.create({
      id: `SAR-${companyId}-${branchId}-CUSTOMER-DEPOSIT-LIABILITY`, companyId, branchId, roleCode,
      accountId: account.id, createdBy: "branch-bootstrap", updatedBy: "branch-bootstrap",
    }, { transaction });
    report.created.push({ roleCode, accountId: account.id, branchId });
    return report;
  };
  return providedTransaction ? run(providedTransaction) : models.sequelize.transaction(run);
}

async function branchReadiness(companyId, branchId) {
  try {
    const account = await resolveSystemAccountRole(companyId, branchId, SYSTEM_ACCOUNT_ROLES.CUSTOMER_DEPOSIT_LIABILITY);
    const manualReview = await models.Reservation.count({ where: { companyId, branchId: null } });
    return { companyId, branchId, status: manualReview ? "MANUAL_REVIEW" : "READY", accountId: account.id, blockers: manualReview ? [{ code: "HISTORICAL_BRANCH_ATTRIBUTION_MANUAL_REVIEW", count: manualReview }] : [] };
  } catch (error) {
    return { companyId, branchId, status: "BLOCKED", accountId: null, blockers: [{ code: error.errorCode || "CUSTOMER_DEPOSIT_ROLE_NOT_CONFIGURED" }] };
  }
}

async function branchReadinessReport(companyId) {
  const branches = await models.Branch.findAll({ where: { companyId, isActive: true }, attributes: ["id", "name", "code"] });
  const records = await Promise.all(branches.map(async (branch) => ({ branch: branch.toJSON(), ...(await branchReadiness(companyId, branch.id)) })));
  const historical = {
    branchlessAssets: await models.Asset.count({ where: { companyId, branchId: null } }),
    branchlessReservations: await models.Reservation.count({ where: { companyId, branchId: null } }),
    branchlessInvoices: await models.Invoice.count({ where: { companyId, branchId: null } }),
    branchlessJournals: await models.JournalEntry.count({ where: { companyId, branchId: null } }),
  };
  return { companyId, branches: records, historical, classification: "AMBIGUOUS_MANUAL_REVIEW" };
}

module.exports = { SYSTEM_ACCOUNT_ROLES, bootstrapBranchAccounts, resolveSystemAccountRole, branchReadiness, branchReadinessReport };
