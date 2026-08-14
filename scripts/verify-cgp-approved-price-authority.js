"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

const ACCEPTANCE_DATABASE = "darfus_erp_inventory_rehearsal_20260804_160500z";
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
delete process.env.DATABASE_URL;
process.env.DB_NAME = ACCEPTANCE_DATABASE;

const models = require("../src/models");
const permissionService = require("../src/services/permission.service");
const postingService = require("../src/services/cgp-posting.service");
const priceService = require("../src/services/gold-price-approval.service");

function hasCode(code) {
  return (error) => error?.errorCode === code || error?.code === code;
}

async function findContext() {
  const companies = await models.Company.findAll({ order: [["id", "ASC"]] });
  for (const company of companies) {
    const branch = await models.Branch.findOne({ where: { companyId: company.id, isActive: true }, order: [["id", "ASC"]] });
    if (!branch) continue;
    const users = await models.User.findAll({ where: { companyId: company.id }, order: [["id", "ASC"]] });
    for (const user of users) {
      const actor = user.toJSON();
      if (
        await permissionService.userHasPermission(actor, postingService.POST_PERMISSION)
        && await permissionService.userHasPermission(actor, priceService.GOLD_PRICE_APPROVAL_PERMISSION)
      ) return { company: company.toJSON(), branch: branch.toJSON(), user: actor };
    }
  }
  throw new Error("CGP_IMP03_PRICE_AUTHORITY_CONTEXT_NOT_FOUND");
}

async function main() {
  await models.sequelize.authenticate();
  const [database] = await models.sequelize.query("SELECT current_database() AS db");
  assert.equal(database[0]?.db, ACCEPTANCE_DATABASE, "Acceptance DB required");
  const context = await findContext();
  const currency = context.company.currency || "AED";
  const approved = await models.GoldPrice.findOne({
    where: { companyId: context.company.id, currency, approvalStatus: "APPROVED" },
    order: [["approvedAt", "DESC"], ["id", "DESC"]],
  });
  assert.ok(approved, "the CGP IMP03 posting verifier must first establish one approved price");

  const transaction = await models.sequelize.transaction();
  try {
    const scope = { companyId: context.company.id, branchId: context.branch.id, user: context.user };
    const now = new Date();
    const executable = await priceService.resolveExecutableApprovedKaratPrice({
      companyId: context.company.id, currency, karat: approved.karat, transaction, now,
    });
    assert.equal(executable.id, approved.id, "exact company/currency/karat approved price is executable");

    // Client-shaped approval fields cannot promote an input: creation is always pending.
    const unapproved = await priceService.createPendingPrice({
      context: scope,
      input: { karat: 17, pricePerGram: "171.0000", currency, source: "manual", approvalStatus: "APPROVED" },
      transaction,
    });
    assert.equal(unapproved.approvalStatus, "PENDING");
    await assert.rejects(
      () => priceService.resolveExecutableApprovedKaratPrice({ companyId: context.company.id, currency, karat: 17, transaction, now }),
      hasCode("CGP_APPROVED_GOLD_PRICE_REQUIRED"),
    );

    // A valid Pending price becomes executable only through the permission-gated transition.
    const candidate = await priceService.createPendingPrice({
      context: scope,
      input: {
        karat: 20, pricePerGram: "200.0000", currency, source: "manual",
        validFrom: new Date(now.getTime() - 60_000).toISOString(),
        validUntil: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
      },
      transaction,
    });
    await assert.rejects(
      () => priceService.approvePrice({ context: { ...scope, user: { ...context.user, accountType: "branch_shell" } }, priceId: candidate.id, transaction, now }),
      /gold\.approve_price is required/,
    );
    const approval = await priceService.approvePrice({ context: scope, priceId: candidate.id, transaction, now });
    assert.equal(approval.price.approvalStatus, "APPROVED");
    assert.equal((await priceService.approvePrice({ context: scope, priceId: candidate.id, transaction, now })).replayed, true);

    // Expired, wrong-company, wrong-karat, wrong-currency, and legacy-global rows are never selected.
    const expired = await priceService.createPendingPrice({
      context: scope,
      input: { karat: 16, pricePerGram: "160.0000", currency, source: "manual", validFrom: new Date(now.getTime() - 120_000).toISOString(), validUntil: new Date(now.getTime() - 60_000).toISOString() },
      transaction,
    });
    await assert.rejects(() => priceService.approvePrice({ context: scope, priceId: expired.id, transaction, now }), hasCode("GOLD_PRICE_NOT_EFFECTIVE"));
    await models.GoldPrice.create({ companyId: "CGP-IMP03-OTHER-COMPANY", karat: 14, pricePerGram: "140.0000", currency, source: "manual", approvalStatus: "APPROVED", approvedAt: now, approvedBy: context.user.id, validFrom: new Date(now.getTime() - 60_000), validUntil: new Date(now.getTime() + 60_000), approvalVersion: 1 }, { transaction });
    await models.GoldPrice.create({ companyId: context.company.id, karat: 13, pricePerGram: "130.0000", currency: "USD", source: "manual", approvalStatus: "APPROVED", approvedAt: now, approvedBy: context.user.id, validFrom: new Date(now.getTime() - 60_000), validUntil: new Date(now.getTime() + 60_000), approvalVersion: 1 }, { transaction });
    await models.GoldPrice.create({ companyId: null, karat: 15, pricePerGram: "150.0000", currency, source: "manual", approvalStatus: "APPROVED", approvedAt: now, approvedBy: context.user.id, validFrom: new Date(now.getTime() - 60_000), validUntil: new Date(now.getTime() + 60_000), approvalVersion: 1 }, { transaction });
    for (const request of [
      { companyId: context.company.id, currency, karat: 14 },
      { companyId: context.company.id, currency, karat: 13 },
      { companyId: context.company.id, currency, karat: 15 },
    ]) {
      await assert.rejects(() => priceService.resolveExecutableApprovedKaratPrice({ ...request, transaction, now }), hasCode("CGP_APPROVED_GOLD_PRICE_REQUIRED"));
    }
    await transaction.rollback();
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    throw error;
  }
  console.log("CGP_UNAPPROVED_PRICE_REJECTED: PASS");
  console.log("CGP_WRONG_COMPANY_PRICE_REJECTED: PASS");
  console.log("CGP_WRONG_KARAT_PRICE_REJECTED: PASS");
  console.log("CGP_WRONG_CURRENCY_PRICE_REJECTED: PASS");
  console.log("CGP_LEGACY_GLOBAL_FALLBACK_DISABLED: PASS");
  console.log("CGP_PRICE_APPROVAL_PERMISSION_ENFORCED: PASS");
  console.log("CGP_APPROVED_PRICE_EFFECTIVE_WINDOW: PASS");
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; }).finally(async () => { await models.sequelize.close(); });
