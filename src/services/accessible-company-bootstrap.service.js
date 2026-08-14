"use strict";

/**
 * Produces the deliberately minimal, context-free Company bootstrap list.
 * It never selects a Company or mutates server-side session state.
 */
const BOOTSTRAP_ATTRIBUTES = ["id", "businessName", "workspace", "currency", "logo"];
const BOOTSTRAP_ORDER = [["businessName", "ASC"], ["id", "ASC"]];

function serializeAccessibleCompany(company) {
  return {
    id: company.id,
    businessName: company.businessName,
    workspace: company.workspace,
    currency: company.currency || "AED",
    logo: company.logo || ""
  };
}

async function listAccessibleCompanies({ Company, user }) {
  const accountType = user?.accountType || "legacy";
  const where = accountType === "super_admin"
    ? undefined
    : (user?.companyId ? { id: user.companyId } : { id: null });

  const companies = await Company.findAll({
    ...(where ? { where } : {}),
    attributes: BOOTSTRAP_ATTRIBUTES,
    order: BOOTSTRAP_ORDER
  });

  return companies.map(serializeAccessibleCompany);
}

module.exports = {
  BOOTSTRAP_ATTRIBUTES,
  BOOTSTRAP_ORDER,
  serializeAccessibleCompany,
  listAccessibleCompanies
};
