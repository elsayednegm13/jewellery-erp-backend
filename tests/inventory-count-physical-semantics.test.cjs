"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { Op } = require("sequelize");
const inventoryAuditCanonicalService = require("../src/services/inventory-audit-canonical.service.js");

function makeAudit() {
  return {
    id: "AUDIT-3-ASSETS",
    companyId: "COMPANY-1",
    branchId: "BRANCH-1",
    locationId: "LOCATION-1",
    status: "draft",
    async update(values) {
      Object.assign(this, values);
      return this;
    },
    toJSON() {
      return { ...this };
    },
  };
}

function makeAsset(id, barcode) {
  return {
    id,
    barcode,
    companyId: "COMPANY-1",
    branchId: "BRANCH-1",
    locationId: "LOCATION-1",
    operationalStatus: "AVAILABLE",
  };
}

function makeModels() {
  const audit = makeAudit();
  const assets = [
    makeAsset("ASSET-1", "COUNT-001"),
    makeAsset("ASSET-2", "COUNT-002"),
    makeAsset("ASSET-3", "COUNT-003"),
  ];
  const items = [];
  const item = (values) => ({
    ...values,
    async update(next) {
      Object.assign(this, next);
      return this;
    },
  });

  const models = {
    StockAudit: {
      async findOne() {
        return audit;
      },
    },
    StockAuditItem: {
      async create(values) {
        const created = item(values);
        items.push(created);
        return created;
      },
      async findOne({ where }) {
        return items.find((candidate) => candidate.stockAuditId === where.stockAuditId && candidate.assetId === where.assetId) || null;
      },
      async update(values, { where }) {
        const targets = items.filter((candidate) => candidate.stockAuditId === where.stockAuditId && candidate.result === null);
        for (const target of targets) Object.assign(target, values);
        return [targets.length];
      },
      async count() {
        return items.length;
      },
    },
    Asset: {
      async findAll({ where }) {
        const requested = Object.getOwnPropertySymbols(where || [])
          .map((key) => where[key])
          .flatMap((conditions) => conditions || [])
          .flatMap((condition) => Object.values(condition || []))
          .flatMap((values) => (Array.isArray(values) ? values : [values]))
          .map((value) => String(value));
        if (!requested.length) return assets;
        return assets.filter((asset) => requested.includes(String(asset.id)) || requested.includes(String(asset.barcode)));
      },
    },
  };

  return { models, audit, assets, items, Op };
}

test("Expected=3, Observe=1, Complete produces Matched=1 and Missing=2", async () => {
  const { models, audit, assets, items } = makeModels();
  const transaction = {};

  const started = await inventoryAuditCanonicalService.startAudit({
    models,
    companyId: "COMPANY-1",
    branchId: "BRANCH-1",
    auditId: audit.id,
    transaction,
  });

  assert.equal(started.expectedCount, 3);
  assert.deepEqual(items.map(({ assetId, status, result, observedAt, scanMethod }) => ({ assetId, status, result, observedAt, scanMethod })), [
    { assetId: "ASSET-1", status: "missing", result: null, observedAt: undefined, scanMethod: undefined },
    { assetId: "ASSET-2", status: "missing", result: null, observedAt: undefined, scanMethod: undefined },
    { assetId: "ASSET-3", status: "missing", result: null, observedAt: undefined, scanMethod: undefined },
  ]);

  const snapshotAssetIds = items.map((entry) => entry.assetId);
  const observed = await inventoryAuditCanonicalService.observeAudit({
    models,
    companyId: "COMPANY-1",
    branchId: "BRANCH-1",
    auditId: audit.id,
    assetIds: [assets[0].id],
    method: "BARCODE_SCAN",
    transaction,
  });
  assert.equal(observed.observed.length, 1);
  assert.equal(observed.observed[0].result, "MATCHED");

  const beforeComplete = items.map(({ assetId, status, result, observedAt, scanMethod }) => ({ assetId, status, result, observedAt, scanMethod }));
  assert.equal(beforeComplete.filter((entry) => entry.result === "MATCHED").length, 1);
  assert.equal(beforeComplete.filter((entry) => entry.result === null).length, 2);
  assert.equal(beforeComplete.filter((entry) => entry.scanMethod === "BARCODE_SCAN").length, 1);

  await inventoryAuditCanonicalService.completeAudit({
    models,
    companyId: "COMPANY-1",
    branchId: "BRANCH-1",
    auditId: audit.id,
    transaction,
  });

  const matched = items.filter((entry) => entry.result === "MATCHED");
  const missing = items.filter((entry) => entry.result === "MISSING");
  const unexpected = items.filter((entry) => entry.result === "EXTRA");
  assert.equal(matched.length, 1);
  assert.equal(missing.length, 2);
  assert.equal(unexpected.length, 0);
  assert.equal(missing.filter((entry) => entry.scanMethod === "BARCODE_SCAN").length, 0);
  assert.equal(missing.every((entry) => entry.observedAt instanceof Date), true);
  assert.deepEqual(items.map((entry) => entry.assetId), snapshotAssetIds);
  assert.deepEqual(assets.map(({ id, barcode, operationalStatus, branchId, locationId }) => ({ id, barcode, operationalStatus, branchId, locationId })), [
    { id: "ASSET-1", barcode: "COUNT-001", operationalStatus: "AVAILABLE", branchId: "BRANCH-1", locationId: "LOCATION-1" },
    { id: "ASSET-2", barcode: "COUNT-002", operationalStatus: "AVAILABLE", branchId: "BRANCH-1", locationId: "LOCATION-1" },
    { id: "ASSET-3", barcode: "COUNT-003", operationalStatus: "AVAILABLE", branchId: "BRANCH-1", locationId: "LOCATION-1" },
  ]);
});

