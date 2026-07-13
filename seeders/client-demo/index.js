#!/usr/bin/env node
"use strict";

/**
 * Phase 32.4-Run — deterministic, idempotent client-aligned demo INVENTORY seeder
 * (seed version client-demo-v1). Runs AFTER the committed baseline demo seeders
 * (company/branches/users/customers/suppliers/accounting), adding the ten
 * client-aligned inventory variants with proper barcode identity.
 *
 * Determinism & safety:
 *  - Final stored barcodes are allocated ONLY through the canonical
 *    `barcode-identity.service` (no Date.now()/Math.random()/second algorithm).
 *  - Idempotent: skips assets that already exist; safe to re-run from a clean DB.
 *  - Accounting-neutral: creates inventory assets only (no journal posting), so it
 *    never fabricates or unbalances accounting.
 *  - Loose-item KT is a CONFIGURED demo setting (a default karat code seeded on the
 *    inventory taxonomy), documented as a demo/testing assumption pending final
 *    client confirmation — NOT hardcoded per asset, NOT an approved production policy.
 */

const path = require("node:path");

const models = require(path.resolve(__dirname, "..", "..", "src", "models"));
const barcode = require(path.resolve(__dirname, "..", "..", "src", "services", "barcode-identity.service"));
const { DEFAULT_BARCODE_INVENTORY_CODES, DEFAULT_BARCODE_ITEM_CODES } = require(path.resolve(__dirname, "..", "..", "src", "config", "barcode-defaults"));

const SEED_VERSION = "client-demo-v1";
// Demo/testing assumption pending final client confirmation: loose diamond/gem/
// pearl items with no gold karat use this configured default karat code.
const DEMO_LOOSE_KT = "18";

async function seedTaxonomy(companyId, t) {
  for (const row of DEFAULT_BARCODE_INVENTORY_CODES) {
    // For demo, configure a default karat code on the stone inventory codes so
    // loose items (no gold karat) can receive a barcode via the configured policy.
    const looseDefault = ["DD", "GS", "PL"].includes(row.code) ? DEMO_LOOSE_KT : row.defaultKaratCode;
    await models.BarcodeInventoryCode.findOrCreate({
      where: { companyId, code: row.code },
      defaults: { id: `BIC-${companyId}-${row.code}`, companyId, ...row, defaultKaratCode: looseDefault },
      transaction: t,
    });
  }
  for (const row of DEFAULT_BARCODE_ITEM_CODES) {
    await models.BarcodeItemCode.findOrCreate({
      where: { companyId, code: row.code },
      defaults: { id: `BITC-${companyId}-${row.code}`, companyId, ...row },
      transaction: t,
    });
  }
}

// Ten client variants. `seq` groups the first two Gold-by-Weight jewellery pieces
// into ONE identical sequence scope (GW/BRC/21) to prove 000001/000002 increment.
const VARIANTS = [
  { key: "gw-jewellery-1", name: "Gold Bracelet 21K", type: "gold-weight", subtype: "gold-weight-jewellery", itemCode: "BRC", karat: 21,
    weights: { gross: 10.5, net: 9.78, gold: 9.78 }, price: 0, cost: 2100,
    meta: { goldColor: "yellow", stoneWeight: 0.72, makingCharge: 25, minimumMakingCharge: 18 } },
  { key: "gw-jewellery-2", name: "Gold Bracelet 21K (II)", type: "gold-weight", subtype: "gold-weight-jewellery", itemCode: "BRC", karat: 21,
    weights: { gross: 12.0, net: 11.4, gold: 11.4 }, price: 0, cost: 2450,
    meta: { goldColor: "rose", stoneWeight: 0.6, makingCharge: 25, minimumMakingCharge: 18 } },
  { key: "gw-bar", name: "Gold Bar 24K 10g", type: "gold-weight", subtype: "gold-weight-bar", itemCode: "BAR", karat: 24,
    weights: { gross: 10.0, net: 10.0, gold: 10.0 }, price: 0, cost: 2300, meta: { goldColor: "yellow" } },
  { key: "gp", name: "Gold Earrings 21K", type: "gold-piece", subtype: "gold-piece", itemCode: "ERG", karat: 21,
    weights: { gross: 5.35, net: 5.35, gold: 5.35 }, price: 3250, cost: 2400,
    meta: { pieceCount: 1, brand: "Darfus", makingCharge: 30, discount: 15 } },
  { key: "dd-jewellery", name: "Diamond Ring 18K", type: "diamond", subtype: "diamond-jewellery", itemCode: "RNG", karat: 18,
    weights: { gross: 4.2, net: 3.9 }, price: 8890, cost: 6200,
    meta: { carat: 0.75, color: "H", clarity: "VVS2", cut: "Excellent", shape: "Round", stoneCount: 1, certificateNumber: "GIA-1001", discount: 30 } },
  { key: "dd-loose", name: "Loose Diamond 0.50ct", type: "diamond", subtype: "diamond-loose", itemCode: "LOS", karat: null,
    weights: { gross: 0.1, net: 0.1 }, price: 5200, cost: 3800,
    meta: { carat: 0.5, color: "G", clarity: "VS1", cut: "Ideal", shape: "Oval", certificateNumber: "IGI-2002", discount: 20 } },
  { key: "gs-jewellery", name: "Precious Necklace 18K", type: "gemstone", subtype: "gemstone-jewellery", itemCode: "NCK", karat: 18,
    weights: { gross: 15.4, net: 12.1 }, price: 5450, cost: 3900,
    meta: { stoneType: "Ruby", carat: 2.4, tone: "Medium", saturation: "Vivid", certificateNumber: "GRS-3003", discount: 25,
      stones: [{ type: "Ruby", carat: 2.4, color: "Red" }, { type: "Emerald", carat: 1.85, color: "Green" }] } },
  { key: "gs-loose", name: "Loose Sapphire 3.10ct", type: "gemstone", subtype: "gemstone-loose", itemCode: "LOS", karat: null,
    weights: { gross: 0.6, net: 0.6 }, price: 4100, cost: 2600,
    meta: { stoneType: "Sapphire", carat: 3.1, color: "Blue", certificateNumber: "GRS-3010", discount: 20,
      stones: [{ type: "Sapphire", carat: 3.1, color: "Blue", shape: "Cushion" }] } },
  { key: "pl-jewellery", name: "Pearl Bracelet 18K", type: "pearl", subtype: "pearl-jewellery", itemCode: "BRC", karat: 18,
    weights: { gross: 8.3, net: 6.9 }, price: 4130, cost: 2800,
    meta: { pearlType: "Fresh Water", pearlSize: "7mm", pearlQuality: "AAA", pearlColor: "White", pearlCount: 24, luster: "High", discount: 25 } },
  { key: "pl-loose", name: "Loose Pearl 9mm", type: "pearl", subtype: "pearl-loose", itemCode: "LOS", karat: null,
    weights: { gross: 0.9, net: 0.9 }, price: 900, cost: 500,
    meta: { pearlType: "Akoya", pearlSize: "9mm", pearlQuality: "AA", pearlCount: 1, discount: 10 } },
  { key: "watch", name: "Provisional Watch", type: "watch", subtype: "watch", itemCode: "WCH", karat: null,
    weights: { gross: 120, net: 120 }, price: 15000, cost: 11000,
    meta: { brand: "DemoTime", model: "DT-100", referenceNumber: "REF-100", watchSerial: "SN-0001", movementType: "Automatic",
      caseMaterial: "Steel", strapMaterial: "Leather", condition: "New", boxIncluded: true, papersIncluded: true, warrantyCard: true } },
];

async function seedInventory(companyId, branch, t) {
  const created = [];
  for (const v of VARIANTS) {
    const id = `AST-CD-${v.key}`;
    const existing = await models.Asset.findByPk(id, { paranoid: false, transaction: t });
    if (existing) { created.push(id); continue; }
    const identity = await barcode.generateBarcodeForAsset({
      companyId, assetType: v.type, itemCode: v.itemCode, karat: v.karat, inventorySubtype: v.subtype, transaction: t,
    });
    await models.Asset.create({
      id, companyId, name: v.name, type: v.type, category: v.type,
      karat: v.karat || null,
      grossWeight: v.weights.gross, netWeight: v.weights.net, goldWeight: v.weights.gold ?? null,
      price: v.price, cost: v.cost,
      branch: branch.name, branchId: branch.id, location: "Showroom", status: "available",
      ...identity,
      inventorySubtype: v.subtype, metadataSchemaVersion: 1, metadata: v.meta,
      source: "client-demo-seed", notes: `Client demo (${SEED_VERSION})`,
    }, { transaction: t });
    created.push(id);
  }
  return created;
}

async function main() {
  const company = await models.Company.findOne({ order: [["createdAt", "ASC"]] });
  if (!company) throw new Error("No company found — run the baseline demo seeders first.");
  const branch = await models.Branch.findOne({ where: { companyId: company.id } });
  if (!branch) throw new Error("No branch found — run the baseline demo seeders first.");

  const t = await models.sequelize.transaction();
  try {
    await seedTaxonomy(company.id, t);
    const ids = await seedInventory(company.id, branch, t);
    await t.commit();
    console.log(`client-demo seeder (${SEED_VERSION}): seeded taxonomy + ${ids.length} inventory variants for ${company.id}.`);
  } catch (error) {
    await t.rollback();
    throw error;
  } finally {
    await models.sequelize.close();
  }
}

main().catch((error) => {
  console.error(`client-demo seeder failed: ${error.message}`);
  process.exit(1);
});
