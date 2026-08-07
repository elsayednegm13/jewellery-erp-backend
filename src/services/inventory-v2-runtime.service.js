"use strict";

const crypto = require("crypto");
const policy = require("./inventory-master-policy.service");
const profileMasterDataService = require("./profile-master-data.service");
const goldValuationService = require("./gold-valuation.service");
const looseProfileFinanceService = require("./loose-profile-finance.service");
const { ValidationError } = require("../utils/errors");

const LEGACY_STATUS = Object.freeze({
  AVAILABLE: "available",
  RESERVED: "reserved",
  PENDING_TRANSFER: "pending_transfer",
  WORKSHOP: "in_workshop",
  RETURNED: "returned",
  MISSING: "archived",
  MELTED: "melted",
  SOLD: "sold",
});

// Existing assets retain the legacy status column.  Runtime callers must not
// branch on whether an Asset happened to be created before the Inventory
// Master foundation: this is the one normalization boundary for both shapes.
const OPERATIONAL_STATUS_FROM_LEGACY = Object.freeze({
  available: "AVAILABLE",
  reserved: "RESERVED",
  pending_transfer: "PENDING_TRANSFER",
  in_workshop: "WORKSHOP",
  returned: "RETURNED",
  archived: "MISSING",
  melted: "MELTED",
  sold: "SOLD",
});

const TRANSITIONS = Object.freeze({
  AVAILABLE: new Set(["RESERVED", "PENDING_TRANSFER", "WORKSHOP", "MISSING", "MELTED", "SOLD"]),
  RESERVED: new Set(["AVAILABLE", "SOLD", "MISSING"]),
  PENDING_TRANSFER: new Set(["AVAILABLE", "MISSING"]),
  WORKSHOP: new Set(["AVAILABLE", "MISSING", "MELTED"]),
  SOLD: new Set(["RETURNED"]),
  RETURNED: new Set(["AVAILABLE"]),
  MISSING: new Set(["RETURNED"]),
  MELTED: new Set([]),
});

const receiptTypes = Object.freeze({
  GOLD_BY_WEIGHT_JEWELLERY: "gold-weight",
  GOLD_BAR_24K: "gold-weight",
  GOLD_BY_PIECE: "gold-piece",
  DIAMOND_JEWELLERY: "diamond",
  LOOSE_DIAMOND: "diamond",
  GEMSTONE_JEWELLERY: "gemstone",
  LOOSE_GEMSTONE: "gemstone",
  PEARL_JEWELLERY: "pearl",
  LOOSE_PEARL: "pearl",
  CGP_CUSTOMER_GOLD_PURCHASE: "gold-weight",
});

function legacySubtypeForProfile(profile) {
  if (profile === "GOLD_BAR_24K") return "bar";
  if (["LOOSE_DIAMOND", "LOOSE_GEMSTONE", "LOOSE_PEARL"].includes(profile)) return "loose";
  return null;
}

const goldProfiles = new Set(["GOLD_BY_WEIGHT_JEWELLERY", "GOLD_BAR_24K", "GOLD_BY_PIECE", "CGP_CUSTOMER_GOLD_PURCHASE"]);

const newId = (prefix) => `${prefix}-${crypto.randomUUID().replaceAll("-", "").slice(0, 26)}`;
const numberOrNull = (value) => value === undefined || value === null || value === "" ? null : Number(value);
const finiteOrNull = (value, field) => {
  const n = numberOrNull(value);
  if (n !== null && !Number.isFinite(n)) throw new Error(`INVENTORY_V2_INVALID_${field}`);
  return n;
};

function operationalStatusOf(asset) {
  const explicit = String(asset?.operationalStatus || "").trim().toUpperCase();
  if (explicit && Object.prototype.hasOwnProperty.call(LEGACY_STATUS, explicit)) return explicit;
  const legacy = String(asset?.status || "").trim().toLowerCase();
  const normalized = OPERATIONAL_STATUS_FROM_LEGACY[legacy];
  if (!normalized) throw new Error(`INVENTORY_OPERATIONAL_STATUS_UNKNOWN:${legacy || "null"}`);
  return normalized;
}

function requireV2ReceiptPieces(items, context = {}) {
  if (!Array.isArray(items) || !items.length) throw new Error("INVENTORY_V2_ITEMS_REQUIRED");
  return items.map((item, itemIndex) => {
    const documentQuantity = Number(item.quantity);
    if (!Number.isInteger(documentQuantity) || documentQuantity < 1) throw new Error("INVENTORY_V2_DOCUMENT_QUANTITY_INVALID");
    if (!Array.isArray(item.perPiece) || item.perPiece.length !== documentQuantity) {
      throw new Error("INVENTORY_V2_PER_PIECE_LENGTH_MISMATCH");
    }
    return item.perPiece.map((piece, pieceIndex) => normalizeReceiptPiece(piece, { ...context, item, itemIndex, pieceIndex }));
  });
}

function normalizeReceiptPiece(piece = {}, context = {}) {
  policy.assertPieceBasedPayload(piece);
  if (piece.operationalStatus !== undefined || piece.status !== undefined) throw new Error("INVENTORY_OPERATIONAL_STATUS_PAYLOAD_FORBIDDEN");
  const profile = policy.normalizeProfile(piece.profile || piece.inventoryProfile);
  const contract = policy.requireProfile(profile);
  const condition = policy.validateCondition(profile, piece.condition);
  const description = String(piece.description || piece.name || "").trim();
  if (!description) throw new Error("INVENTORY_V2_DESCRIPTION_REQUIRED");
  const normalizeText = (value) => value === undefined || value === null || String(value).trim() === "" ? null : String(value).trim();
  const certificateInput = piece.certificate === undefined || piece.certificate === null ? null : piece.certificate;
  if (certificateInput !== null && (typeof certificateInput !== "object" || Array.isArray(certificateInput))) throw new Error("INVENTORY_CERTIFICATE_INVALID");
  const certificateIssuerId = certificateInput === null ? null : normalizeText(certificateInput.issuerId || certificateInput.certificateAuthorityId);
  const certificate = certificateInput === null ? null : Object.freeze({
    issuer: normalizeText(certificateInput.issuer || certificateInput.name),
    ...(certificateIssuerId ? { issuerId: certificateIssuerId } : {}),
    certificateNumber: normalizeText(certificateInput.certificateNumber || certificateInput.number),
    issueDate: normalizeText(certificateInput.issueDate || context.purchaseDate),
    url: normalizeText(certificateInput.url || certificateInput.imageUrl || certificateInput.attachmentUrl),
  });
  if (certificate && (!(certificate.issuer || certificate.issuerId) || !certificate.certificateNumber || !certificate.issueDate)) throw new Error("INVENTORY_CERTIFICATE_REQUIRED_FIELDS");
  const components = normalizeComponentsForProfile(profile, piece.components || []);
  const looseDetails = policy.normalizeLooseDetails(profile, piece.looseDetails);
  const type = receiptTypes[profile];
  if (!type) throw new Error("INVENTORY_PROFILE_INVALID");

  const grossWeight = finiteOrNull(piece.grossWeight, "GROSS_WEIGHT");
  const stoneWeight = finiteOrNull(piece.stoneWeight ?? 0, "STONE_WEIGHT");
  const karat = finiteOrNull(piece.karat, "KARAT");
  let weights = null;
  if (grossWeight === null || grossWeight <= 0) throw new Error("INVENTORY_V2_GROSS_WEIGHT_REQUIRED");
  if (goldProfiles.has(profile)) {
    if (grossWeight === null || karat === null) throw new Error("INVENTORY_V2_GOLD_WEIGHT_FACTS_REQUIRED");
    weights = policy.calculateGoldWeights({ grossWeight, stoneWeight, karat });
  }
  if (profile === "GOLD_BAR_24K" && Number(karat) !== 24) throw new Error("INVENTORY_V2_GOLD_BAR_24K_KARAT_REQUIRED");

  const specializedValuation = goldValuationService.calculateReceiptGoldValuation({
    profile,
    weights,
    input: piece.goldValuation,
    configuredVatRate: context.vatRateDefault,
  });
  const loosePurchase = looseProfileFinanceService.calculatePurchase({ profile, input: piece.looseFinancial || piece, configuredVatRate: context.vatRateDefault });
  const purchaseCost = specializedValuation
    ? Number(specializedValuation.purchase.totalPurchaseCost)
    : loosePurchase ? Number(loosePurchase.totalPurchaseCost) : finiteOrNull(piece.purchaseCost ?? piece.unitCost, "PURCHASE_COST");
  if (purchaseCost === null || purchaseCost < 0) {
    throw new ValidationError(
      "purchaseCost is required and must be a non-negative economic evidence value.",
      { purchaseCost: ["Provide a non-negative purchaseCost for this physical output."] }
    );
  }
  const vatRate = specializedValuation ? Number(specializedValuation.purchase.vatRate) : loosePurchase ? Number(loosePurchase.vatRate) : finiteOrNull(piece.vatRate ?? 0, "VAT_RATE");
  if (vatRate === null || vatRate < 0 || vatRate > 100) throw new Error("INVENTORY_V2_VAT_RATE_INVALID");
  const certificateCost = specializedValuation ? Number(specializedValuation.purchase.certificateCost) : (finiteOrNull(piece.certificateCost ?? 0, "CERTIFICATE_COST") || 0);
  const goldValue = specializedValuation ? Number(specializedValuation.purchase.goldValue) : (finiteOrNull(piece.goldValue ?? 0, "GOLD_VALUE") || 0);
  const vatBase = specializedValuation ? Number(specializedValuation.purchase.vatBase) : loosePurchase ? Number(loosePurchase.vatBase) : (profile === "GOLD_BAR_24K" ? certificateCost : (finiteOrNull(piece.vatBase, "VAT_BASE") ?? purchaseCost));
  const vat = specializedValuation
    ? { vatBase: specializedValuation.purchase.vatBase, vatRate: specializedValuation.purchase.vatRate, vatAmount: specializedValuation.purchase.vatAmount }
    : loosePurchase ? { vatBase: loosePurchase.vatBase, vatRate: loosePurchase.vatRate, vatAmount: loosePurchase.vatAmount } : policy.calculateVat({ base: vatBase, rate: vatRate });
  const pricing = piece.pricing || {};

  return Object.freeze({
    ...piece,
    ...context,
    profile,
    description,
    goldColor: normalizeText(piece.goldColor),
    brand: normalizeText(piece.brand),
    model: normalizeText(piece.model),
    modelNumber: normalizeText(piece.modelNumber),
    supplierReference: normalizeText(piece.supplierReference),
    locationId: normalizeText(piece.locationId),
    rfid: normalizeText(piece.rfid),
    certificate,
    strategyCode: contract.pricing,
    type,
    condition,
    components,
    looseDetails,
    grossWeight,
    stoneWeight,
    karat,
    weights,
    purchaseCost,
    loosePurchase,
    purchaseGoldRate: specializedValuation?.purchase.purchaseGoldRate ?? finiteOrNull(piece.purchaseGoldRate, "PURCHASE_GOLD_RATE"),
    goldRateSource: specializedValuation?.purchase.goldRateSource ?? normalizeText(piece.goldRateSource),
    goldValue,
    makingPerGram: specializedValuation?.purchase.makingPerGram ?? finiteOrNull(piece.makingPerGram, "MAKING_PER_GRAM"),
    makingTotal: specializedValuation?.purchase.makingTotal ?? finiteOrNull(piece.makingTotal, "MAKING_TOTAL"),
    certificateCost,
    vat: { ...vat, vatRateSource: specializedValuation?.purchase.vatRateSource ?? (piece.vatRate === undefined ? "SETTINGS_DEFAULT" : "MANUAL") },
    currentValuation: specializedValuation?.current ?? (loosePurchase ? looseProfileFinanceService.calculateCurrent({ profile, input: piece.looseCurrentValuation || { currentValue: loosePurchase.purchaseBaseCost, currentVatRate: loosePurchase.vatRate }, configuredVatRate: context.vatRateDefault }) : null),
    pricing,
  });
}

function looseDetailsAsPrimarySubject(looseDetails) {
  if (!looseDetails) return null;
  const base = {
    role: "PRIMARY_SUBJECT", componentKind: looseDetails.kind, componentCount: 1, sequence: 0,
    name: looseDetails.stoneName || (looseDetails.kind === "PEARL" ? "لؤلؤ" : "حجر"),
    componentType: looseDetails.diamondType || looseDetails.pearlType || null,
    componentCarat: looseDetails.carat, componentWeight: looseDetails.totalPearlWeight,
    measurementUnit: "CT", notes: looseDetails.notes,
  };
  if (looseDetails.kind === "DIAMOND") return { ...base, diamondDetails: looseDetails };
  if (looseDetails.kind === "GEMSTONE") return { ...base, gemstoneDetails: looseDetails };
  return { ...base, pearlDetails: looseDetails };
}

async function recordAssetEvent({ models, transaction, asset, context, eventType, oldStatus = null, newStatus, sourceType, sourceId, note, idempotencyKey = null }) {
  const occurredAt = context.occurredAt || new Date();
  const event = await models.AssetEvent.create({
    id: newId("ASEV2"),
    assetId: asset.id,
    companyId: context.companyId,
    branchId: context.branchId,
    action: eventType,
    eventType,
    date: occurredAt.toISOString().slice(0, 10),
    occurredAt,
    user: context.actorName || "System",
    userId: context.actorId || null,
    employeeName: context.actorName || null,
    branch: context.branchName,
    note,
    notes: note,
    sourceDocument: sourceId,
    sourceType,
    sourceId,
    beforeState: oldStatus ? `operational_status:${oldStatus}` : null,
    afterState: `operational_status:${newStatus}`,
    oldContext: oldStatus ? { operationalStatus: oldStatus } : null,
    newContext: { operationalStatus: newStatus, inventoryProfile: asset.inventoryProfile },
    idempotencyKey,
    severity: "info",
  }, { transaction });
  return event;
}

async function recordMovement({ models, transaction, asset, context, movementType, sourceType, sourceId, eventId, fromBranchId = null, toBranchId = null, fromLocationId = null, toLocationId = null }) {
  await models.sequelize.query(`INSERT INTO inventory_asset_movements
    (id,asset_id,company_id,movement_type,from_branch_id,to_branch_id,from_location_id,to_location_id,source_type,source_id,asset_event_id,occurred_at,operator_id)
    VALUES (:id,:assetId,:companyId,:movementType,:fromBranchId,:toBranchId,:fromLocationId,:toLocationId,:sourceType,:sourceId,:eventId,:occurredAt,:operatorId)`, {
    replacements: {
      id: newId("IMV2"), assetId: asset.id, companyId: context.companyId, movementType,
      fromBranchId, toBranchId, fromLocationId, toLocationId, sourceType, sourceId,
      eventId: eventId || null, occurredAt: context.occurredAt || new Date(), operatorId: context.actorId || null,
    }, transaction,
  });
}

async function persistReceiptEvidence({ models, transaction, asset, poItem, piece, context }) {
  const receivedAt = context.occurredAt || new Date();
  const revisionId = newId("IMCOST");
  await models.sequelize.query(`INSERT INTO asset_origins
    (id,asset_id,company_id,branch_id,origin_type,purchase_order_item_id,received_at,received_by,mapping_classification)
    VALUES (:id,:assetId,:companyId,:branchId,'PURCHASE_ORDER',:poItemId,:receivedAt,:receivedBy,'V2_RUNTIME_RECEIPT')`, {
    replacements: { id: newId("IMORIGIN"), assetId: asset.id, companyId: context.companyId, branchId: context.branchId, poItemId: poItem.id, receivedAt, receivedBy: context.actorId || null }, transaction,
  });
  await models.sequelize.query(`INSERT INTO purchase_order_item_asset_links
    (id,purchase_order_item_id,asset_id,company_id,ordinal,received_at,received_by,mapping_classification)
    VALUES (:id,:poItemId,:assetId,:companyId,:ordinal,:receivedAt,:receivedBy,'V2_RUNTIME_RECEIPT')`, {
    replacements: { id: newId("IMPO"), poItemId: poItem.id, assetId: asset.id, companyId: context.companyId, ordinal: piece.pieceIndex + 1, receivedAt, receivedBy: context.actorId || null }, transaction,
  });
  await models.sequelize.query(`INSERT INTO asset_purchase_cost_revisions
    (id,asset_id,company_id,branch_id,revision_no,currency,purchase_gold_rate,gold_rate_source,gold_value,making_per_gram,making_total,certificate_cost,component_cost,vat_enabled,vat_rate,vat_rate_source,vat_base,vat_amount,total_purchase_cost,supplier_id,purchase_date,purchase_order_item_id,is_current,created_by,provenance,mapping_classification)
    VALUES (:id,:assetId,:companyId,:branchId,1,:currency,:purchaseGoldRate,:goldRateSource,:goldValue,:makingPerGram,:makingTotal,:certificateCost,:componentCost,:vatEnabled,:vatRate,:vatRateSource,:vatBase,:vatAmount,:totalPurchaseCost,:supplierId,:purchaseDate,:poItemId,true,:createdBy,:provenance,'V2_RUNTIME_RECEIPT')`, {
    replacements: {
      id: revisionId, assetId: asset.id, companyId: context.companyId, branchId: context.branchId, currency: context.currency || null,
      purchaseGoldRate: piece.purchaseGoldRate ?? null, goldRateSource: piece.goldRateSource || null, goldValue: piece.loosePurchase?.purchaseBaseCost ?? piece.goldValue,
      makingPerGram: piece.makingPerGram ?? null, makingTotal: piece.makingTotal ?? null, certificateCost: piece.certificateCost,
      componentCost: piece.loosePurchase?.additionalCost ?? piece.componentCost ?? null, vatEnabled: Number(piece.vat.vatRate) > 0, vatRate: piece.vat.vatRate,
      vatRateSource: piece.vat.vatRateSource, vatBase: piece.vat.vatBase, vatAmount: piece.vat.vatAmount,
      totalPurchaseCost: piece.purchaseCost, supplierId: context.supplierId, purchaseDate: context.purchaseDate, poItemId: poItem.id,
      createdBy: context.actorId || null, provenance: JSON.stringify({ contract: "V2_RUNTIME_RECEIPT", profile: piece.profile, perPiece: true }),
    }, transaction,
  });
  const resolvedLoose = await profileMasterDataService.resolveLooseReferences({
    models, companyId: context.companyId, profile: piece.profile, looseDetails: piece.looseDetails, transaction,
  });
  const certificateAuthority = resolvedLoose.references.find((reference) => reference.category === "CERTIFICATE_AUTHORITY")?.master;
  if (piece.certificate && (piece.profile === "LOOSE_GEMSTONE" || piece.profile === "LOOSE_PEARL") && !certificateAuthority) {
    throw new ValidationError("PROFILE_MASTER_DATA_CERTIFICATE_AUTHORITY_REQUIRED");
  }
  const effectiveCertificate = certificateAuthority && piece.certificate
    ? { ...piece.certificate, issuer: certificateAuthority.label }
    : piece.certificate;
  if (effectiveCertificate) {
    await models.AssetCertificate.create({
      id: newId("IMCERT"), assetId: asset.id, type: "PROFILE_CERTIFICATE",
      issuer: effectiveCertificate.issuer, certificateNumber: effectiveCertificate.certificateNumber,
      issueDate: effectiveCertificate.issueDate, url: effectiveCertificate.url,
    }, { transaction });
  }
  if (piece.weights) {
    await models.sequelize.query(`INSERT INTO asset_gold_details
      (asset_id,company_id,weight_unit,gross_weight,stone_weight,net_gold_weight,karat,purity_ratio,pure_gold_9999,mapping_classification)
      VALUES (:assetId,:companyId,'GRAM',:grossWeight,:stoneWeight,:netGoldWeight,:karat,:purityRatio,:pureGold9999,'V2_RUNTIME_RECEIPT')`, {
      replacements: { assetId: asset.id, companyId: context.companyId, ...piece.weights }, transaction,
    });
  }
  const resolvedPiece = { ...piece, looseDetails: resolvedLoose.details };
  const loosePrimarySubject = looseDetailsAsPrimarySubject(resolvedPiece.looseDetails);
  await persistAssetComponents({ models, transaction, asset, components: loosePrimarySubject ? [loosePrimarySubject] : piece.components, companyId: context.companyId });
  await profileMasterDataService.persistAssetReferences({ models, companyId: context.companyId, assetId: asset.id, references: resolvedLoose.references, transaction });
  const currentValuation = piece.currentValuation || {
    rateSource: "RECEIPT_INITIAL", goldRate: piece.purchaseGoldRate ?? null, goldValue: piece.goldValue,
    makingValue: piece.makingTotal ?? null, certificateValue: piece.certificateCost,
    componentValue: piece.componentCost ?? null, vatRate: piece.vat.vatRate,
    vatRateSource: piece.vat.vatRateSource, vatBase: piece.vat.vatBase,
    vatAmount: piece.vat.vatAmount, totalValue: piece.purchaseCost,
  };
  await models.sequelize.query(`INSERT INTO asset_current_valuations
    (asset_id,company_id,branch_id,rate_source,gold_rate,gold_value,making_value,certificate_value,component_value,vat_rate,vat_rate_source,vat_base,vat_amount,total_value,as_of)
    VALUES (:assetId,:companyId,:branchId,:rateSource,:goldRate,:goldValue,:makingValue,:certificateValue,:componentValue,:vatRate,:vatRateSource,:vatBase,:vatAmount,:totalValue,:asOf)`, {
    replacements: { assetId: asset.id, companyId: context.companyId, branchId: context.branchId, rateSource: currentValuation.rateSource, goldRate: currentValuation.goldRate, goldValue: currentValuation.goldValue, makingValue: currentValuation.makingValue, certificateValue: currentValuation.certificateValue, componentValue: currentValuation.componentValue, vatRate: currentValuation.vatRate, vatRateSource: currentValuation.vatRateSource, vatBase: currentValuation.vatBase, vatAmount: currentValuation.vatAmount, totalValue: currentValuation.totalValue, asOf: receivedAt }, transaction,
  });
  await models.sequelize.query(`INSERT INTO asset_pricing_policies
    (asset_id,company_id,strategy_code,selling_making_per_gram,minimum_making_per_gram,certificate_charge,minimum_certificate_charge,markup_percent,maximum_discount_percent,minimum_selling_price,manual_price_allowed)
    VALUES (:assetId,:companyId,:strategyCode,:sellingMakingPerGram,:minimumMakingPerGram,:certificateCharge,:minimumCertificateCharge,:markupPercent,:maximumDiscountPercent,:minimumSellingPrice,:manualPriceAllowed)`, {
    replacements: { assetId: asset.id, companyId: context.companyId, strategyCode: piece.strategyCode || "LOOSE_ASSET_STRATEGY", sellingMakingPerGram: piece.pricing.sellingMakingPerGram ?? null, minimumMakingPerGram: piece.pricing.minimumMakingPerGram ?? null, certificateCharge: piece.pricing.certificateCharge ?? null, minimumCertificateCharge: piece.pricing.minimumCertificateCharge ?? null, markupPercent: piece.pricing.markupPercent ?? null, maximumDiscountPercent: piece.pricing.maximumDiscountPercent ?? null, minimumSellingPrice: piece.pricing.minimumSellingPrice ?? null, manualPriceAllowed: Boolean(piece.pricing.manualPriceAllowed) }, transaction,
  });
}

// Manufacturing and melt outputs are new physical pieces, not a re-use or a
// weight mutation of their inputs.  Keep their evidence separate from a PO
// receipt while retaining the same cost, valuation and pricing contracts.
async function persistManufacturingEvidence({ models, transaction, asset, piece, context, manufacturingOrderId = null, cgpItemId = null, originType = "MANUFACTURING_OUTPUT" }) {
  const occurredAt = context.occurredAt || new Date();
  await models.sequelize.query(`INSERT INTO asset_origins
    (id,asset_id,company_id,branch_id,origin_type,manufacturing_order_id,cgp_item_id,received_at,received_by,mapping_classification)
    VALUES (:id,:assetId,:companyId,:branchId,:originType,:manufacturingOrderId,:cgpItemId,:occurredAt,:actorId,:mappingClassification)`, {
    replacements: { id: newId("IMORIGIN"), assetId: asset.id, companyId: context.companyId, branchId: context.branchId, originType, manufacturingOrderId, cgpItemId, occurredAt, actorId: context.actorId || null, mappingClassification: cgpItemId ? "V2_RUNTIME_CGP" : "V2_RUNTIME_MANUFACTURING" }, transaction,
  });
  await models.sequelize.query(`INSERT INTO asset_purchase_cost_revisions
    (id,asset_id,company_id,branch_id,revision_no,currency,purchase_gold_rate,gold_rate_source,gold_value,making_per_gram,making_total,certificate_cost,component_cost,vat_enabled,vat_rate,vat_rate_source,vat_base,vat_amount,total_purchase_cost,is_current,created_by,provenance,mapping_classification)
    VALUES (:id,:assetId,:companyId,:branchId,1,:currency,:purchaseGoldRate,:goldRateSource,:goldValue,:makingPerGram,:makingTotal,:certificateCost,:componentCost,:vatEnabled,:vatRate,:vatRateSource,:vatBase,:vatAmount,:totalPurchaseCost,true,:actorId,:provenance,'V2_RUNTIME_MANUFACTURING')`, {
    replacements: {
      id: newId("IMCOST"), assetId: asset.id, companyId: context.companyId, branchId: context.branchId, currency: context.currency || null,
      purchaseGoldRate: piece.purchaseGoldRate ?? null, goldRateSource: piece.goldRateSource || null, goldValue: piece.goldValue,
      makingPerGram: piece.makingPerGram ?? null, makingTotal: piece.makingTotal ?? null, certificateCost: piece.certificateCost,
      componentCost: piece.componentCost ?? null, vatEnabled: Number(piece.vat.vatRate) > 0, vatRate: piece.vat.vatRate,
      vatRateSource: piece.vat.vatRateSource, vatBase: piece.vat.vatBase, vatAmount: piece.vat.vatAmount,
      totalPurchaseCost: piece.purchaseCost, actorId: context.actorId || null,
      provenance: JSON.stringify({ contract: cgpItemId ? "V2_RUNTIME_CGP" : "V2_RUNTIME_MANUFACTURING", profile: piece.profile, manufacturingOrderId, cgpItemId }),
    }, transaction,
  });
  if (piece.weights) {
    await models.sequelize.query(`INSERT INTO asset_gold_details
      (asset_id,company_id,weight_unit,gross_weight,stone_weight,net_gold_weight,karat,purity_ratio,pure_gold_9999,mapping_classification)
      VALUES (:assetId,:companyId,'GRAM',:grossWeight,:stoneWeight,:netGoldWeight,:karat,:purityRatio,:pureGold9999,'V2_RUNTIME_MANUFACTURING')`, {
      replacements: { assetId: asset.id, companyId: context.companyId, ...piece.weights }, transaction,
    });
  }
  await persistAssetComponents({ models, transaction, asset, components: piece.components, companyId: context.companyId });
  await models.sequelize.query(`INSERT INTO asset_current_valuations
    (asset_id,company_id,branch_id,rate_source,gold_rate,gold_value,making_value,certificate_value,component_value,vat_rate,vat_rate_source,vat_base,vat_amount,total_value,as_of)
    VALUES (:assetId,:companyId,:branchId,'MANUFACTURING_INITIAL',:goldRate,:goldValue,:makingValue,:certificateValue,:componentValue,:vatRate,:vatRateSource,:vatBase,:vatAmount,:totalValue,:occurredAt)`, {
    replacements: { assetId: asset.id, companyId: context.companyId, branchId: context.branchId, goldRate: piece.purchaseGoldRate ?? null, goldValue: piece.goldValue, makingValue: piece.makingTotal ?? null, certificateValue: piece.certificateCost, componentValue: piece.componentCost ?? null, vatRate: piece.vat.vatRate, vatRateSource: piece.vat.vatRateSource, vatBase: piece.vat.vatBase, vatAmount: piece.vat.vatAmount, totalValue: piece.purchaseCost, occurredAt }, transaction,
  });
  await models.sequelize.query(`INSERT INTO asset_pricing_policies
    (asset_id,company_id,strategy_code,selling_making_per_gram,minimum_making_per_gram,certificate_charge,minimum_certificate_charge,markup_percent,maximum_discount_percent,minimum_selling_price,manual_price_allowed)
    VALUES (:assetId,:companyId,:strategyCode,:sellingMakingPerGram,:minimumMakingPerGram,:certificateCharge,:minimumCertificateCharge,:markupPercent,:maximumDiscountPercent,:minimumSellingPrice,:manualPriceAllowed)`, {
    replacements: { assetId: asset.id, companyId: context.companyId, strategyCode: piece.strategyCode || "LOOSE_ASSET_STRATEGY", sellingMakingPerGram: piece.pricing.sellingMakingPerGram ?? null, minimumMakingPerGram: piece.pricing.minimumMakingPerGram ?? null, certificateCharge: piece.pricing.certificateCharge ?? null, minimumCertificateCharge: piece.pricing.minimumCertificateCharge ?? null, markupPercent: piece.pricing.markupPercent ?? null, maximumDiscountPercent: piece.pricing.maximumDiscountPercent ?? null, minimumSellingPrice: piece.pricing.minimumSellingPrice ?? null, manualPriceAllowed: Boolean(piece.pricing.manualPriceAllowed) }, transaction,
  });
}

async function linkInvoiceAsset({ models, transaction, invoiceItemId, asset, companyId, ordinal, quoteSnapshot }) {
  const [revisions] = await models.sequelize.query(`SELECT id FROM asset_purchase_cost_revisions
    WHERE asset_id=:assetId AND is_current=true`, {
    replacements: { assetId: asset.id }, transaction,
  });
  await models.sequelize.query(`INSERT INTO invoice_item_asset_links
    (id,invoice_item_id,asset_id,company_id,ordinal,quote_snapshot,cost_snapshot_revision_id,mapping_classification)
    VALUES (:id,:invoiceItemId,:assetId,:companyId,:ordinal,:quoteSnapshot,:costRevisionId,'V2_RUNTIME_SALE')`, {
    replacements: { id: newId("IMINV"), invoiceItemId, assetId: asset.id, companyId, ordinal, quoteSnapshot: JSON.stringify(quoteSnapshot || {}), costRevisionId: revisions[0]?.id || null }, transaction,
  });
}

async function transitionAsset({ models, transaction, asset, context, toStatus, eventType, movementType, sourceType, sourceId, note, idempotencyKey = null, toBranchId = null, toLocationId = null }) {
  if (!transaction) throw new Error("INVENTORY_CANONICAL_TRANSITION_TRANSACTION_REQUIRED");
  if (!context?.companyId || context.companyId !== asset.companyId) throw new Error("INVENTORY_CANONICAL_TRANSITION_COMPANY_SCOPE_INVALID");
  const fromStatus = operationalStatusOf(asset);
  if (!TRANSITIONS[fromStatus]?.has(toStatus)) throw new Error(`INVENTORY_V2_INVALID_STATE_TRANSITION:${fromStatus}:${toStatus}`);
  const fromBranchId = asset.branchId;
  const fromLocationId = asset.locationId;
  await asset.update({ operationalStatus: toStatus, status: LEGACY_STATUS[toStatus], branchId: toBranchId || asset.branchId, locationId: toLocationId ?? asset.locationId, updatedBy: context.actorId || null }, { transaction, inventoryCanonicalTransition: true });
  const event = await recordAssetEvent({ models, transaction, asset: { ...asset.toJSON(), operationalStatus: toStatus }, context, eventType, oldStatus: fromStatus, newStatus: toStatus, sourceType, sourceId, note, idempotencyKey });
  await recordMovement({ models, transaction, asset, context, movementType, sourceType, sourceId, eventId: event.id, fromBranchId, toBranchId: toBranchId || fromBranchId, fromLocationId, toLocationId: toLocationId ?? fromLocationId });
  return event;
}

async function assignRfid({ models, transaction, asset, context, rfidNumber, reason = null, sourceId, idempotencyKey }) {
  const normalized = String(rfidNumber || "").trim();
  if (!normalized) throw new Error("INVENTORY_V2_RFID_REQUIRED");
  const existing = await models.sequelize.query(`SELECT id,asset_id,status,is_current FROM asset_rfid_assignments
    WHERE rfid_number=:rfidNumber FOR UPDATE`, { replacements: { rfidNumber: normalized }, transaction });
  if (existing[0].length) throw new Error("INVENTORY_V2_RFID_REUSE_FORBIDDEN");
  const current = await models.sequelize.query(`SELECT id,rfid_number FROM asset_rfid_assignments
    WHERE asset_id=:assetId AND is_current=true FOR UPDATE`, { replacements: { assetId: asset.id }, transaction });
  const isReplacement = current[0].length > 0;
  if (isReplacement) {
    await models.sequelize.query(`UPDATE asset_rfid_assignments
      SET is_current=false,status='REPLACED',ended_at=:occurredAt,ended_by=:actorId,replacement_reason=:reason
      WHERE id=:id`, { replacements: { id: current[0][0].id, occurredAt: context.occurredAt || new Date(), actorId: context.actorId || null, reason: reason || "RFID replacement" }, transaction });
  }
  const assignmentId = newId("IMRFID");
  await models.sequelize.query(`INSERT INTO asset_rfid_assignments
    (id,asset_id,company_id,branch_id,rfid_number,status,is_current,assigned_at,assigned_by,mapping_classification)
    VALUES (:id,:assetId,:companyId,:branchId,:rfidNumber,'ACTIVE',true,:assignedAt,:assignedBy,'V2_RUNTIME_RFID')`, {
    replacements: { id: assignmentId, assetId: asset.id, companyId: context.companyId, branchId: asset.branchId, rfidNumber: normalized, assignedAt: context.occurredAt || new Date(), assignedBy: context.actorId || null }, transaction,
  });
  await asset.update({ rfid: normalized, updatedBy: context.actorId || null }, { transaction });
  await recordAssetEvent({ models, transaction, asset, context, eventType: isReplacement ? "RFID_REPLACED" : "RFID_ASSIGNED", oldStatus: asset.operationalStatus, newStatus: asset.operationalStatus, sourceType: "RFID_ASSIGNMENT", sourceId: sourceId || assignmentId, note: reason || (isReplacement ? "RFID replaced" : "RFID assigned"), idempotencyKey });
  return { assignmentId, replacedAssignmentId: isReplacement ? current[0][0].id : null, rfidNumber: normalized };
}

async function recordRfidScan({ models, transaction, context, rfidNumber, sourceType = "RFID_SCAN", sourceId = null, deviceId = null }) {
  const normalized = String(rfidNumber || "").trim();
  if (!normalized) throw new Error("INVENTORY_V2_RFID_REQUIRED");
  const [rows] = await models.sequelize.query(`SELECT r.id AS assignment_id,r.asset_id,a.branch_id
    FROM asset_rfid_assignments r JOIN assets a ON a.id=r.asset_id
    WHERE r.rfid_number=:rfidNumber AND r.company_id=:companyId AND r.is_current=true AND r.status='ACTIVE'`, {
    replacements: { rfidNumber: normalized, companyId: context.companyId }, transaction,
  });
  if (!rows.length) throw new Error("INVENTORY_V2_RFID_NOT_FOUND");
  const row = rows[0];
  await models.sequelize.query(`INSERT INTO rfid_scan_events
    (id,assignment_id,asset_id,company_id,branch_id,scanned_at,device_id,operator_id,operator_name,source_type,source_id,method,result)
    VALUES (:id,:assignmentId,:assetId,:companyId,:branchId,:scannedAt,:deviceId,:operatorId,:operatorName,:sourceType,:sourceId,'RFID_SCAN','MATCHED')`, {
    replacements: { id: newId("IMRFSCAN"), assignmentId: row.assignment_id, assetId: row.asset_id, companyId: context.companyId, branchId: context.branchId, scannedAt: context.occurredAt || new Date(), deviceId, operatorId: context.actorId || null, operatorName: context.actorName || null, sourceType, sourceId }, transaction,
  });
  return { assetId: row.asset_id, assignmentId: row.assignment_id };
}

async function recordTagPrint({ models, transaction, asset, context, printKind, templateName, templateVersion, printerName, deviceId, reason, idempotencyKey }) {
  const kind = String(printKind || "").toUpperCase();
  if (!['INITIAL', 'REPRINT'].includes(kind)) throw new Error("INVENTORY_V2_PRINT_KIND_INVALID");
  if (kind === 'REPRINT' && !String(reason || '').trim()) throw new Error("INVENTORY_V2_REPRINT_REASON_REQUIRED");
  const id = newId("IMTAG");
  await models.sequelize.query(`INSERT INTO asset_tag_print_events
    (id,asset_id,company_id,branch_id,print_kind,template_name,template_version,printer_name,device_id,operator_id,operator_name,reason,printed_at,result,idempotency_key)
    VALUES (:id,:assetId,:companyId,:branchId,:printKind,:templateName,:templateVersion,:printerName,:deviceId,:operatorId,:operatorName,:reason,:printedAt,'PRINTED',:idempotencyKey)`, {
    replacements: { id, assetId: asset.id, companyId: context.companyId, branchId: asset.branchId, printKind: kind, templateName: templateName || null, templateVersion: templateVersion || null, printerName: printerName || null, deviceId: deviceId || null, operatorId: context.actorId || null, operatorName: context.actorName || null, reason: reason || null, printedAt: context.occurredAt || new Date(), idempotencyKey }, transaction,
  });
  await recordAssetEvent({ models, transaction, asset, context, eventType: kind === 'INITIAL' ? 'TAG_PRINTED' : 'TAG_REPRINTED', oldStatus: asset.operationalStatus, newStatus: asset.operationalStatus, sourceType: 'ASSET_TAG_PRINT', sourceId: id, note: reason || 'Barcode tag printed', idempotencyKey: `${idempotencyKey}:event` });
  return { id, printKind: kind, barcode: asset.barcode };
}

function normalizeComponentsForProfile(profile, components = []) {
  const contract = policy.requireProfile(profile);
  if (!Array.isArray(components)) throw new Error("INVENTORY_COMPONENTS_MUST_BE_ARRAY");
  if (components.length > 0 && contract.componentsSupported === false) {
    throw new Error(`INVENTORY_COMPONENTS_NOT_SUPPORTED:${profile}`);
  }

  const defaultKind = profile === "DIAMOND_JEWELLERY" ? "DIAMOND" : profile === "GEMSTONE_JEWELLERY" ? "GEMSTONE" : profile === "PEARL_JEWELLERY" ? "PEARL" : "OTHER";

  return components.map((comp, sequence) => {
    const kind = String(comp.componentKind || comp.kind || defaultKind).toUpperCase();
    if (!["DIAMOND", "GEMSTONE", "PEARL", "OTHER"].includes(kind)) {
      throw new Error(`INVENTORY_COMPONENT_KIND_INVALID:${kind}`);
    }
    const role = String(comp.role || "EMBEDDED").toUpperCase();
    if (!["EMBEDDED", "PRIMARY_SUBJECT"].includes(role)) {
      throw new Error(`INVENTORY_COMPONENT_ROLE_INVALID:${role}`);
    }
    const count = policy.validateComponent({ role, componentCount: comp.componentCount ?? comp.quantity ?? 1 });

    return {
      ...comp,
      sequence,
      role,
      componentKind: kind,
      componentCount: count,
      componentWeight: finiteOrNull(comp.componentWeight ?? comp.weight ?? comp.totalPearlWeight, "COMPONENT_WEIGHT"),
      componentCarat: finiteOrNull(comp.componentCarat ?? comp.carat ?? comp.stoneCaratWeight, "COMPONENT_CARAT"),
      measurementUnit: comp.measurementUnit ? String(comp.measurementUnit).toUpperCase() : (kind === "PEARL" ? "GRAM" : (kind === "DIAMOND" || kind === "GEMSTONE" ? "CARAT" : null)),
      name: comp.name ? String(comp.name).trim() : (kind === "DIAMOND" ? "ألماس" : kind === "GEMSTONE" ? "حجر كريم" : kind === "PEARL" ? "لؤلؤ" : "حجر"),
      componentType: comp.componentType ? String(comp.componentType).trim() : null,
      purchaseCost: finiteOrNull(comp.purchaseCost ?? comp.cost ?? comp.stoneCost ?? comp.pearlCost ?? 0, "COMPONENT_COST") || 0,
      currentValue: finiteOrNull(comp.currentValue ?? comp.purchaseCost ?? comp.cost ?? comp.stoneCost ?? comp.pearlCost ?? 0, "COMPONENT_VALUE") || 0,
      notes: comp.notes ? String(comp.notes).trim() : null,
    };
  });
}

async function persistAssetComponents({ models, transaction, asset, components, companyId }) {
  if (!Array.isArray(components) || !components.length) return [];
  const insertedIds = [];

  for (let i = 0; i < components.length; i++) {
    const component = components[i];
    const componentId = component.id && String(component.id).startsWith("IMCOMP-")
      ? String(component.id)
      : newId("IMCOMP");
    const role = String(component.role || "EMBEDDED").toUpperCase();
    const componentKind = String(component.componentKind || component.kind || "OTHER").toUpperCase();
    const sequence = component.sequence ?? i;
    const componentCount = Number(component.componentCount) || 1;
    const componentWeight = finiteOrNull(component.componentWeight ?? component.weight ?? component.totalPearlWeight, "COMPONENT_WEIGHT");
    const componentCarat = finiteOrNull(component.componentCarat ?? component.carat ?? component.stoneCaratWeight, "COMPONENT_CARAT");
    const measurementUnit = component.measurementUnit ? String(component.measurementUnit).toUpperCase() : null;
    const name = component.name ? String(component.name).trim() : null;
    const componentType = component.componentType ? String(component.componentType).trim() : null;
    const purchaseCost = finiteOrNull(component.purchaseCost ?? component.cost ?? component.stoneCost ?? component.pearlCost, "PURCHASE_COST") || 0;
    const currentValue = finiteOrNull(component.currentValue ?? purchaseCost, "CURRENT_VALUE") || 0;
    const certificateId = component.certificateId ?? null;
    const notes = component.notes ? String(component.notes).trim() : null;

    await models.sequelize.query(`INSERT INTO asset_components
      (id,asset_id,company_id,role,component_kind,sequence,component_count,component_weight,component_carat,measurement_unit,name,component_type,purchase_cost,current_value,certificate_id,notes,mapping_classification)
      VALUES (:id,:assetId,:companyId,:role,:componentKind,:sequence,:componentCount,:componentWeight,:componentCarat,:measurementUnit,:name,:componentType,:purchaseCost,:currentValue,:certificateId,:notes,'V2_RUNTIME_RECEIPT')`, {
      replacements: {
        id: componentId,
        assetId: asset.id,
        companyId,
        role,
        componentKind,
        sequence,
        componentCount,
        componentWeight: componentWeight ?? null,
        componentCarat: componentCarat ?? null,
        measurementUnit,
        name,
        componentType,
        purchaseCost,
        currentValue,
        certificateId,
        notes,
      },
      transaction,
    });

    if (componentKind === "DIAMOND") {
      const d = component.diamondDetails || component;
      await models.sequelize.query(`INSERT INTO asset_diamond_component_details
        (component_id, treatment, color, tone, saturation, clarity, cut, shape, origin, position, setting)
        VALUES (:id, :treatment, :color, :tone, :saturation, :clarity, :cut, :shape, :origin, :position, :setting)`, {
        replacements: {
          id: componentId,
          treatment: d.treatment ?? d.treatmentType ?? null,
          color: d.color ?? d.stoneColor ?? null,
          tone: d.tone ?? null,
          saturation: d.saturation ?? null,
          clarity: d.clarity ?? null,
          cut: d.cut ?? null,
          shape: d.shape ?? null,
          origin: d.origin ?? d.diamondOrigin ?? d.stoneOrigin ?? null,
          position: d.position ?? d.stonePosition ?? null,
          setting: d.setting ?? d.stoneSetting ?? null,
        },
        transaction,
      });
    } else if (componentKind === "GEMSTONE") {
      const g = component.gemstoneDetails || component;
      await models.sequelize.query(`INSERT INTO asset_gemstone_component_details
        (component_id, treatment, shape, color, tone, tone_level, saturation, optical_effect, origin, position, setting)
        VALUES (:id, :treatment, :shape, :color, :tone, :toneLevel, :saturation, :opticalEffect, :origin, :position, :setting)`, {
        replacements: {
          id: componentId,
          treatment: g.treatment ?? g.treatmentType ?? null,
          shape: g.shape ?? null,
          color: g.color ?? g.stoneColor ?? null,
          tone: g.tone ?? g.stoneTone ?? null,
          toneLevel: g.toneLevel ?? g.tone_level ?? g.toneLevels ?? null,
          saturation: g.saturation ?? g.saturationLevel ?? g.saturationLevels ?? null,
          opticalEffect: g.opticalEffect ?? g.optical_effect ?? g.stoneOpticalEffect ?? null,
          origin: g.origin ?? g.stoneOrigin ?? null,
          position: g.position ?? g.stonePosition ?? null,
          setting: g.setting ?? g.stoneSetting ?? null,
        },
        transaction,
      });
    } else if (componentKind === "PEARL") {
      const p = component.pearlDetails || component;
      await models.sequelize.query(`INSERT INTO asset_pearl_component_details
        (component_id, size, pearl_size_master_data_id, pearl_type, color, overtone, orient, shape, luster, surface_quality, nacre_quality, origin)
        VALUES (:id, :size, :pearlSizeMasterDataId, :pearlType, :color, :overtone, :orient, :shape, :luster, :surfaceQuality, :nacreQuality, :origin)`, {
        replacements: {
          id: componentId,
          size: p.size ?? p.pearlSize ?? null,
          pearlSizeMasterDataId: p.pearlSizeMaster?.id ?? p.pearlSizeId ?? null,
          pearlType: p.pearlType ?? p.pearl_type ?? null,
          color: p.color ?? p.pearlColor ?? null,
          overtone: p.overtone ?? p.pearlOvertone ?? null,
          orient: p.orient ?? p.pearlOrient ?? null,
          shape: p.shape ?? p.pearlShape ?? null,
          luster: p.luster ?? p.pearlLuster ?? null,
          surfaceQuality: p.surfaceQuality ?? p.surface_quality ?? p.pearlSurfaceQuality ?? null,
          nacreQuality: p.nacreQuality ?? p.nacre_quality ?? null,
          origin: p.origin ?? p.pearlOrigin ?? null,
        },
        transaction,
      });
    }

    insertedIds.push(componentId);
  }

  return insertedIds;
}

async function fetchAssetComponents({ models, transaction, assetId }) {
  const components = await models.sequelize.query(
    "SELECT * FROM asset_components WHERE asset_id=:assetId ORDER BY sequence",
    { replacements: { assetId }, transaction, type: models.sequelize.QueryTypes.SELECT }
  );

  const enriched = await Promise.all(components.map(async (comp) => {
    let diamondDetails = null;
    let gemstoneDetails = null;
    let pearlDetails = null;

    if (comp.component_kind === "DIAMOND") {
      const rows = await models.sequelize.query(
        "SELECT * FROM asset_diamond_component_details WHERE component_id=:id",
        { replacements: { id: comp.id }, transaction, type: models.sequelize.QueryTypes.SELECT }
      );
      if (rows[0]) {
        diamondDetails = {
          ...rows[0],
          treatmentType: rows[0].treatment,
          diamondOrigin: rows[0].origin,
          stonePosition: rows[0].position,
          stoneSetting: rows[0].setting,
        };
      }
    } else if (comp.component_kind === "GEMSTONE") {
      const rows = await models.sequelize.query(
        "SELECT * FROM asset_gemstone_component_details WHERE component_id=:id",
        { replacements: { id: comp.id }, transaction, type: models.sequelize.QueryTypes.SELECT }
      );
      if (rows[0]) {
        gemstoneDetails = {
          ...rows[0],
          toneLevel: rows[0].tone_level,
          opticalEffect: rows[0].optical_effect,
          stoneOrigin: rows[0].origin,
          stonePosition: rows[0].position,
          stoneSetting: rows[0].setting,
        };
      }
    } else if (comp.component_kind === "PEARL") {
      const rows = await models.sequelize.query(
        "SELECT * FROM asset_pearl_component_details WHERE component_id=:id",
        { replacements: { id: comp.id }, transaction, type: models.sequelize.QueryTypes.SELECT }
      );
      if (rows[0]) {
        pearlDetails = {
          ...rows[0],
          pearlType: rows[0].pearl_type,
          pearlSize: rows[0].size,
          pearlColor: rows[0].color,
          pearlOvertone: rows[0].overtone,
          pearlOrient: rows[0].orient,
          pearlShape: rows[0].shape,
          pearlLuster: rows[0].luster,
          surfaceQuality: rows[0].surface_quality,
          pearlSurfaceQuality: rows[0].surface_quality,
          nacreQuality: rows[0].nacre_quality,
          pearlOrigin: rows[0].origin,
        };
      }
    }

    return {
      ...comp,
      diamondDetails,
      gemstoneDetails,
      pearlDetails,
    };
  }));

  return enriched;
}

async function updateAssetComponents({ models, transaction, asset, context, components }) {
  if (!transaction) throw new Error("INVENTORY_CANONICAL_TRANSACTION_REQUIRED");
  const normalized = normalizeComponentsForProfile(asset.inventoryProfile, components);

  const existing = await models.sequelize.query(
    "SELECT id FROM asset_components WHERE asset_id=:assetId",
    { replacements: { assetId: asset.id }, transaction, type: models.sequelize.QueryTypes.SELECT }
  );

  for (const row of existing) {
    await models.sequelize.query("DELETE FROM asset_diamond_component_details WHERE component_id=:id", { replacements: { id: row.id }, transaction });
    await models.sequelize.query("DELETE FROM asset_gemstone_component_details WHERE component_id=:id", { replacements: { id: row.id }, transaction });
    await models.sequelize.query("DELETE FROM asset_pearl_component_details WHERE component_id=:id", { replacements: { id: row.id }, transaction });
    await models.sequelize.query("DELETE FROM asset_components WHERE id=:id", { replacements: { id: row.id }, transaction });
  }

  await persistAssetComponents({ models, transaction, asset, components: normalized, companyId: context.companyId });
  await recordAssetEvent({ models, transaction, asset: asset.toJSON ? asset.toJSON() : asset, context, eventType: "COMPONENTS_UPDATED", oldStatus: asset.operationalStatus, newStatus: asset.operationalStatus, sourceType: "COMPONENTS_UPDATE", sourceId: asset.id, note: "Asset components updated" });

  return fetchAssetComponents({ models, transaction, assetId: asset.id });
}

module.exports = { LEGACY_STATUS, TRANSITIONS, legacySubtypeForProfile, operationalStatusOf, requireV2ReceiptPieces, normalizeReceiptPiece, looseDetailsAsPrimarySubject, newId, recordAssetEvent, recordMovement, persistReceiptEvidence, persistManufacturingEvidence, linkInvoiceAsset, transitionAsset, assignRfid, recordRfidScan, recordTagPrint, normalizeComponentsForProfile, persistAssetComponents, fetchAssetComponents, updateAssetComponents };
