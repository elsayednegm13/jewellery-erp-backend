"use strict";

const crypto = require("crypto");

// CGP-IMP-05A system configuration only.  It creates no financial business
// facts: no journals, liabilities, payments, events, or asset changes.
const ROLE_CODE = "CUSTOMER_CREDITOR";
const ACCOUNT_CODE = "2500";
const ACCOUNT_NAME = "Customer Creditors";
const ACCOUNT_NAME_AR = "ذمم دائنة للعملاء";
const LIABILITY_PARENT_CODE = "2000";

const id = (prefix) => `${prefix}-${crypto.randomUUID()}`;

async function one(rows, message) {
  if (rows.length !== 1) throw new Error(message);
  return rows[0];
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const now = new Date();
    const companies = await queryInterface.sequelize.query(
      "SELECT id FROM companies ORDER BY id",
      { type: Sequelize.QueryTypes.SELECT },
    );

    for (const company of companies) {
      const parent = await one(await queryInterface.sequelize.query(
        `SELECT id, type, nature, statement_classification, is_posting
           FROM accounts
          WHERE company_id=:companyId AND code=:parentCode`,
        { replacements: { companyId: company.id, parentCode: LIABILITY_PARENT_CODE }, type: Sequelize.QueryTypes.SELECT },
      ), "CUSTOMER_CREDITOR_PARENT_AMBIGUOUS");
      if (parent.type !== "liability" || parent.nature !== "credit" || parent.statement_classification !== "liability" || parent.is_posting !== false) {
        throw new Error("CUSTOMER_CREDITOR_PARENT_INVALID");
      }

      const existingAccounts = await queryInterface.sequelize.query(
        `SELECT id, parent_id, name, name_ar, type, nature, is_active, is_posting, statement_classification
           FROM accounts WHERE company_id=:companyId AND code=:accountCode`,
        { replacements: { companyId: company.id, accountCode: ACCOUNT_CODE }, type: Sequelize.QueryTypes.SELECT },
      );
      let account = existingAccounts[0] || null;
      if (existingAccounts.length > 1) throw new Error("CUSTOMER_CREDITOR_ACCOUNT_DUPLICATE");
      if (account) {
        const valid = account.parent_id === parent.id && account.name === ACCOUNT_NAME && account.name_ar === ACCOUNT_NAME_AR &&
          account.type === "liability" && account.nature === "credit" && account.is_active === true && account.is_posting === true &&
          account.statement_classification === "liability";
        if (!valid) throw new Error("CUSTOMER_CREDITOR_ACCOUNT_CONFLICT");
      } else {
        account = { id: id("ACC") };
        await queryInterface.bulkInsert("accounts", [{
          id: account.id, company_id: company.id, branch_id: null, code: ACCOUNT_CODE,
          name: ACCOUNT_NAME, name_ar: ACCOUNT_NAME_AR, type: "liability", nature: "credit",
          parent_id: parent.id, balance: 0, is_active: true, is_posting: true,
          statement_classification: "liability", bootstrap_version: 2, level: 2,
          created_at: now, updated_at: now,
        }]);
      }

      const branches = await queryInterface.sequelize.query(
        "SELECT id FROM branches WHERE company_id=:companyId AND is_active=true ORDER BY id",
        { replacements: { companyId: company.id }, type: Sequelize.QueryTypes.SELECT },
      );
      for (const branch of branches) {
        const roleRows = await queryInterface.sequelize.query(
          `SELECT id, account_id FROM system_account_roles
            WHERE company_id=:companyId AND branch_id=:branchId AND role_code=:roleCode`,
          { replacements: { companyId: company.id, branchId: branch.id, roleCode: ROLE_CODE }, type: Sequelize.QueryTypes.SELECT },
        );
        if (roleRows.length > 1) throw new Error("CUSTOMER_CREDITOR_ROLE_DUPLICATE");
        if (roleRows.length === 1) {
          if (roleRows[0].account_id !== account.id) throw new Error("CUSTOMER_CREDITOR_ROLE_MAPPING_CONFLICT");
          continue;
        }
        await queryInterface.bulkInsert("system_account_roles", [{
          id: id("SAR"), company_id: company.id, branch_id: branch.id, role_code: ROLE_CODE,
          account_id: account.id, created_by: "system:cgp-imp-05a", updated_by: "system:cgp-imp-05a",
          created_at: now, updated_at: now,
        }]);
      }
    }
  },

  async down(queryInterface, Sequelize) {
    const accounts = await queryInterface.sequelize.query(
      "SELECT id FROM accounts WHERE code=:accountCode",
      { replacements: { accountCode: ACCOUNT_CODE }, type: Sequelize.QueryTypes.SELECT },
    );
    for (const account of accounts) {
      const [references] = await queryInterface.sequelize.query(
        `SELECT (SELECT count(*)::int FROM journal_lines WHERE account_id=:accountId) AS journal_lines,
                (SELECT count(*)::int FROM branch_financial_mappings WHERE account_id=:accountId) AS branch_mappings`,
        { replacements: { accountId: account.id }, type: Sequelize.QueryTypes.SELECT },
      );
      if (Number(references.journal_lines) || Number(references.branch_mappings)) throw new Error("CUSTOMER_CREDITOR_DOWN_REFERENCED");
      await queryInterface.bulkDelete("system_account_roles", { account_id: account.id, role_code: ROLE_CODE });
      await queryInterface.bulkDelete("accounts", { id: account.id, code: ACCOUNT_CODE });
    }
  },
};
