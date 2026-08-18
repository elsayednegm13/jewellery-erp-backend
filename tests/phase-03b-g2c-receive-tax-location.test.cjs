const test = require("node:test");
const assert = require("node:assert/strict");

const receiveContract = require("../src/services/supplier-receive-contract.service");

const base = () => ({
  taxTreatment: "STANDARD_VAT",
  locationId: "LOC-ACTIVE",
  inventoryV2: true,
  items: [{
    name: "Synthetic G2C Gold By Weight",
    quantity: 1,
    perPiece: [{
      profile: "GOLD_BY_WEIGHT_JEWELLERY",
      description: "Synthetic G2C Gold By Weight",
      grossWeight: 1,
      karat: 21,
      purchaseCost: 100,
      locationId: "LOC-ACTIVE",
    }],
  }],
});

test("G2C requires an explicit supported tax treatment", () => {
  const request = base();
  delete request.taxTreatment;
  assert.throws(
    () => receiveContract.assertCanonicalReceiveInput({ body: request, items: request.items, requestBranchId: "BR-A" }),
    (error) => error.errorCode === "TAX_TREATMENT_REQUIRED"
  );
  assert.throws(
    () => receiveContract.assertCanonicalReceiveInput({ body: { ...request, taxTreatment: "CLIENT_DEFAULT" }, items: request.items, requestBranchId: "BR-A" }),
    (error) => error.errorCode === "TAX_TREATMENT_UNSUPPORTED"
  );
});

test("G2C rejects free-text/default locations and requires a locationId", () => {
  const request = base();
  assert.throws(
    () => receiveContract.assertCanonicalReceiveInput({ body: { ...request, location: "Showroom" }, items: request.items, requestBranchId: "BR-A" }),
    (error) => error.errorCode === "LOCATION_FREE_TEXT_FORBIDDEN"
  );
  const missing = { ...request, locationId: "" };
  const items = missing.items.map((item) => ({ ...item, perPiece: item.perPiece.map((piece) => ({ ...piece, locationId: "" })) }));
  assert.throws(
    () => receiveContract.assertCanonicalReceiveInput({ body: missing, items, requestBranchId: "BR-A" }),
    (error) => error.errorCode === "LOCATION_ID_REQUIRED"
  );
});

test("G2C keeps branch/company context server-authoritative", () => {
  const request = base();
  assert.equal(
    receiveContract.assertCanonicalReceiveInput({ body: request, items: request.items, requestBranchId: "BR-A" }).branchId,
    "BR-A"
  );
  assert.throws(
    () => receiveContract.assertCanonicalReceiveInput({ body: { ...request, branchId: "BR-B" }, items: request.items, requestBranchId: "BR-A" }),
    (error) => error.errorCode === "BRANCH_SCOPE_FORBIDDEN"
  );
});

test("G2C resolves only an active database Location in the current scope", async () => {
  const request = base();
  const fakeRow = { id: "LOC-ACTIVE", name: "QA-G2C-LOCATION", code: "QA-G2C-LOC", isActive: true };
  const models = {
    InventoryLocation: {
      findOne: async ({ where }) => where.id === fakeRow.id && where.companyId === "CO-A" && where.branchId === "BR-A" ? fakeRow : null,
    },
  };
  const result = await receiveContract.resolveAndCanonicalizeLocations({
    models,
    companyId: "CO-A",
    branchId: "BR-A",
    body: request,
    items: request.items,
  });
  assert.equal(result.items[0].perPiece[0].locationId, "LOC-ACTIVE");
  assert.equal(result.items[0].perPiece[0].location, "QA-G2C-LOCATION");
  await assert.rejects(
    receiveContract.resolveAndCanonicalizeLocations({
      models,
      companyId: "CO-A",
      branchId: "BR-A",
      body: { ...request, locationId: "LOC-INACTIVE" },
      items: request.items.map((item) => ({ ...item, perPiece: item.perPiece.map((piece) => ({ ...piece, locationId: "LOC-INACTIVE" })) })),
    }),
    (error) => error.errorCode === "LOCATION_NOT_FOUND_OR_INACTIVE"
  );
});
