const assert = require("node:assert/strict");
const test = require("node:test");

const baseline = require("../src/services/inventory-master-data-baseline");
const defaults = require("../src/config/barcode-defaults");
const manifest = require("../src/services/inventory-master-data-manifest");
const pearl = require("../src/services/pearl-size-master-data.service");
const auditService = require("../src/services/audit.service");
const bootstrap = require("../src/services/inventory-master-data-bootstrap.service");

function fakeModels() {
  const state = { profiles: [], pearls: [], inventoryCodes: [], itemCodes: [], sequences: [], bootstrapState: null };
  const clone = () => JSON.parse(JSON.stringify(state));
  const restore = (saved) => Object.assign(state, JSON.parse(JSON.stringify(saved)));
  const profileRows = () => state.profiles.map((row) => ({
    id: row.id, category_key: row.category_key, canonical_value: row.canonical_value,
    display_label: row.display_label, is_active: row.is_active, sort_order: row.sort_order,
  }));
  const query = async (sql, options = {}) => {
    const text = String(sql).replace(/\s+/g, " ").trim();
    const r = options.replacements || {};
    if (text.startsWith("INSERT INTO profile_master_data")) {
      const categoryKey = r.categoryKey || r.category;
      if (!state.profiles.some((row) => row.category_key === categoryKey && row.canonical_value === r.canonicalValue)) {
        state.profiles.push({ id: r.id, category_key: categoryKey, canonical_value: r.canonicalValue, display_label: r.displayLabel, is_active: true, sort_order: r.sortOrder || 100000 });
        return [[{ id: r.id }]];
      }
      return [[]];
    }
    if (text.startsWith("INSERT INTO pearl_size_master_data")) {
      if (!state.pearls.some((row) => row.value === r.value && row.unit === r.unit)) {
        state.pearls.push({ id: r.id, value: r.value, display_value: r.displayValue, unit: r.unit, is_active: true, sort_order: r.sortOrder, update: async (values) => Object.assign(state.pearls.find((row) => row.id === r.id), values) });
        return [[{ id: r.id }]];
      }
      return [[]];
    }
    if (text.startsWith("INSERT INTO barcode_inventory_codes")) {
      if (!state.inventoryCodes.some((row) => row.code === r.code)) state.inventoryCodes.push({ ...r });
      return [[]];
    }
    if (text.startsWith("INSERT INTO barcode_item_codes")) {
      if (!state.itemCodes.some((row) => row.code === r.code)) state.itemCodes.push({ ...r });
      return [[]];
    }
    if (text.startsWith("SELECT id FROM companies WHERE id=:companyId")) return [{ id: r.companyId }];
    if (text.includes("SELECT COUNT(*)::int AS count FROM profile_master_data")) return [{ count: state.profiles.length }];
    if (text.includes("SELECT COUNT(*)::int AS count FROM pearl_size_master_data")) return [{ count: state.pearls.length }];
    if (text.includes("SELECT COUNT(*)::int AS count FROM barcode_inventory_codes")) return [{ count: state.inventoryCodes.length }];
    if (text.includes("SELECT COUNT(*)::int AS count FROM barcode_item_codes")) return [{ count: state.itemCodes.length }];
    if (text.includes("SELECT COUNT(*)::int AS count FROM barcode_sequences")) return [{ count: state.sequences.length }];
    if (text.includes('SELECT category_key AS category,canonical_value AS "canonicalValue"')) return state.profiles.map((row) => ({ category: row.category_key, canonicalValue: row.canonical_value }));
    if (text.includes("SELECT value,unit,is_active FROM pearl_size_master_data")) return state.pearls.map((row) => ({ value: row.value, unit: row.unit, is_active: row.is_active }));
    if (text.includes("SELECT code FROM barcode_inventory_codes")) return state.inventoryCodes.map((row) => ({ code: row.code }));
    if (text.includes("SELECT code FROM barcode_item_codes")) return state.itemCodes.map((row) => ({ code: row.code }));
    if (text.includes("SELECT category_key AS category, COUNT(*)::int AS count FROM profile_master_data")) {
      const counts = new Map();
      for (const row of state.profiles) counts.set(row.category_key, (counts.get(row.category_key) || 0) + 1);
      return [...counts].map(([category, count]) => ({ category, count }));
    }
    if (text.includes("FROM profile_master_data WHERE company_id=:companyId AND category_key=:category AND canonical_value IN")) {
      return profileRows().filter((row) => row.category_key === r.category && r.values.includes(row.canonical_value));
    }
    if (text.includes("FROM profile_master_data WHERE id=:rowId")) return profileRows().filter((row) => row.id === r.rowId);
    throw new Error(`Unhandled fake query: ${text}`);
  };
  const models = {
    sequelize: { QueryTypes: { SELECT: "SELECT" }, query, transaction: async (run) => run({ LOCK: { UPDATE: "UPDATE" } }) },
    PearlSizeMasterData: {
      findOne: async ({ where }) => state.pearls.find((row) => (where.id ? row.id === where.id : row.value === where.value && row.unit === where.unit)) || null,
    },
    InventoryMasterDataBootstrapState: {
      findOne: async () => state.bootstrapState,
      create: async (values) => { state.bootstrapState = { ...values }; return state.bootstrapState; },
      update: async (values) => { state.bootstrapState = { ...state.bootstrapState, ...values }; return [1]; },
    },
  };
  return { models, state, clone, restore };
}

function seedExactV1(state) {
  for (const row of baseline.V1_PROFILE_MASTER_DATA_ROWS) state.profiles.push({ id: `v1:${row.category}:${row.canonicalValue}`, category_key: row.category, canonical_value: row.canonicalValue, display_label: row.displayLabel, is_active: true, sort_order: row.sortOrder });
  for (const value of pearl.INITIAL_VALUES) state.pearls.push({ id: `pearl:${value}`, value: value.toFixed(8), display_value: value.toFixed(1), unit: "MM", is_active: true, sort_order: Number(value.times(10)) });
  for (const row of defaults.DEFAULT_BARCODE_INVENTORY_CODES) state.inventoryCodes.push({ code: row.code });
  for (const row of defaults.DEFAULT_BARCODE_ITEM_CODES) state.itemCodes.push({ code: row.code });
}

function counts(state) {
  return [state.profiles.length, state.pearls.length, state.inventoryCodes.length, state.itemCodes.length, state.sequences.length];
}

test("zero baseline initializes V1 exactly before V2", async () => {
  const { models, state } = fakeModels();
  const result = await bootstrap.initializeV1Foundation({ models, companyId: "COMP-ZERO", actorId: "TEST", transaction: {} });
  assert.equal(result.mode, "INITIALIZED_V1");
  assert.deepEqual(counts(state), [502, 39, 5, 20, 0]);
});

test("exact V1 baseline is kept without reinsertion", async () => {
  const { models, state } = fakeModels();
  seedExactV1(state);
  const before = JSON.stringify(state);
  const result = await bootstrap.initializeV1Foundation({ models, companyId: "COMP-V1", actorId: "TEST", transaction: {} });
  assert.equal(result.mode, "EXISTING_V1");
  assert.equal(JSON.stringify(state), before);
});

test("partial baseline fails closed without destructive repair", async () => {
  const { models, state } = fakeModels();
  state.profiles.push({ id: "partial", category_key: "DIAMOND_CLARITY", canonical_value: "fl", display_label: "FL", is_active: true, sort_order: 100000 });
  const before = JSON.stringify(state);
  await assert.rejects(() => bootstrap.initializeV1Foundation({ models, companyId: "COMP-PARTIAL", actorId: "TEST", transaction: {} }), { errorCode: "STATE_CONFLICT" });
  assert.equal(JSON.stringify(state), before);
});

test("V2 READY replay is idempotent after V1 foundation", async () => {
  const { models, state } = fakeModels();
  seedExactV1(state);
  const originalAudit = auditService.record;
  auditService.record = async () => undefined;
  try {
    const first = await bootstrap.bootstrapInventoryMasterData({ models, companyId: "COMP-READY", actorId: "TEST", transaction: { LOCK: { UPDATE: "UPDATE" } } });
    assert.equal(first.state, "READY");
    const afterFirst = JSON.stringify(state);
    const replay = await bootstrap.bootstrapInventoryMasterData({ models, companyId: "COMP-READY", actorId: "TEST", transaction: { LOCK: { UPDATE: "UPDATE" } } });
    assert.equal(replay.replayed, true);
    assert.equal(JSON.stringify(state), afterFirst);
    assert.equal(state.sequences.length, 0);
  } finally {
    auditService.record = originalAudit;
  }
});

test("transaction rollback mechanics remove V1 foundation after injected failure", async () => {
  const { models, state, clone, restore } = fakeModels();
  models.sequelize.transaction = async (run) => {
    const before = clone();
    try { return await run({ LOCK: { UPDATE: "UPDATE" } }); } catch (error) { restore(before); throw error; }
  };
  await assert.rejects(() => models.sequelize.transaction(async (transaction) => {
    await bootstrap.initializeV1Foundation({ models, companyId: "COMP-ROLLBACK", actorId: "TEST", transaction });
    throw new Error("INJECTED_AFTER_V1");
  }), /INJECTED_AFTER_V1/);
  assert.deepEqual(counts(state), [0, 0, 0, 0, 0]);
});
