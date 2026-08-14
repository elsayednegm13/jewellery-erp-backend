"use strict";

const crypto = require("crypto");
const { Op } = require("sequelize");
const { AppError, ValidationError, NotFoundError, ConflictError } = require("../utils/errors");
const {
  validateFinancialAccountProposedState,
} = require("./financial-account-integrity.service");

const TYPES = new Set(["asset", "liability", "equity", "revenue", "expense"]);
const CLASSIFICATIONS = new Set(["asset", "liability", "equity", "revenue", "cost_of_goods_sold", "operating_expense", "other_income"]);

function forbiddenBalance(body) {
  return ["balance", "storedBalance", "calculatedBalance", "companyId", "branchId", "bootstrapVersion"]
    .some((field) => Object.prototype.hasOwnProperty.call(body || {}, field));
}

function clean(body, existing = null) {
  if (forbiddenBalance(body)) throw new AppError("Protected account fields cannot be changed.", 403, "ACCOUNT_PROTECTED_FIELD_FORBIDDEN");
  const code = body.code === undefined ? existing?.code : String(body.code || "").trim().toUpperCase();
  const name = body.name === undefined ? existing?.name : String(body.name || "").trim();
  const nameAr = body.nameAr === undefined ? existing?.nameAr : String(body.nameAr || "").trim();
  const type = body.type === undefined ? existing?.type : String(body.type || "").trim();
  const nature = body.nature === undefined ? existing?.nature : String(body.nature || "").trim();
  const statementClassification = body.statementClassification === undefined
    ? existing?.statementClassification
    : String(body.statementClassification || "").trim();
  if (!code || !/^[A-Z0-9][A-Z0-9._-]{1,38}$/.test(code)) throw new ValidationError("Account code is invalid.");
  if (!name || !nameAr) throw new ValidationError("Account names are required.");
  if (!TYPES.has(type) || !["debit", "credit"].includes(nature)) throw new ValidationError("Account type or nature is invalid.");
  if (!CLASSIFICATIONS.has(statementClassification)) throw new ValidationError("Statement classification is invalid.");
  return {
    code,
    name,
    nameAr,
    type,
    nature,
    statementClassification,
    parentId: body.parentId === undefined ? existing?.parentId || null : body.parentId || null,
    isPosting: body.isPosting === undefined ? (existing?.isPosting !== false) : Boolean(body.isPosting),
  };
}

async function parentFor(models, companyId, accountId, parentId, transaction) {
  if (!parentId) return null;
  if (String(parentId) === String(accountId || "")) throw new ValidationError("An account cannot be its own parent.");
  const parent = await models.Account.findOne({ where: { id: parentId, companyId }, transaction });
  if (!parent) throw new ValidationError("The parent account is outside the Company.");
  let cursor = parent;
  const visited = new Set();
  while (cursor?.parentId) {
    if (String(cursor.parentId) === String(accountId || "")) throw new ValidationError("The account hierarchy would contain a cycle.");
    if (visited.has(cursor.parentId)) throw new ValidationError("The account hierarchy is invalid.");
    visited.add(cursor.parentId);
    cursor = await models.Account.findOne({ where: { id: cursor.parentId, companyId }, transaction });
  }
  return parent;
}

async function listAccounts({ models, companyId, query = {} }) {
  const page = Math.max(Number.parseInt(query.page, 10) || 1, 1);
  const pageSize = Math.min(Math.max(Number.parseInt(query.pageSize, 10) || 100, 1), 500);
  const where = { companyId };
  if (query.active === "true") where.isActive = true;
  if (query.active === "false") where.isActive = false;
  if (query.search) {
    const term = `%${String(query.search).trim()}%`;
    where[Op.or] = [{ code: { [Op.iLike]: term } }, { name: { [Op.iLike]: term } }, { nameAr: { [Op.iLike]: term } }];
  }
  const result = await models.Account.findAndCountAll({
    where,
    order: [["code", "ASC"]],
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  return { items: result.rows, total: result.count, page, pageSize };
}

async function getAccount({ models, companyId, accountId, transaction = null }) {
  const account = await models.Account.findOne({ where: { id: accountId, companyId }, transaction });
  if (!account) throw new NotFoundError("Account not found.");
  return account;
}

async function createAccount({ models, companyId, body, transaction: suppliedTransaction }) {
  const run = async (transaction) => {
    const data = clean(body);
    const duplicate = await models.Account.findOne({ where: { companyId, code: data.code }, transaction });
    if (duplicate) throw new ConflictError("Account code already exists.");
    const parent = await parentFor(models, companyId, null, data.parentId, transaction);
    if (parent?.isPosting) throw new ValidationError("A posting account cannot be used as a parent.");
    return models.Account.create({
      id: `ACC-${crypto.randomUUID()}`,
      companyId,
      branchId: null,
      ...data,
      balance: 0,
      isActive: true,
      bootstrapVersion: null,
      level: parent ? Number(parent.level || 1) + 1 : 1,
    }, { transaction });
  };
  return suppliedTransaction ? run(suppliedTransaction) : models.sequelize.transaction(run);
}

async function updateAccount({ models, companyId, accountId, body, transaction: suppliedTransaction }) {
  const run = async (transaction) => {
    const account = await getAccount({ models, companyId, accountId, transaction });
    const data = clean(body, account);
    const duplicate = await models.Account.findOne({
      where: { companyId, code: data.code, id: { [Op.ne]: accountId } },
      transaction,
    });
    if (duplicate) throw new ConflictError("Account code already exists.");
    const [referencedLines, childAccounts, stableRoleBindings, activeMappings] = await Promise.all([
      models.JournalLine.count({ where: { accountId }, transaction }),
      models.Account.findAll({ where: { companyId, parentId: accountId }, transaction }),
      models.SystemAccountRole.findAll({ where: { companyId, accountId }, transaction, lock: transaction?.LOCK.UPDATE }),
      models.BranchFinancialMapping.findAll({
        where: { companyId, accountId, isActive: true },
        transaction,
        lock: transaction?.LOCK.UPDATE,
      }),
    ]);
    const parent = await parentFor(models, companyId, accountId, data.parentId, transaction);
    const currentAccount = typeof account.get === "function" ? account.get({ plain: true }) : { ...account };
    const proposedAccount = {
      ...currentAccount,
      ...data,
      companyId: account.companyId,
      branchId: account.branchId,
      isActive: account.isActive === true,
    };
    validateFinancialAccountProposedState({
      companyId,
      currentAccount,
      proposedAccount,
      stableRoleBindings,
      activeMappings,
      childAccounts,
      parentAccount: parent,
      journalReferenceCount: referencedLines,
    });
    await account.update({ ...data, level: parent ? Number(parent.level || 1) + 1 : 1 }, { transaction });
    return account;
  };
  return suppliedTransaction ? run(suppliedTransaction) : models.sequelize.transaction(run);
}

async function setActive({ models, companyId, accountId, isActive, transaction: suppliedTransaction }) {
  const run = async (transaction) => {
    const account = await getAccount({ models, companyId, accountId, transaction });
    if (!isActive) {
      const [stableRoleBindings, activeMappings, childAccounts, journalReferenceCount] = await Promise.all([
        models.SystemAccountRole.findAll({ where: { companyId, accountId }, transaction }),
        models.BranchFinancialMapping.findAll({ where: { companyId, accountId, isActive: true }, transaction }),
        models.Account.findAll({ where: { companyId, parentId: accountId }, transaction }),
        models.JournalLine.count({ where: { accountId }, transaction }),
      ]);
      const currentAccount = typeof account.get === "function" ? account.get({ plain: true }) : { ...account };
      validateFinancialAccountProposedState({
        companyId,
        currentAccount,
        proposedAccount: { ...currentAccount, isActive: false },
        stableRoleBindings,
        activeMappings,
        childAccounts,
        journalReferenceCount,
      });
    }
    await account.update({ isActive }, { transaction });
    return account;
  };
  return suppliedTransaction ? run(suppliedTransaction) : models.sequelize.transaction(run);
}

async function deleteAccount({ models, companyId, accountId }) {
  await getAccount({ models, companyId, accountId });
  throw new AppError("Accounts are retained for audit history; deactivate an eligible account instead.", 409, "ACCOUNT_DELETE_FORBIDDEN");
}

module.exports = {
  listAccounts,
  getAccount,
  createAccount,
  updateAccount,
  deactivateAccount: (input) => setActive({ ...input, isActive: false }),
  reactivateAccount: (input) => setActive({ ...input, isActive: true }),
  deleteAccount,
};
