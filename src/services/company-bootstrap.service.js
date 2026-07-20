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
  return roleError(
    "CUSTOMER_DEPOSIT_ROLE_INVALID",
    "حساب دفعات العملاء المرتبط غير صالح أو لا يتبع الشركة الحالية.",
    "The mapped customer-deposit account is invalid or does not belong to the current company."
  );
}

async function assertDepositAccount(companyId, accountId, transaction) {
  const account = await models.Account.findOne({
    where: { id: accountId, companyId, isActive: true },
    transaction,
    lock: transaction ? transaction.LOCK.UPDATE : undefined,
  });
  if (!account || account.type !== "liability" || account.nature !== "credit") throw depositAccountInvalid();
  return account;
}

async function findRoleRows(companyId, roleCode, transaction) {
  return models.SystemAccountRole.findAll({
    where: { companyId, roleCode },
    transaction,
    lock: transaction ? transaction.LOCK.UPDATE : undefined,
  });
}

async function resolveSystemAccountRole(companyId, roleCode, transaction) {
  const rows = await findRoleRows(companyId, roleCode, transaction);
  if (rows.length === 0) {
    throw roleError(
      "CUSTOMER_DEPOSIT_ROLE_NOT_CONFIGURED",
      "حساب دفعات العملاء التلقائي غير مهيأ لهذه الشركة. اطلب من المسؤول تشغيل إعداد الشركة.",
      "The automatic customer-deposit account is not configured for this company. Ask an administrator to run company setup."
    );
  }
  if (rows.length !== 1) {
    throw roleError(
      "CUSTOMER_DEPOSIT_ROLE_DUPLICATE",
      "تم العثور على أكثر من ربط لحساب دفعات العملاء. لا يمكن المتابعة بأمان.",
      "More than one customer-deposit account mapping was found. Posting cannot continue safely."
    );
  }
  if (roleCode !== SYSTEM_ACCOUNT_ROLES.CUSTOMER_DEPOSIT_LIABILITY) {
    throw new AppError("Unsupported system account role.", 422, "SYSTEM_ACCOUNT_ROLE_UNSUPPORTED");
  }
  return assertDepositAccount(companyId, rows[0].accountId, transaction);
}

async function readConfiguredDepositAccount(companyId, transaction) {
  const setting = await models.Setting.findOne({
    where: { companyId, key: "reservationAdvancesAccountId" },
    transaction,
    lock: transaction ? transaction.LOCK.UPDATE : undefined,
  });
  const value = setting?.value;
  const accountId = typeof value === "string" ? value : value?.accountId || value?.id;
  return { setting, accountId: accountId ? String(accountId) : null };
}

async function bootstrapCompanyAccounts(companyId, { transaction: providedTransaction } = {}) {
  const run = async (transaction) => {
    const report = { companyId, created: [], adopted: [], alreadyPresent: [], blocking: [] };
    const company = await models.Company.findByPk(companyId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!company) {
      report.blocking.push({ code: "COMPANY_NOT_FOUND" });
      return report;
    }

    const roleCode = SYSTEM_ACCOUNT_ROLES.CUSTOMER_DEPOSIT_LIABILITY;
    const rows = await findRoleRows(companyId, roleCode, transaction);
    if (rows.length > 1) {
      report.blocking.push({ code: "CUSTOMER_DEPOSIT_ROLE_DUPLICATE" });
      return report;
    }
    if (rows.length === 1) {
      try {
        const account = await assertDepositAccount(companyId, rows[0].accountId, transaction);
        report.alreadyPresent.push({ roleCode, accountId: account.id });
        return report;
      } catch (error) {
        report.blocking.push({ code: error.errorCode || "CUSTOMER_DEPOSIT_ROLE_INVALID" });
        return report;
      }
    }

    const { setting, accountId } = await readConfiguredDepositAccount(companyId, transaction);
    if (accountId) {
      try {
        const account = await assertDepositAccount(companyId, accountId, transaction);
        await models.SystemAccountRole.create({
          id: `SAR-${companyId}-CUSTOMER-DEPOSIT-LIABILITY`,
          companyId,
          roleCode,
          accountId: account.id,
          createdBy: "company-bootstrap",
          updatedBy: "company-bootstrap",
        }, { transaction });
        report.adopted.push({ roleCode, accountId: account.id, settingKey: setting.key });
        return report;
      } catch (error) {
        report.blocking.push({ code: error.errorCode || "CUSTOMER_DEPOSIT_ROLE_INVALID" });
        return report;
      }
    }

    // This is the only new account RESET-1 may create. It starts at zero and
    // is identified by the protected mapping, never by its display name/code.
    const account = await models.Account.create({
      id: `ACC-${companyId}-CUSTOMER-DEPOSIT-LIABILITY`,
      companyId,
      code: "SYS-CUSTOMER-DEPOSIT-LIABILITY",
      name: "Customer Deposit Liability",
      nameAr: "التزامات دفعات العملاء",
      type: "liability",
      nature: "credit",
      balance: 0,
      isActive: true,
      level: 1,
    }, { transaction });
    await models.SystemAccountRole.create({
      id: `SAR-${companyId}-CUSTOMER-DEPOSIT-LIABILITY`,
      companyId,
      roleCode,
      accountId: account.id,
      createdBy: "company-bootstrap",
      updatedBy: "company-bootstrap",
    }, { transaction });
    await models.Setting.create({
      companyId,
      key: "reservationAdvancesAccountId",
      value: account.id,
    }, { transaction });
    report.created.push({ roleCode, accountId: account.id, settingKey: "reservationAdvancesAccountId" });
    return report;
  };
  return providedTransaction ? run(providedTransaction) : models.sequelize.transaction(run);
}

async function companyReadiness(companyId) {
  const roleCode = SYSTEM_ACCOUNT_ROLES.CUSTOMER_DEPOSIT_LIABILITY;
  try {
    const account = await resolveSystemAccountRole(companyId, roleCode);
    return {
      companyId,
      areas: {
        reservations: { status: "READY", blockers: [], accountId: account.id },
        purchases: { status: "RECOVERABLE", blockers: [{ code: "SUPPLIER_MASTER_DATA_REQUIRED" }] },
        inventory: { status: "RECOVERABLE", blockers: [{ code: "SUPPLIER_RECEIVING_LIFECYCLE_REQUIRED" }, { code: "INVENTORY_TAXONOMY_REQUIRED" }] },
      },
    };
  } catch (error) {
    return {
      companyId,
      areas: {
        reservations: { status: "BLOCKED", blockers: [{ code: error.errorCode || "CUSTOMER_DEPOSIT_ROLE_NOT_CONFIGURED" }] },
        purchases: { status: "RECOVERABLE", blockers: [{ code: "SUPPLIER_MASTER_DATA_REQUIRED" }] },
        inventory: { status: "RECOVERABLE", blockers: [{ code: "SUPPLIER_RECEIVING_LIFECYCLE_REQUIRED" }, { code: "INVENTORY_TAXONOMY_REQUIRED" }] },
      },
    };
  }
}

module.exports = {
  SYSTEM_ACCOUNT_ROLES,
  bootstrapCompanyAccounts,
  resolveSystemAccountRole,
  companyReadiness,
};
