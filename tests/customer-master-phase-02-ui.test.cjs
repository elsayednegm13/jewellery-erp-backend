const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function loadAddressUi() {
  const fileName = path.join(root, "lib/customers/address-ui.ts");
  const source = fs.readFileSync(fileName, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName,
  }).outputText;
  const mod = new Module(fileName, module);
  mod.filename = fileName;
  mod.paths = Module._nodeModulePaths(path.dirname(fileName));
  mod._compile(output, fileName);
  return mod.exports;
}

const addressUi = loadAddressUi();

test("optional Customer Create address does not treat a blank block as an address", () => {
  const validation = addressUi.validateCustomerAddressDraft(addressUi.emptyCustomerAddressDraft());
  assert.deepEqual(validation, { valid: true, started: false, missing: [] });
});

test("every meaningful partial address is valid and whole blanks stay out of payloads", () => {
  for (const partial of [
    { line1: "شارع الاختبار" },
    { city: "القاهرة" },
    { country: "مصر" },
    { postalCode: "11511" },
  ]) {
    const draft = { ...addressUi.emptyCustomerAddressDraft(), ...partial };
    assert.deepEqual(addressUi.validateCustomerAddressDraft(draft), { valid: true, started: true, missing: [] });
    assert.match(addressUi.formatCustomerAddress(addressUi.customerAddressFromDraft(draft)), /\S/);
  }
});

test("address helpers keep one explicit Primary and leave replacement choice to the server after deletion", () => {
  const first = { line1: "A", city: "Dubai", country: "UAE", isPrimary: true };
  const second = { line1: "B", city: "Cairo", country: "Egypt", isPrimary: false };
  const promoted = addressUi.setPrimaryCustomerAddress([first, second], 1);
  assert.deepEqual(promoted.map((address) => address.isPrimary), [false, true]);
  const remaining = addressUi.removeCustomerAddress(promoted, 1);
  assert.deepEqual(remaining.map((address) => address.isPrimary), [false]);
});

test("legacy fallback display is truthful and never labeled explicit Primary", () => {
  const legacy = [
    { line1: "Legacy A", city: "Dubai", country: "UAE" },
    { line1: "Legacy B", city: "Sharjah", country: "UAE" },
  ];
  assert.equal(addressUi.customerAddressDisplayMarker(legacy, 0), "CURRENT_COMPATIBILITY");
  assert.equal(addressUi.customerAddressDisplayMarker(legacy, 1), null);
});

test("shared resolver gives explicit Primary priority over array order for POS", () => {
  const addresses = [
    { line1: "العنوان أ", city: "القاهرة", isPrimary: false },
    { line1: "العنوان ب", city: "الجيزة", isPrimary: true },
  ];
  const resolved = addressUi.resolveCustomerPrimaryAddress(addresses);
  assert.equal(resolved.source, "EXPLICIT_PRIMARY");
  assert.equal(resolved.index, 1);
  assert.equal(addressUi.formatCustomerAddress(resolved.primaryAddress), "العنوان ب، الجيزة");
});

test("Customer Create UI uses optional Address contract and omits server-owned fields", () => {
  const source = read("app/[locale]/(dashboard)/customers/page.tsx");
  assert.match(source, /customer-create-address-section/);
  assert.match(source, /validateCustomerAddressDraft\(addressDraft\)/);
  assert.match(source, /includeAddress && addressValidation\.started \? \{ addresses: \[initialAddress\] \} : \{\}/);
  const createStart = source.indexOf("const res = await addCustomer({");
  const createEnd = source.indexOf("});", createStart);
  const payload = source.slice(createStart, createEnd);
  for (const field of ["balance", "purchases", "loyaltyPoints", "availableCredit", "status", "companyId"]) {
    assert.doesNotMatch(payload, new RegExp(`\\b${field}\\b`));
  }
});

test("Customer Details exposes permission-gated profile and address actions only", () => {
  const source = read("app/[locale]/(dashboard)/customers/[id]/page.tsx");
  assert.match(source, /hasPermission\("customers\.update"\)/);
  assert.match(source, /customer-details-edit-action/);
  assert.match(source, /customer-add-address-action/);
  assert.match(source, /customer-edit-address-/);
  assert.match(source, /customer-set-primary-/);
  assert.match(source, /customer-remove-address-/);
  assert.match(source, /لا توجد عناوين مسجلة/);
  assert.match(source, /العنوان المستخدم حاليًا/);
  assert.match(source, /expectedUpdatedAt/);
  assert.match(source, /CUSTOMER_UPDATE_CONFLICT/);
  assert.match(source, /تم تعديل بيانات العميل بواسطة مستخدم آخر/);
  const profileFormStart = source.indexOf('data-testid="customer-profile-edit-form"');
  const profileFormEnd = source.indexOf("</form>", profileFormStart);
  const profileForm = source.slice(profileFormStart, profileFormEnd);
  assert.doesNotMatch(profileForm, /balance|purchases|loyaltyPoints|availableCredit|companyId/);
  assert.doesNotMatch(profileForm, /customer-profile-status/);
  assert.match(profileForm, /customer-profile-nationality/);
});

test("Phase 2 keeps existing Customer endpoints and Phase 1 server contract", () => {
  const api = read("lib/repositories/api-impl.ts");
  const service = read("backend/src/services/customer-address.service.js");
  assert.match(api, /"\/customers"/);
  assert.match(api, /`\/customers\/\$\{id\}`/);
  assert.match(service, /normalizeCustomerAddresses/);
  assert.match(service, /resolvePrimaryAddress/);
  assert.match(service, /sanitizeCustomerMutation/);
});

test("POS and Invoice presentation contracts remain untouched and customerName-driven", () => {
  const pos = read("app/[locale]/(dashboard)/pos/page.tsx");
  const sales = read("app/[locale]/(dashboard)/sales/page.tsx");
  assert.match(pos, /بحث عن المنتج/);
  assert.match(sales, /description=\{selected\?\.customerName\}/);
  assert.match(sales, /\{invoice\.customerName\}/);
});
