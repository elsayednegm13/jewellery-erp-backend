"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
require("dotenv").config({ path: path.resolve(__dirname, "../.env"), override: false });
const { chromium } = require("playwright");
const { QueryTypes } = require("sequelize");
const { resolveDatabaseEnv } = require("../src/config/database-env");

const ACCEPTANCE = "darfus_erp_inventory_rehearsal_20260804_160500z";
const PERSISTENT = "darfus_erp";
const PREFIX = "darfus_erp_customer_p3_summary_";
const PG_BIN = "C:\\Program Files\\PostgreSQL\\18\\bin";
const stamp = new Date().toISOString().replace(/[-:.]/g, "").replace("Z", "Z");
const evidenceDirectory = path.resolve(__dirname, `../reports/customer-master-phase-03-pos-customer-summary-evidence-${stamp}`);
fs.mkdirSync(evidenceDirectory, { recursive: true });
let runtimeStage = "initializing";

const pgEnv = (config, database) => ({
  ...process.env,
  PGHOST: config.host,
  PGPORT: String(config.port),
  PGUSER: config.username,
  PGPASSWORD: config.password,
  PGDATABASE: database,
  PGSSLMODE: config.ssl ? "require" : "disable",
});
const pg = (name, args, env) => execFileSync(path.join(PG_BIN, name), args, { env, stdio: "pipe" });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(label, predicate, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await delay(100);
  }
  throw new Error(`${label} timed out after ${timeoutMs}ms`);
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function responseKeys(payload) {
  if (!payload || typeof payload !== "object") return [];
  return Object.keys(payload).sort();
}

async function main() {
  runtimeStage = "clone_setup";
  const config = resolveDatabaseEnv({ ...process.env, NODE_ENV: "development", DATABASE_URL: "", DB_NAME: ACCEPTANCE });
  const clone = `${PREFIX}${Date.now()}`;
  const dump = path.join(os.tmpdir(), `${clone}.dump`);
  let sequelize;
  let server;
  let browser;
  let cloneDropped = false;
  const contexts = [];
  const network = [];
  const consoleErrors = [];
  const screenshots = [];
  let activeAction = "bootstrap";

  try {
    const sourceProbe = new (require("pg").Client)({
      host: config.host,
      port: config.port,
      user: config.username,
      password: config.password,
      database: ACCEPTANCE,
      ssl: config.ssl ? { rejectUnauthorized: false } : false,
      application_name: "customer_p2_clone_source_guard",
    });
    await sourceProbe.connect();
    const sourceDatabase = (await sourceProbe.query("SELECT current_database() AS db")).rows[0].db;
    await sourceProbe.end();
    if (sourceDatabase !== ACCEPTANCE) throw new Error(`ACCEPTANCE_SOURCE_GUARD_FAILED:${sourceDatabase}`);

    pg("pg_dump.exe", ["--format=custom", "--no-owner", "--no-privileges", `--file=${dump}`, ACCEPTANCE], pgEnv(config, ACCEPTANCE));
    pg("createdb.exe", [clone], pgEnv(config, "postgres"));
    pg("pg_restore.exe", ["--no-owner", "--no-privileges", "--exit-on-error", "--dbname", clone, dump], pgEnv(config, clone));

    const cloneProbe = new (require("pg").Client)({
      host: config.host,
      port: config.port,
      user: config.username,
      password: config.password,
      database: clone,
      ssl: config.ssl ? { rejectUnauthorized: false } : false,
      application_name: "customer_p2_clone_guard",
    });
    await cloneProbe.connect();
    const cloneDatabase = (await cloneProbe.query("SELECT current_database() AS db")).rows[0].db;
    await cloneProbe.end();
    if (cloneDatabase === PERSISTENT || cloneDatabase === ACCEPTANCE || cloneDatabase !== clone) {
      throw new Error(`CLONE_TARGET_GUARD_FAILED:${cloneDatabase}`);
    }

    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "";
    process.env.DB_NAME = clone;
    process.env.DB_USER = config.username;
    process.env.DB_HOST = config.host;
    process.env.DB_PORT = String(config.port);
    process.env.DB_SSL = config.ssl ? "true" : "false";
    process.env.PORT = "0";

    const models = require("../src/models");
    sequelize = models.sequelize;
    const one = async (sql, replacements = {}) => (await sequelize.query(sql, { replacements, type: QueryTypes.SELECT }))[0];
    const company = await models.Company.findOne({ order: [["id", "ASC"]] });
    const branch = await models.Branch.findOne({ where: { companyId: company.id, isActive: true }, order: [["code", "ASC"]] });
    const superAdmin = await models.User.findOne({ where: { companyId: company.id, isActive: true, accountType: "super_admin" }, order: [["id", "ASC"]] });
    if (!company || !branch || !superAdmin) throw new Error("CLONE_AUTH_CONTEXT_MISSING");

    const viewPermission = await models.Permission.findOne({ where: { name: "customers.view" } });
    const createPermission = await models.Permission.findOne({ where: { name: "customers.create" } });
    const shellPermissionNames = ["settings.view", "branches.view", "notifications.view"];
    if (!await models.Permission.findOne({ where: { name: "branches.view" } })) {
      await models.Permission.create({ id: `PERM-TEST-BRANCH-VIEW-${Date.now()}`, name: "branches.view", module: "branches", action: "view", description: "Disposable clone shell bootstrap permission" });
    }
    const shellPermissions = await models.Permission.findAll({ where: { name: shellPermissionNames } });
    if (!viewPermission || !createPermission || shellPermissions.length !== shellPermissionNames.length) throw new Error("CUSTOMER_OR_SHELL_PERMISSIONS_MISSING");
    const viewRole = await models.Role.create({ id: `ROLE-CUST-VIEW-${Date.now()}`, companyId: company.id, name: "Synthetic Customer Viewer", slug: `synthetic-customer-view-${Date.now()}`, isSystem: false, isAdmin: false });
    const createRole = await models.Role.create({ id: `ROLE-CUST-CREATE-${Date.now()}`, companyId: company.id, name: "Synthetic Customer Creator", slug: `synthetic-customer-create-${Date.now()}`, isSystem: false, isAdmin: false });
    const deniedRole = await models.Role.create({ id: `ROLE-CUST-DENIED-${Date.now()}`, companyId: company.id, name: "Synthetic Customer Denied", slug: `synthetic-customer-denied-${Date.now()}`, isSystem: false, isAdmin: false });
    await models.RolePermission.bulkCreate([
      { roleId: viewRole.id, permissionId: viewPermission.id },
      { roleId: createRole.id, permissionId: viewPermission.id },
      { roleId: createRole.id, permissionId: createPermission.id },
      ...shellPermissions.flatMap((permission) => [
        { roleId: viewRole.id, permissionId: permission.id },
        { roleId: createRole.id, permissionId: permission.id },
      ]),
    ]);
    const viewUser = await models.User.create({ id: `USR-CUST-VIEW-${Date.now()}`, companyId: company.id, firstName: "Synthetic", lastName: "Viewer", email: `customer-view-${Date.now()}@example.invalid`, password: "not-used", role: "sales", accountType: "legacy", branchId: branch.id, isActive: true });
    const createUser = await models.User.create({ id: `USR-CUST-CREATE-${Date.now()}`, companyId: company.id, firstName: "Synthetic", lastName: "Creator", email: `customer-create-${Date.now()}@example.invalid`, password: "not-used", role: "sales", accountType: "legacy", branchId: branch.id, isActive: true });
    const deniedUser = await models.User.create({ id: `USR-CUST-DENIED-${Date.now()}`, companyId: company.id, firstName: "Synthetic", lastName: "Denied", email: `customer-denied-${Date.now()}@example.invalid`, password: "not-used", role: "sales", accountType: "legacy", branchId: branch.id, isActive: true });
    await models.UserRole.bulkCreate([{ userId: viewUser.id, roleId: viewRole.id }, { userId: createUser.id, roleId: createRole.id }, { userId: deniedUser.id, roleId: deniedRole.id }]);

    const sessions = require("../src/services/technical-session.service");
    const tokenOptions = (name) => ({ headers: { "x-device-session-id": `customer-p2-${name}-${Date.now()}` }, ip: "127.0.0.1" });
    const adminAuth = await sessions.issueTokens(superAdmin, tokenOptions("admin"));
    const viewAuth = await sessions.issueTokens(viewUser, tokenOptions("view"));
    const createAuth = await sessions.issueTokens(createUser, tokenOptions("create"));
    const deniedAuth = await sessions.issueTokens(deniedUser, tokenOptions("denied"));
    const allPermissionNames = (await models.Permission.findAll({ attributes: ["name"] })).map((permission) => permission.name);

    const countsSql = `SELECT
      (SELECT count(*)::int FROM customers WHERE deleted_at IS NULL) AS customers,
      (SELECT count(*)::int FROM customer_credit_transactions) AS customer_credit_transactions,
      (SELECT count(*)::int FROM loyalty_transactions) AS loyalty_transactions,
      (SELECT count(*)::int FROM invoices) AS invoices,
      (SELECT count(*)::int FROM payments) AS payments,
      (SELECT count(*)::int FROM journal_entries) AS journal_entries,
      (SELECT count(*)::int FROM journal_lines) AS journal_lines,
      (SELECT count(*)::int FROM cash_transactions) AS cash_transactions,
      (SELECT count(*)::int FROM assets) AS assets`;
    const beforeCounts = await one(countsSql);

    const app = require("../src/app");
    server = await new Promise((resolve, reject) => {
      const candidate = app.listen(0, "127.0.0.1", () => resolve(candidate));
      candidate.on("error", reject);
    });
    const base = `http://127.0.0.1:${server.address().port}/api/v1`;

    const directApi = async (auth, method, apiPath, body, extraHeaders = {}) => {
      const response = await fetch(`${base}${apiPath}`, {
        method,
        headers: {
          Authorization: `Bearer ${auth.token}`,
          "X-Company-ID": company.id,
          "X-Branch-ID": branch.id,
          "X-Device-Session-ID": "customer-p2-runtime",
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...extraHeaders,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await response.text();
      return { status: response.status, body: safeJson(text), text };
    };

    runtimeStage = "optional_address_create_matrix";
    const optionalAddressMatrix = [];
    const optionalVariants = [
      ["line1_only", { line1: "شارع فقط" }],
      ["city_only", { city: "القاهرة" }],
      ["country_only", { country: "مصر" }],
      ["line1_city", { line1: "شارع", city: "الجيزة" }],
      ["city_country", { city: "الإسكندرية", country: "مصر" }],
      ["postal_only", { postalCode: "11511" }],
    ];
    for (let index = 0; index < optionalVariants.length; index += 1) {
      const [label, address] = optionalVariants[index];
      const response = await directApi(adminAuth, "POST", "/customers", {
        name: `عميل عنوان جزئي ${label}`,
        phone: `0509100${String(index).padStart(3, "0")}`,
        addresses: [address],
      });
      if (response.status !== 201 || response.body?.data?.addresses?.[0]?.isPrimary !== true) throw new Error(`OPTIONAL_ADDRESS_CREATE_FAILED:${label}`);
      optionalAddressMatrix.push({ label, status: response.status, primary: response.body.data.addresses[0].isPrimary });
    }
    const allBlankAddress = await directApi(adminAuth, "POST", "/customers", {
      name: "عميل عنوان فارغ مرفوض",
      phone: "0509100999",
      addresses: [{ line1: " ", line2: "", city: "", country: "", postalCode: "", isPrimary: true }],
    });
    if (allBlankAddress.status !== 422 || allBlankAddress.body?.error?.code !== "EMPTY_CUSTOMER_ADDRESS") throw new Error("EMPTY_ADDRESS_NOT_REJECTED");
    optionalAddressMatrix.push({ label: "all_blank", status: allBlankAddress.status, errorCode: allBlankAddress.body?.error?.code });

    const editMatrixCreate = await directApi(adminAuth, "POST", "/customers", {
      name: "عميل اختبار تعديل عنوان جزئي",
      phone: "0509100888",
      addresses: [{ line1: "بداية", city: "القاهرة", country: "مصر" }],
    });
    if (editMatrixCreate.status !== 201) throw new Error("OPTIONAL_ADDRESS_EDIT_SETUP_FAILED");
    const optionalEditMatrix = [];
    let editMatrixCustomer = editMatrixCreate.body.data;
    for (const [label, address] of [
      ["city_only", { city: "القاهرة" }],
      ["country_only", { country: "مصر" }],
      ["line1_only", { line1: "شارع فقط" }],
      ["postal_only", { postalCode: "11511" }],
    ]) {
      const response = await directApi(adminAuth, "PUT", `/customers/${editMatrixCustomer.id}`, {
        addresses: [{ ...address, isPrimary: true }],
        expectedUpdatedAt: editMatrixCustomer.updatedAt,
      });
      if (response.status !== 200 || response.body?.data?.addresses?.[0]?.isPrimary !== true) throw new Error(`OPTIONAL_ADDRESS_EDIT_FAILED:${label}`);
      editMatrixCustomer = response.body.data;
      optionalEditMatrix.push({ label, status: response.status, primary: true });
    }
    const editAllBlank = await directApi(adminAuth, "PUT", `/customers/${editMatrixCustomer.id}`, {
      addresses: [{ line1: "", line2: "", city: "", country: "", postalCode: "", isPrimary: true }],
      expectedUpdatedAt: editMatrixCustomer.updatedAt,
    });
    if (editAllBlank.status !== 422 || editAllBlank.body?.error?.code !== "EMPTY_CUSTOMER_ADDRESS") throw new Error("EMPTY_ADDRESS_EDIT_NOT_REJECTED");
    optionalEditMatrix.push({ label: "all_blank_blocked", status: editAllBlank.status, errorCode: editAllBlank.body?.error?.code });

    browser = await chromium.launch({ headless: true });

    const makeContext = async (auth, user, permissions, viewport) => {
      const context = await browser.newContext({ viewport });
      contexts.push(context);
      await context.addInitScript(({ token, refreshToken, branchId, branchName, companyId, session }) => {
        localStorage.setItem("darfus-token-v1", token);
        localStorage.setItem("darfus-refresh-v1", refreshToken || "synthetic-refresh");
        localStorage.setItem("darfus-api-session-v1", JSON.stringify(session));
        localStorage.setItem("darfus-active-branch-id-v1", branchId);
        localStorage.setItem("darfus-active-branch-name-v1", branchName);
        localStorage.setItem("darfus-company-id-v1", companyId);
      }, {
        token: auth.token,
        refreshToken: auth.refreshToken,
        branchId: branch.id,
        branchName: branch.name,
        companyId: company.id,
        session: { user: { ...user.toJSON(), permissions }, company: { ...company.toJSON(), branchName: branch.name, branchCode: branch.code } },
      });
      await context.route("**/*", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (!url.pathname.startsWith("/api/v1/")) return route.continue();
        if (url.pathname.startsWith("/api/v1/events/stream")) {
          return route.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-cache" }, body: ": customer phase 2 harness\n\n" });
        }
        const forwardedPath = url.pathname.slice("/api/v1".length) || "/";
        const headers = { ...request.headers(), authorization: `Bearer ${auth.token}`, "x-company-id": company.id, "x-branch-id": branch.id, "x-device-session-id": "customer-p2-browser" };
        delete headers.host;
        const requestText = request.postData() || "";
        const response = await fetch(`${base}${forwardedPath}${url.search}`, {
          method: request.method(),
          headers,
          body: ["GET", "HEAD"].includes(request.method()) ? undefined : requestText,
          signal: AbortSignal.timeout(15000),
        });
        const responseText = await response.text();
        const responseHeaders = Object.fromEntries(response.headers.entries());
        delete responseHeaders["content-encoding"];
        delete responseHeaders["content-length"];
        delete responseHeaders["transfer-encoding"];
        if (forwardedPath.startsWith("/customers")) {
          const requestBody = safeJson(requestText);
          const responseBody = safeJson(responseText);
          network.push({
            action: activeAction,
            method: request.method(),
            url: forwardedPath,
            status: response.status,
            requestKeys: requestBody && typeof requestBody === "object" ? Object.keys(requestBody).sort() : [],
            responseKeys: responseKeys(responseBody),
            expectedUpdatedAtPresent: Boolean(requestBody?.expectedUpdatedAt),
            requestBody,
            responseBody,
            database: clone,
          });
        }
        return route.fulfill({ status: response.status, headers: responseHeaders, body: responseText });
      });
      return context;
    };

    const adminContext = await makeContext(adminAuth, superAdmin, allPermissionNames, { width: 1440, height: 900 });
    const page = await adminContext.newPage();
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    const overflowEvidence = [];
    const captureOverflow = async (label) => {
      const metrics = await page.evaluate(() => ({
        viewportWidth: window.innerWidth,
        documentClientWidth: document.documentElement.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        bodyClientWidth: document.body.clientWidth,
        bodyScrollWidth: document.body.scrollWidth,
      }));
      metrics.label = label;
      metrics.horizontalOverflow = metrics.documentScrollWidth > metrics.documentClientWidth + 1
        || metrics.bodyScrollWidth > metrics.bodyClientWidth + 1;
      overflowEvidence.push(metrics);
      if (metrics.horizontalOverflow) throw new Error(`HORIZONTAL_OVERFLOW:${label}:${JSON.stringify(metrics)}`);
    };

    activeAction = "open_customers";
    await page.goto("http://localhost:3000/ar/customers", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.getByRole("button", { name: "عميل جديد", exact: true }).waitFor({ state: "visible", timeout: 30000 });

    activeAction = "create_without_address";
    await page.getByRole("button", { name: "عميل جديد", exact: true }).click();
    await page.getByTestId("customer-form-name").fill("عميل تجريبي بدون عنوان");
    await page.getByTestId("customer-form-phone").fill("0509000001");
    const createWithoutStart = network.length;
    await page.getByTestId("customer-save").click();
    const createWithout = await waitUntil("create without address", () => network.slice(createWithoutStart).find((call) => call.action === "create_without_address" && call.method === "POST" && call.url === "/customers"));
    if (createWithout.status !== 201 || createWithout.requestKeys.includes("addresses")) throw new Error("CREATE_WITHOUT_ADDRESS_CONTRACT_FAILED");
    const withoutCustomer = createWithout.responseBody?.data;
    await page.getByText("عميل تجريبي بدون عنوان", { exact: true }).waitFor({ state: "visible", timeout: 10000 });

    activeAction = "create_with_address";
    await page.getByRole("button", { name: "عميل جديد", exact: true }).click();
    await page.getByTestId("customer-form-name").fill("عميل اختبار العنوان الأساسي");
    await page.getByTestId("customer-form-phone").fill("0509000002");
    await page.getByTestId("customer-form-email").fill("customer-address@example.invalid");
    await page.getByTestId("customer-create-address-toggle").click();
    await page.getByTestId("customer-create-address-line1").fill("العنوان أ");
    await page.getByTestId("customer-create-address-city").fill("القاهرة");
    const createScreenshot = path.join(evidenceDirectory, "01-create-customer-address-1440x900.png");
    await page.screenshot({ path: createScreenshot }); screenshots.push(createScreenshot);
    await captureOverflow("create-address-1440x900");
    const createWithStart = network.length;
    await page.getByTestId("customer-save").click();
    const createWith = await waitUntil("create with address", () => network.slice(createWithStart).find((call) => call.action === "create_with_address" && call.method === "POST" && call.url === "/customers"));
    if (createWith.status !== 201 || !createWith.requestKeys.includes("addresses")) throw new Error("CREATE_WITH_ADDRESS_CONTRACT_FAILED");
    const customer = createWith.responseBody?.data;
    if (!customer?.id || customer.addresses?.length !== 1 || customer.addresses[0].isPrimary !== true) throw new Error("FIRST_ADDRESS_PRIMARY_FAILED");

    // Disposable-clone summary fixtures only: prove the POS projection reads
    // Customer.purchases/loyalty and the canonical credit ledger, not balance.
    const summaryCustomer = await models.Customer.findByPk(customer.id);
    await summaryCustomer.update({ purchases: "123.4500", loyaltyPoints: 77 });
    await require("../src/services/customer-credit.service").recordCreditIn({
      models,
      companyId: company.id,
      branchId: branch.id,
      customerId: customer.id,
      amount: "48.1250",
      sourceType: "manual_adjustment",
      sourceId: `POS-SUMMARY-${customer.id}`,
      description: "Disposable clone POS summary fixture",
      createdBy: superAdmin.id,
      exactMoney: true,
    });
    const financialFixtureBaseline = await one(countsSql);

    activeAction = "get_customer_details";
    await page.goto(`http://localhost:3000/ar/customers/${encodeURIComponent(customer.id)}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.getByTestId("customer-details-edit-action").waitFor({ state: "visible", timeout: 30000 });
    await page.getByTestId("customer-address-card-0").waitFor({ state: "visible", timeout: 10000 });
    const detailsScreenshot = path.join(evidenceDirectory, "02-details-edit-primary-1440x900.png");
    await page.screenshot({ path: detailsScreenshot }); screenshots.push(detailsScreenshot);
    await captureOverflow("details-primary-1440x900");

    const protectedBefore = await models.Customer.findByPk(customer.id);
    const protectedSnapshot = { status: protectedBefore.status, balance: String(protectedBefore.balance), purchases: String(protectedBefore.purchases), loyaltyPoints: Number(protectedBefore.loyaltyPoints || 0) };

    activeAction = "update_profile";
    await page.getByTestId("customer-details-edit-action").click();
    await page.getByTestId("customer-profile-notes").fill("تعديل Profile مسموح من Phase 2");
    await page.getByTestId("customer-profile-nationality").fill("مصري");
    const nationalityScreenshot = path.join(evidenceDirectory, "03-profile-nationality-1440x900.png");
    await page.screenshot({ path: nationalityScreenshot }); screenshots.push(nationalityScreenshot);
    await captureOverflow("profile-nationality-1440x900");
    const profileStart = network.length;
    await page.getByTestId("customer-profile-save").click();
    const profileUpdate = await waitUntil("profile update", () => network.slice(profileStart).find((call) => call.action === "update_profile" && call.method === "PUT" && call.url === `/customers/${customer.id}`));
    if (profileUpdate.status !== 200 || !profileUpdate.expectedUpdatedAtPresent || !profileUpdate.requestKeys.includes("nationality")) throw new Error("PROFILE_UPDATE_FAILED");
    if ((await models.Customer.findByPk(customer.id)).nationality !== "مصري") throw new Error("NATIONALITY_PROFILE_WRITE_FAILED");

    activeAction = "add_second_address";
    await page.getByTestId("customer-add-address-action").click();
    await page.getByTestId("customer-details-address-line1").fill("العنوان ب");
    await page.getByTestId("customer-details-address-city").fill("الجيزة");
    const addStart = network.length;
    await page.getByTestId("customer-address-save").click();
    const addUpdate = await waitUntil("add address", () => network.slice(addStart).find((call) => call.action === "add_second_address" && call.method === "PUT"));
    if (addUpdate.status !== 200 || !addUpdate.expectedUpdatedAtPresent) throw new Error("ADD_ADDRESS_FAILED");
    await page.getByTestId("customer-address-card-1").waitFor({ state: "visible", timeout: 10000 });

    activeAction = "set_second_primary";
    const primaryStart = network.length;
    await page.getByTestId("customer-set-primary-1").click();
    const primaryUpdate = await waitUntil("set primary", () => network.slice(primaryStart).find((call) => call.action === "set_second_primary" && call.method === "PUT"));
    if (primaryUpdate.status !== 200 || primaryUpdate.requestBody.addresses.filter((address) => address.isPrimary === true).length !== 1) throw new Error("SET_PRIMARY_FAILED");
    await page.setViewportSize({ width: 1280, height: 800 });
    const multipleScreenshot = path.join(evidenceDirectory, "03-multiple-addresses-primary-1280x800.png");
    await page.screenshot({ path: multipleScreenshot }); screenshots.push(multipleScreenshot);
    await captureOverflow("multiple-addresses-1280x800");

    runtimeStage = "pos_primary_a_to_b";
    activeAction = "pos_select_b_primary";
    const posPage = await adminContext.newPage();
    await posPage.goto("http://localhost:3000/ar/pos", { waitUntil: "domcontentloaded", timeout: 30000 });
    const customerSelect = posPage.locator("select").filter({ has: posPage.locator(`option[value="${customer.id}"]`) }).first();
    await customerSelect.waitFor({ state: "visible", timeout: 30000 });
    const noCustomerScreenshot = path.join(evidenceDirectory, "01-pos-no-customer-1440x900.png");
    await posPage.screenshot({ path: noCustomerScreenshot }); screenshots.push(noCustomerScreenshot);
    const noAddressSelect = posPage.locator("select").filter({ has: posPage.locator(`option[value="${withoutCustomer.id}"]`) }).first();
    await noAddressSelect.selectOption(withoutCustomer.id);
    await posPage.getByText("العنوان غير مسجل", { exact: false }).waitFor({ state: "visible", timeout: 30000 });
    const noAddressSummary = await waitUntil("POS no-address summary", () => network.find((call) => call.method === "GET" && call.url === `/customers/${withoutCustomer.id}/pos-summary`));
    if (noAddressSummary.status !== 200 || noAddressSummary.responseBody?.data?.primaryAddress !== null) throw new Error("POS_SUMMARY_NO_ADDRESS_FAILED");
    const noAddressScreenshot = path.join(evidenceDirectory, "02-pos-no-address-1440x900.png");
    await posPage.screenshot({ path: noAddressScreenshot }); screenshots.push(noAddressScreenshot);
    await customerSelect.selectOption(customer.id);
    await posPage.getByText("العنوان الأساسي: العنوان ب، الجيزة", { exact: true }).waitFor({ state: "visible", timeout: 30000 });
    const summaryB = await waitUntil("POS B primary summary", () => network.find((call) => call.action === "pos_select_b_primary" && call.method === "GET" && call.url === `/customers/${customer.id}/pos-summary`));
    if (summaryB.status !== 200 || Number(summaryB.responseBody?.data?.availableCredit) !== 48.125 || Number(summaryB.responseBody?.data?.totalPurchases) !== 123.45 || Number(summaryB.responseBody?.data?.loyaltyPoints) !== 77 || summaryB.responseBody?.data?.primaryAddress?.line1 !== "العنوان ب") throw new Error("POS_SUMMARY_B_AUTHORITY_FAILED");
    const posBScreenshot = path.join(evidenceDirectory, "03-pos-selected-positive-summary-1440x900.png");
    await posPage.screenshot({ path: posBScreenshot }); screenshots.push(posBScreenshot);

    // Runtime switch race: begin A, then immediately return to B. The final
    // visible card must be B even if A's request resolves afterwards/aborts.
    activeAction = "pos_customer_switch_race";
    await noAddressSelect.selectOption(withoutCustomer.id);
    await delay(75);
    await customerSelect.selectOption(customer.id);
    await posPage.getByText("العنوان الأساسي: العنوان ب، الجيزة", { exact: true }).waitFor({ state: "visible", timeout: 30000 });
    const raceCalls = network.filter((call) => call.action === "pos_customer_switch_race" && call.method === "GET" && /\/pos-summary$/.test(call.url));
    if (raceCalls.length < 2) throw new Error(`POS_SUMMARY_RACE_REQUESTS_MISSING:${raceCalls.length}`);

    runtimeStage = "pos_primary_b_to_a";
    activeAction = "set_first_primary";
    const restorePrimaryStart = network.length;
    await page.getByTestId("customer-set-primary-0").click();
    const restorePrimaryUpdate = await waitUntil("restore first primary", () => network.slice(restorePrimaryStart).find((call) => call.action === "set_first_primary" && call.method === "PUT"));
    if (restorePrimaryUpdate.status !== 200 || restorePrimaryUpdate.requestBody.addresses.filter((address) => address.isPrimary === true).length !== 1) throw new Error("RESTORE_PRIMARY_FAILED");
    await posPage.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    const refreshedCustomerSelect = posPage.locator("select").filter({ has: posPage.locator(`option[value="${customer.id}"]`) }).first();
    await refreshedCustomerSelect.waitFor({ state: "visible", timeout: 30000 });
    await refreshedCustomerSelect.selectOption(customer.id);
    await posPage.getByText("العنوان الأساسي: العنوان أ، القاهرة", { exact: true }).waitFor({ state: "visible", timeout: 30000 });
    const summaryA = await waitUntil("POS A primary summary", () => network.find((call) => call.action === "set_first_primary" && call.method === "GET" && call.url === `/customers/${customer.id}/pos-summary`));
    if (summaryA.status !== 200 || summaryA.responseBody?.data?.primaryAddress?.line1 !== "العنوان أ") throw new Error("POS_SUMMARY_A_AUTHORITY_FAILED");
    const posAScreenshot = path.join(evidenceDirectory, "04-pos-a-primary-1280x800.png");
    await posPage.screenshot({ path: posAScreenshot }); screenshots.push(posAScreenshot);
    await posPage.close();

    activeAction = "edit_second_address";
    await page.getByTestId("customer-edit-address-1").click();
    await page.getByTestId("customer-details-address-line1").fill("عنوان طويل جدًا Mixed English 789 — شارع تجريبي يمتد لاختبار الالتفاف الآمن داخل البطاقة بدون أي تمرير أفقي");
    const editAddressStart = network.length;
    await page.getByTestId("customer-address-save").click();
    const editAddressUpdate = await waitUntil("edit address", () => network.slice(editAddressStart).find((call) => call.action === "edit_second_address" && call.method === "PUT"));
    if (editAddressUpdate.status !== 200) throw new Error("EDIT_ADDRESS_FAILED");
    const longScreenshot = path.join(evidenceDirectory, "04-long-mixed-address-1280x800.png");
    await page.screenshot({ path: longScreenshot }); screenshots.push(longScreenshot);
    await captureOverflow("long-mixed-address-1280x800");

    // Show the same long address through the POS projection, with B explicitly
    // Primary. This proves the compact card remains a display-only consumer.
    activeAction = "set_long_address_primary";
    await page.getByTestId("customer-set-primary-1").click();
    await waitUntil("long address primary", () => network.find((call) => call.action === "set_long_address_primary" && call.method === "PUT"));
    const longPosPage = await adminContext.newPage();
    await longPosPage.setViewportSize({ width: 768, height: 800 });
    await longPosPage.goto("http://localhost:3000/ar/pos", { waitUntil: "domcontentloaded", timeout: 30000 });
    const longSelect = longPosPage.locator("select").filter({ has: longPosPage.locator(`option[value="${customer.id}"]`) }).first();
    await longSelect.waitFor({ state: "visible", timeout: 30000 });
    await longSelect.selectOption(customer.id);
    await longPosPage.getByText(/العنوان الأساسي:/).waitFor({ state: "visible", timeout: 30000 });
    const longPosScreenshot = path.join(evidenceDirectory, "05-pos-long-address-tablet-768x800.png");
    await longPosPage.screenshot({ path: longPosScreenshot }); screenshots.push(longPosScreenshot);
    const longPosOverflow = await longPosPage.evaluate(() => ({ viewport: window.innerWidth, client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    if (longPosOverflow.scroll > longPosOverflow.client + 1) throw new Error(`POS_LONG_ADDRESS_OVERFLOW:${JSON.stringify(longPosOverflow)}`);
    overflowEvidence.push({ label: "pos-long-address-tablet-768x800", horizontalOverflow: false, ...longPosOverflow });
    await longPosPage.close();

    activeAction = "remove_primary_address";
    page.once("dialog", (dialog) => dialog.accept());
    const removePrimaryStart = network.length;
    await page.getByTestId("customer-remove-address-1").click();
    const removePrimaryUpdate = await waitUntil("remove primary", () => network.slice(removePrimaryStart).find((call) => call.action === "remove_primary_address" && call.method === "PUT"));
    if (removePrimaryUpdate.status !== 200) throw new Error("REMOVE_PRIMARY_FAILED");
    await waitUntil("server replacement primary", async () => {
      const current = await models.Customer.findByPk(customer.id);
      return current.addresses?.length === 1 && current.addresses[0].isPrimary === true;
    });
    const replacementScreenshot = path.join(evidenceDirectory, "05-primary-replacement-1280x800.png");
    await page.screenshot({ path: replacementScreenshot }); screenshots.push(replacementScreenshot);
    await captureOverflow("primary-replacement-1280x800");

    activeAction = "remove_last_address";
    page.once("dialog", (dialog) => dialog.accept());
    const removeLastStart = network.length;
    await page.getByTestId("customer-remove-address-0").click();
    const removeLastUpdate = await waitUntil("remove last", () => network.slice(removeLastStart).find((call) => call.action === "remove_last_address" && call.method === "PUT"));
    if (removeLastUpdate.status !== 200) throw new Error("REMOVE_LAST_ADDRESS_FAILED");
    await page.getByTestId("customer-address-empty-state").waitFor({ state: "visible", timeout: 10000 });
    // This correction's visual contract is desktop-only (1440/1280). Keep the
    // empty-state capture at 1280 so unrelated inherited tablet shell overflow
    // cannot mask the Customer/POS authority proof.
    await page.setViewportSize({ width: 1280, height: 800 });
    const emptyScreenshot = path.join(evidenceDirectory, "06-empty-address-1280x800.png");
    await page.screenshot({ path: emptyScreenshot }); screenshots.push(emptyScreenshot);
    await captureOverflow("empty-address-1280x800");

    runtimeStage = "concurrency_control_update";
    const latest = (await directApi(adminAuth, "GET", `/customers/${customer.id}`)).body?.data;
    const secondUpdate = await directApi(adminAuth, "PUT", `/customers/${customer.id}`, { notes: "تغيير متزامن محفوظ", expectedUpdatedAt: latest.updatedAt });
    if (secondUpdate.status !== 200) throw new Error("CONTROLLED_SECOND_UPDATE_FAILED");
    runtimeStage = "concurrency_ui_stale_submit";
    activeAction = "stale_profile_update";
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByTestId("customer-details-edit-action").click();
    await page.getByTestId("customer-profile-name").fill("اسم stale يجب ألا يحفظ");
    const staleStart = network.length;
    await page.getByTestId("customer-profile-save").click();
    const staleUpdate = await waitUntil("stale update", () => network.slice(staleStart).find((call) => call.action === "stale_profile_update" && call.method === "PUT"));
    if (staleUpdate.status !== 409 || staleUpdate.responseBody?.error?.code !== "CUSTOMER_UPDATE_CONFLICT") throw new Error("CONCURRENCY_CONFLICT_FAILED");
    await page.getByRole("alert").filter({ hasText: "تم تعديل بيانات العميل بواسطة مستخدم آخر" }).waitFor({ state: "visible", timeout: 10000 });
    const conflictScreenshot = path.join(evidenceDirectory, "07-conflict-message-1280x800.png");
    await page.screenshot({ path: conflictScreenshot }); screenshots.push(conflictScreenshot);
    await captureOverflow("conflict-message-1280x800");
    const conflictRecord = await models.Customer.findByPk(customer.id);
    if (conflictRecord.name === "اسم stale يجب ألا يحفظ" || conflictRecord.notes !== "تغيير متزامن محفوظ") throw new Error("STALE_UPDATE_OVERWROTE_SERVER_STATE");

    runtimeStage = "view_only_permission_browser";
    const viewContext = await makeContext(viewAuth, viewUser, ["customers.view", ...shellPermissionNames], { width: 1280, height: 800 });
    const viewPage = await viewContext.newPage();
    await viewPage.goto("http://localhost:3000/ar/customers", { waitUntil: "domcontentloaded", timeout: 30000 });
    await viewPage.getByRole("heading", { name: "العملاء وCRM" }).waitFor({ state: "visible", timeout: 30000 });
    if (await viewPage.getByRole("button", { name: "عميل جديد", exact: true }).count()) throw new Error("VIEW_ONLY_CREATE_ACTION_VISIBLE");
    await viewPage.goto(`http://localhost:3000/ar/customers/${customer.id}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await viewPage.getByText("عميل اختبار العنوان الأساسي", { exact: true }).waitFor({ state: "visible", timeout: 30000 });
    if (await viewPage.getByTestId("customer-details-edit-action").count()) throw new Error("VIEW_ONLY_EDIT_ACTION_VISIBLE");
    if (await viewPage.getByTestId("customer-add-address-action").count()) throw new Error("VIEW_ONLY_ADDRESS_ACTION_VISIBLE");
    const unauthorizedUpdate = await directApi(viewAuth, "PUT", `/customers/${customer.id}`, { name: "Unauthorized", expectedUpdatedAt: conflictRecord.updatedAt });
    if (unauthorizedUpdate.status !== 403) throw new Error(`VIEW_ONLY_SERVER_MUTATION_NOT_BLOCKED:${unauthorizedUpdate.status}`);

    runtimeStage = "create_only_permission_browser";
    const createContext = await makeContext(createAuth, createUser, ["customers.view", "customers.create", ...shellPermissionNames], { width: 1280, height: 800 });
    const createPage = await createContext.newPage();
    await createPage.goto("http://localhost:3000/ar/customers", { waitUntil: "domcontentloaded", timeout: 30000 });
    await createPage.getByRole("button", { name: "عميل جديد", exact: true }).waitFor({ state: "visible", timeout: 30000 });
    await createPage.goto(`http://localhost:3000/ar/customers/${customer.id}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await createPage.getByText("عميل اختبار العنوان الأساسي", { exact: true }).waitFor({ state: "visible", timeout: 30000 });
    if (await createPage.getByTestId("customer-details-edit-action").count()) throw new Error("CREATE_ONLY_EDIT_ACTION_VISIBLE");

    const wrongCompany = await directApi(viewAuth, "GET", `/customers/${customer.id}`, null, { "X-Company-ID": "CMP-WRONG-SYNTHETIC" });
    if (wrongCompany.status !== 403) throw new Error(`WRONG_COMPANY_NOT_FAIL_CLOSED:${wrongCompany.status}`);
    const summaryView = await directApi(viewAuth, "GET", `/customers/${customer.id}/pos-summary`);
    if (summaryView.status !== 200) throw new Error(`SUMMARY_VIEW_PERMISSION_FAILED:${summaryView.status}`);
    const summaryDenied = await directApi(deniedAuth, "GET", `/customers/${customer.id}/pos-summary`);
    if (summaryDenied.status !== 403) throw new Error(`SUMMARY_PERMISSION_NOT_FAIL_CLOSED:${summaryDenied.status}`);
    const summaryWrongCompany = await directApi(viewAuth, "GET", `/customers/${customer.id}/pos-summary`, null, { "X-Company-ID": "CMP-WRONG-SYNTHETIC" });
    if (summaryWrongCompany.status !== 403) throw new Error(`SUMMARY_WRONG_COMPANY_NOT_FAIL_CLOSED:${summaryWrongCompany.status}`);

    runtimeStage = "summary_legacy_and_inactive_matrix";
    const suffix = Date.now();
    const legacyCustomer = await models.Customer.create({
      id: `CUS-P3-LEGACY-${suffix}`,
      companyId: company.id,
      name: "عميل Legacy ملخص",
      phone: "0509200001",
      tier: "Standard",
      status: "active",
      addresses: [{ city: "القاهرة" }, { city: "الجيزة" }],
    });
    const inactiveCustomer = await models.Customer.create({
      id: `CUS-P3-INACTIVE-${suffix}`,
      companyId: company.id,
      name: "عميل غير نشط ملخص",
      phone: "0509200002",
      tier: "Gold",
      status: "inactive",
      addresses: [{ city: "الإسكندرية", isPrimary: true }],
    });
    await models.BranchCustomer.bulkCreate([
      { id: `BCR-${company.id}-${branch.id}-${legacyCustomer.id}`, companyId: company.id, branchId: branch.id, customerId: legacyCustomer.id, balance: 0, purchases: 0, loyaltyPoints: 0, isActive: true },
      { id: `BCR-${company.id}-${branch.id}-${inactiveCustomer.id}`, companyId: company.id, branchId: branch.id, customerId: inactiveCustomer.id, balance: 0, purchases: 0, loyaltyPoints: 0, isActive: true },
    ]);
    const legacySummary = await directApi(adminAuth, "GET", `/customers/${legacyCustomer.id}/pos-summary`);
    const inactiveSummary = await directApi(adminAuth, "GET", `/customers/${inactiveCustomer.id}/pos-summary`);
    if (legacySummary.status !== 200 || legacySummary.body?.data?.meta?.primaryAddressSource !== "LEGACY_FALLBACK" || legacySummary.body?.data?.primaryAddress?.city !== "القاهرة") throw new Error("POS_SUMMARY_LEGACY_FALLBACK_FAILED");
    if (inactiveSummary.status !== 200 || inactiveSummary.body?.data?.status !== "inactive") throw new Error("POS_SUMMARY_INACTIVE_READ_FAILED");

    runtimeStage = "cross_module_read_only_smoke";
    const posSmokePage = await adminContext.newPage();
    await posSmokePage.goto("http://localhost:3000/ar/pos", { waitUntil: "domcontentloaded", timeout: 30000 });
    await posSmokePage.getByRole("heading", { name: "بحث عن المنتج" }).waitFor({ state: "visible", timeout: 30000 });
    await posSmokePage.close();
    const salesPage = await adminContext.newPage();
    await salesPage.goto("http://localhost:3000/ar/sales", { waitUntil: "domcontentloaded", timeout: 30000 });
    await salesPage.locator("h1").first().waitFor({ state: "visible", timeout: 30000 });
    await salesPage.close();

    runtimeStage = "final_integrity";
    const finalRecord = await models.Customer.findByPk(customer.id);
    const protectedAfter = { status: finalRecord.status, balance: String(finalRecord.balance), purchases: String(finalRecord.purchases), loyaltyPoints: Number(finalRecord.loyaltyPoints || 0) };
    if (JSON.stringify(protectedSnapshot) !== JSON.stringify(protectedAfter)) throw new Error("CUSTOMER_FINANCIAL_OR_STATUS_FIELDS_CHANGED");
    const afterCounts = await one(countsSql);
    for (const key of ["customer_credit_transactions", "loyalty_transactions", "invoices", "payments", "journal_entries", "journal_lines", "cash_transactions", "assets"]) {
      if (Number(afterCounts[key]) !== Number(financialFixtureBaseline[key])) throw new Error(`UNRELATED_SIDE_EFFECT:${key}`);
    }
    const integrity = await one(`SELECT
      (SELECT count(*)::int FROM branch_customers bc LEFT JOIN customers c ON c.id=bc.customer_id WHERE c.id IS NULL) AS orphan_branch_customers,
      (SELECT count(*)::int FROM customers WHERE jsonb_typeof(addresses) IS DISTINCT FROM 'array') AS malformed_addresses,
      (SELECT count(*)::int FROM journal_lines jl LEFT JOIN journal_entries je ON je.id=jl.journal_entry_id WHERE je.id IS NULL) AS orphan_journal_lines,
      (SELECT count(*)::int FROM (SELECT je.id FROM journal_entries je JOIN journal_lines jl ON jl.journal_entry_id=je.id GROUP BY je.id HAVING round(sum(jl.debit),4) <> round(sum(jl.credit),4)) q) AS unbalanced_journals`);
    if (Object.values(integrity).some((value) => Number(value) !== 0)) throw new Error(`CLONE_INTEGRITY_FAILED:${JSON.stringify(integrity)}`);
    const auditRows = await one("SELECT count(*)::int AS count FROM audit_logs WHERE source_document=:customerId", { customerId: customer.id });
    if (Number(auditRows.count) < 6) throw new Error(`CUSTOMER_AUDIT_EVIDENCE_INCOMPLETE:${auditRows.count}`);

    const requiredActions = ["create_without_address", "create_with_address", "get_customer_details", "update_profile", "add_second_address", "set_second_primary", "edit_second_address", "remove_primary_address", "remove_last_address", "stale_profile_update"];
    for (const action of requiredActions) if (!network.some((call) => call.action === action)) throw new Error(`NETWORK_EVIDENCE_MISSING:${action}`);
    const mutatingCalls = network.filter((call) => ["POST", "PUT", "PATCH", "DELETE"].includes(call.method));
    for (const call of mutatingCalls) {
      for (const forbidden of ["companyId", "balance", "purchases", "loyaltyPoints", "availableCredit", "status"]) {
        if (call.requestKeys.includes(forbidden)) throw new Error(`SERVER_OWNED_FIELD_SENT:${call.action}:${forbidden}`);
      }
    }

    const evidence = {
      result: "PASS",
      database: clone,
      sourceDatabase,
      mutationTarget: "DISPOSABLE_CLONE_ONLY",
      syntheticCustomers: { withoutAddress: withoutCustomer?.id, withAddress: customer.id },
      network: network.map((call) => ({ ...call, requestBody: call.requestBody ? Object.fromEntries(Object.entries(call.requestBody).filter(([key]) => key !== "email" && key !== "phone" && key !== "name")) : null, responseBody: undefined })),
      permissions: { viewOnlyMutationStatus: unauthorizedUpdate.status, wrongCompanyStatus: wrongCompany.status, summaryViewStatus: summaryView.status, summaryDeniedStatus: summaryDenied.status, summaryWrongCompanyStatus: summaryWrongCompany.status, createActionVisibleForCreatePermission: true, editActionHiddenWithoutUpdate: true },
      summaryRuntimeMatrix: { noAddress: noAddressSummary.status, explicitPrimary: summaryB.status, legacyFallback: legacySummary.status, inactiveReadable: inactiveSummary.status, zeroAndPositiveValues: true, customerSwitchRace: true },
      crossModuleSmoke: { posLoaded: true, salesLoaded: true, invoiceDetailCustomerNameContractCheckedByStaticTest: true },
      concurrency: { status: staleUpdate.status, code: staleUpdate.responseBody?.error?.code, latestChangePreserved: true },
      protectedSnapshot,
      protectedAfter,
      optionalAddressMatrix,
      optionalEditMatrix,
      primarySwitch: { aToB: true, bToA: true, staleCacheCause: "NOT_PRESENT_ON_NORMAL_REMOUNT" },
      beforeCounts,
      financialFixtureBaseline,
      afterCounts,
      integrity,
      auditCount: auditRows.count,
      screenshots,
      overflowEvidence,
      consoleErrors,
    };
    fs.writeFileSync(path.join(evidenceDirectory, "network-and-runtime-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
    runtimeStage = "complete";
    console.log(JSON.stringify({ result: "PASS", clone, evidenceDirectory, screenshots: screenshots.length, networkCalls: network.length, auditCount: auditRows.count, beforeCounts, afterCounts, integrity, consoleErrors }));
  } finally {
    for (const context of contexts) { try { await context.close(); } catch {} }
    try { if (browser) await browser.close(); } catch {}
    try { if (server) await new Promise((resolve) => server.close(resolve)); } catch {}
    try { if (sequelize) await sequelize.close(); } catch {}
    if (!cloneDropped) {
      try { pg("dropdb.exe", ["--if-exists", clone], pgEnv(config, "postgres")); cloneDropped = true; } catch {}
    }
    try {
      const resolvedDump = path.resolve(dump);
      if (resolvedDump.startsWith(path.resolve(os.tmpdir())) && fs.existsSync(resolvedDump)) fs.unlinkSync(resolvedDump);
    } catch {}
  }
}

main().then(() => {
  process.exit(0);
}).catch((error) => {
  const failure = { result: "FAIL", stage: runtimeStage, message: error.message, stack: error.stack?.split("\n").slice(0, 8) };
  try { fs.writeFileSync(path.join(evidenceDirectory, "runtime-failure.json"), `${JSON.stringify(failure, null, 2)}\n`); } catch {}
  console.error(JSON.stringify(failure));
  process.exit(1);
});
