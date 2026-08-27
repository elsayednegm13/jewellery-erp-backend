const assert = require("node:assert/strict");
const test = require("node:test");
const bcrypt = require("bcryptjs");

const models = require("../src/models");
const app = require("../src/app");

const enabled = process.env.G2A1_DISPOSABLE_TEST === "1";

test("G2A1 disposable API policy contract", { skip: !enabled }, async () => {
  const [[db]] = await models.sequelize.query("SELECT current_database() AS name");
  assert.match(db.name, /^darfus_g2a1_/);
  assert.notEqual(db.name, "darfus_erp");

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const company = await models.Company.create({
    id: `G2A1-COMP-${suffix}`,
    businessName: "Synthetic G2A1 Company",
    workspace: `synthetic-g2a1-${suffix}`,
    currency: "AED",
    country: "AE",
  });
  const password = `SyntheticOnly-${suffix}`;
  const user = await models.User.create({
    id: `G2A1-USER-${suffix}`,
    companyId: company.id,
    firstName: "Synthetic",
    lastName: "Tax Admin",
    email: `g2a1-${suffix}@example.invalid`,
    password: await bcrypt.hash(password, 4),
    role: "admin",
    accountType: "legacy",
    isActive: true,
  });
  const manager = await models.User.create({
    id: `G2A1-MANAGER-${suffix}`,
    companyId: company.id,
    firstName: "Synthetic",
    lastName: "Manager",
    email: `g2a1-manager-${suffix}@example.invalid`,
    password: await bcrypt.hash(password, 4),
    role: "manager",
    accountType: "legacy",
    isActive: true,
  });
  const accountant = await models.User.create({
    id: `G2A1-ACCOUNTANT-${suffix}`,
    companyId: company.id,
    firstName: "Synthetic",
    lastName: "Accountant",
    email: `g2a1-accountant-${suffix}@example.invalid`,
    password: await bcrypt.hash(password, 4),
    role: "accountant",
    accountType: "legacy",
    isActive: true,
  });

  const server = app.listen(0);
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/v1`;
    const loginResponse = await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: user.email, password }),
    });
    assert.equal(loginResponse.status, 200);
    const login = await loginResponse.json();
    const token = login.data.token;
    assert.ok(token);

    const headers = {
      authorization: `Bearer ${token}`,
      "x-company-id": company.id,
      "content-type": "application/json",
    };
    const loginAs = async (actor) => {
      const response = await fetch(`${base}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: actor.email, password }),
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      return { ...headers, authorization: `Bearer ${body.data.token}` };
    };
    const initialResponse = await fetch(`${base}/settings`, { headers });
    assert.equal(initialResponse.status, 200);
    const initial = await initialResponse.json();
    assert.equal(initial.data.taxPolicy.vatRegistered, null);
    assert.equal(initial.data.taxPolicy.enabledTaxTreatments, null);
    assert.equal(initial.data.taxPolicy.configured, false);

    const updateResponse = await fetch(`${base}/settings`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        vatRegistered: true,
        vatRate: 5,
        vatEnabled: true,
        enabledTaxTreatments: ["STANDARD_VAT", "ZERO_RATED"],
        defaultTaxTreatment: "STANDARD_VAT",
        preciousGoodsRcmEnabled: false,
      }),
    });
    assert.equal(updateResponse.status, 200);

    const readResponse = await fetch(`${base}/settings`, { headers });
    assert.equal(readResponse.status, 200);
    const read = await readResponse.json();
    assert.equal(read.data.taxPolicy.vatRegistered, true);
    assert.deepEqual(read.data.taxPolicy.enabledTaxTreatments, ["STANDARD_VAT", "ZERO_RATED"]);
    assert.equal(read.data.taxPolicy.defaultTaxTreatment, "STANDARD_VAT");
    assert.equal(read.data.taxPolicy.preciousGoodsRcmEnabled, false);
    assert.equal(read.data.taxPolicy.trn, null);

    const settingsBeforeInvalid = await models.Setting.count({ where: { companyId: company.id } });
    const invalidResponse = await fetch(`${base}/settings`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ enabledTaxTreatments: ["NOT_A_TREATMENT"] }),
    });
    assert.equal(invalidResponse.status, 422);
    assert.equal(await models.Setting.count({ where: { companyId: company.id } }), settingsBeforeInvalid);

    const managerResponse = await fetch(`${base}/settings`, {
      method: "PATCH",
      headers: await loginAs(manager),
      body: JSON.stringify({ vatRegistered: false }),
    });
    assert.equal(managerResponse.status, 403);

    const managerByKeyResponse = await fetch(`${base}/settings/by-key/vatRate`, {
      method: "PUT",
      headers: await loginAs(manager),
      body: JSON.stringify({ value: 5 }),
    });
    assert.equal(managerByKeyResponse.status, 403);

    const accountantResponse = await fetch(`${base}/settings`, {
      method: "PATCH",
      headers: await loginAs(accountant),
      body: JSON.stringify({ preciousGoodsRcmEnabled: true }),
    });
    assert.equal(accountantResponse.status, 200);

    const crossCompanyResponse = await fetch(`${base}/settings`, {
      method: "PATCH",
      headers: { ...headers, "x-company-id": "G2A1-OTHER-COMPANY" },
      body: JSON.stringify({ vatRegistered: false }),
    });
    assert.equal(crossCompanyResponse.status, 403);

    const auditRows = await models.AuditLog.findAll({
      where: { companyId: company.id },
      attributes: ["action"],
    });
    assert.ok(auditRows.some((row) => row.action === "company.tax_policy.updated"));
    assert.ok(auditRows.some((row) => row.action === "company.vat_registration.updated"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await models.sequelize.close();
  }
});
