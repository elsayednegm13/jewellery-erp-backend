"use strict";

const crypto = require("crypto");
const Decimal = require("decimal.js");
const policy = require("./inventory-master-policy.service");
const profileMasterDataService = require("./profile-master-data.service");
const goldValuationService = require("./gold-valuation.service");
const looseProfileFinanceService = require("./loose-profile-finance.service");
const diamondJewelleryProfileService = require("./diamond-jewellery-profile.service");
const salePricingService = require("./gold-sale-pricing.service");
const { ValidationError } = require("../utils/errors");

const OPERATIONAL_STATUS = Object.freeze([
  "PENDING_INTEGRATION", "AVAILABLE", "RESERVED", "PENDING_TRANSFER", "WORKSHOP",
  "SOLD", "RETURNED", "MISSING", "MELTED", "REVERSAL_PENDING", "REVERSED",
]);
const CONDITION = Object.freeze(["NEW", "USED"]);
const TAG_STATE = Object.freeze(["PENDING", "PRINTED"]);
const EVENT_ONLY_TERMS = Object.freeze(["IN_TRANSFER", "RECOVERED", "EXCHANGED"]);

const LEGACY_STATUS = Object.freeze({
  AVAILABLE: "available",
  PENDING_INTEGRATION: "pending_integration",
  RESERVED: "reserved",
  PENDING_TRANSFER: "pending_transfer",
  WORKSHOP: "in_workshop",
  RETURNED: "returned",
  MISSING: "archived",
  MELTED: "melted",
  SOLD: "sold",
  REVERSAL_PENDING: "reversal_pending",
  REVERSED: "reversed",
});

// Existing assets retain the legacy status column.  Runtime callers must not
// branch on whether an Asset happened to be created before the Inventory
// Master foundation: this is the one normalization boundary for both shapes.
const OPERATIONAL_STATUS_FROM_LEGACY = Object.freeze({
  available: "AVAILABLE",
  pending_integration: "PENDING_INTEGRATION",
  reserved: "RESERVED",
  pending_transfer: "PENDING_TRANSFER",
  in_workshop: "WORKSHOP",
  returned: "RETURNED",
  archived: "MISSING",
  melted: "MELTED",
  sold: "SOLD",
  reversal_pending: "REVERSAL_PENDING",
  reversed: "REVERSED",
});

const TRANSITIONS = Object.freeze({
  PENDING_INTEGRATION: new Set(["AVAILABLE", "REVERSAL_PENDING"]),
  AVAILABLE: new Set(["RESERVED", "PENDING_TRANSFER", "WORKSHOP", "MISSING", "MELTED", "SOLD", "REVERSAL_PENDING"]),
  RESERVED: new Set(["AVAILABLE", "SOLD", "MISSING"]),
  PENDING_TRANSFER: new Set(["AVAILABLE", "MISSING"]),
  WORKSHOP: new Set(["AVAILABLE", "MISSING", "MELTED"]),
  SOLD: new Set(["RETURNED"]),
  RETURNED: new Set(["AVAILABLE"]),
  MISSING: new Set(["RETURNED"]),
  MELTED: new Set([]),
  REVERSAL_PENDING: new Set(["REVERSED"]),
  REVERSED: new Set([]),
});

// This capability is intentionally module-private: HTTP input cannot produce
// it.  The CGP evaluator obtains it from the same canonical state authority
// only after independently proving every required durable hard gate.
const CGP_AVAILABILITY_CAPABILITY = Symbol("CGP_AVAILABILITY_CAPABILITY");
const CGP_REVERSAL_HOLD_CAPABILITY = Symbol("CGP_REVERSAL_HOLD_CAPABILITY");
const CGP_REVERSAL_FINALIZE_CAPABILITY = Symbol("CGP_REVERSAL_FINALIZE_CAPABILITY");

function createCgpAvailabilityTransitionContext(context = {}) {
  return { ...context, cgpAvailabilityCapability: CGP_AVAILABILITY_CAPABILITY };
}

// These capabilities are deliberately module-private.  They bind the two CGP
// reversal transitions to the reversal saga consumers, never to HTTP input or
// ordinary inventory commands.
function createCgpReversalHoldTransitionContext(context = {}) {
  return { ...context, cgpReversalHoldCapability: CGP_REVERSAL_HOLD_CAPABILITY };
}

function createCgpReversalFinalizeTransitionContext(context = {}) {
  return { ...context, cgpReversalFinalizeCapability: CGP_REVERSAL_FINALIZE_CAPABILITY };
}

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
  const isLooseDiamond = profile === "LOOSE_DIAMOND";
  const isLooseGemstone = profile === "LOOSE_GEMSTONE";
  const isLoosePearl = profile === "LOOSE_PEARL";
  const condition = policy.validateCondition(profile, piece.condition);
  const description = String(piece.description || piece.name || "").trim();
  if (!description) throw new Error("INVENTORY_V2_DESCRIPTION_REQUIRED");
  const normalizeText = (value) => value === undefined || value === null || String(value).trim() === "" ? null : String(value).trim();
  const certificateInput = piece.certificate === undefined || piece.certificate === null ? null : piece.certificate;
  if (certificateInput !== null && (typeof certificateInput !== "object" || Array.isArray(certificateInput))) throw new Error("INVENTORY_CERTIFICATE_INVALID");
  const certificateIssuerId = certificateInput === null ? null : normalizeText(certificateInput.issuerId || certificateInput.certificateAuthorityId);
  const certificate = certificateInput === null ? null : Object.freeze({
    issuer: normalizeText(certificateInput.issuer || certificateInput.authority || certificateInput.name),
    ...(certificateIssuerId ? { issuerId: certificateIssuerId } : {}),
    certificateNumber: normalizeText(certificateInput.certificateNumber || certificateInput.number),
    issueDate: normalizeText(certificateInput.issueDate || context.purchaseDate),
    url: normalizeText(certificateInput.url || certificateInput.imageUrl || certificateInput.attachmentUrl),
  });
  if (certificate && (!(certificate.issuer || certificate.issuerId) || !certificate.certificateNumber || !certificate.issueDate)) throw new Error("INVENTORY_CERTIFICATE_REQUIRED_FIELDS");
  const diamondPiece = profile === "DIAMOND_JEWELLERY"
    ? diamondJewelleryProfileService.normalizePiece(piece, { masterData: context.diamondMasterData || null, requireSalePrice: true })
    : null;
  if (isLooseDiamond && Array.isArray(piece.components) && piece.components.length) {
    throw new Error("INVENTORY_LOOSE_DIAMOND_COMPONENTS_FORBIDDEN");
  }
  const components = diamondPiece
    ? diamondPiece.components
    : normalizeComponentsForProfile(profile, piece.components || []);
  const looseDetails = policy.normalizeLooseDetails(profile, piece.looseDetails);
  const type = receiptTypes[profile];
  if (!type) throw new Error("INVENTORY_PROFILE_INVALID");

  const grossWeight = diamondPiece
    ? Number(diamondPiece.grossWeight)
    : (isLooseDiamond || isLooseGemstone)
      ? Number(new Decimal(String(looseDetails.carat)).times("0.20").toFixed(8))
      : isLoosePearl
        ? Number(looseDetails.totalPearlWeight)
      : finiteOrNull(piece.grossWeight, "GROSS_WEIGHT");
  if (profile === "GOLD_BY_PIECE" && !Object.prototype.hasOwnProperty.call(piece, "stoneWeight")) {
    throw new Error("GBP_STONE_WEIGHT_REQUIRED");
  }
  const stoneWeight = diamondPiece ? Number(diamondPiece.stoneWeight) : finiteOrNull(piece.stoneWeight ?? 0, "STONE_WEIGHT");
  const karat = diamondPiece ? Number(diamondPiece.karat) : (isLooseDiamond ? null : finiteOrNull(piece.karat, "KARAT"));
  let weights = null;
  if (!isLooseDiamond && !isLooseGemstone && !isLoosePearl && (grossWeight === null || grossWeight <= 0)) throw new Error("INVENTORY_V2_GROSS_WEIGHT_REQUIRED");
  if (goldProfiles.has(profile)) {
    if (grossWeight === null || karat === null) throw new Error("INVENTORY_V2_GOLD_WEIGHT_FACTS_REQUIRED");
    weights = policy.calculateGoldWeights({ grossWeight, stoneWeight, karat });
  }
  if (diamondPiece) {
    weights = {
      grossWeight: diamondPiece.grossWeight,
      stoneWeight: diamondPiece.stoneWeight,
      netGoldWeight: diamondPiece.netGoldWeight,
      karat: Number(diamondPiece.karat).toFixed(6),
      purityRatio: Number(diamondPiece.karat / 24).toFixed(8),
      pureGold9999: diamondPiece.pureGoldWeight9999,
    };
  }
  if (profile === "GOLD_BAR_24K" && Number(karat) !== 24) throw new Error("INVENTORY_V2_GOLD_BAR_24K_KARAT_REQUIRED");

  const specializedValuation = goldValuationService.calculateReceiptGoldValuation({
    profile,
    ...(diamondPiece ? { totalDiamondWeight: diamondPiece.totalDiamondWeight, pureGoldWeight9999: diamondPiece.pureGoldWeight9999, netGoldWeight: diamondPiece.netGoldWeight } : {}),
    weights,
    input: piece.goldValuation,
    configuredVatRate: context.vatRateDefault,
  });
  const loosePurchase = looseProfileFinanceService.calculatePurchase({ profile, input: piece.looseFinancial || piece, configuredVatRate: context.vatRateDefault });
  const purchaseCost = specializedValuation
    ? Number(specializedValuation.purchase.totalPurchaseCost)
    : loosePurchase ? Number(loosePurchase.vatBase) : finiteOrNull(piece.purchaseCost ?? piece.unitCost, "PURCHASE_COST");
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
  const currentValuation = specializedValuation?.current
    ?? piece.currentValuation
    ?? (loosePurchase && piece.looseCurrentValuation
      ? looseProfileFinanceService.calculateCurrent({ profile, input: piece.looseCurrentValuation, configuredVatRate: context.vatRateDefault })
      : null);
  if (isLooseDiamond) {
    const sale = salePricingService.calculateLooseProfileSalePrice({
      profile,
      currentTotalCost: currentValuation?.totalValue ?? 0,
      markupPercent: pricing.markupPercent,
      sellingPrice: piece.sellingPrice ?? piece.salePrice ?? pricing.sellingPrice,
      maximumDiscountPercent: pricing.maximumDiscountPercent,
      minimumSellingPrice: pricing.minimumSellingPrice,
      proposedDiscount: pricing.proposedDiscount,
      configuredVatRate: context.vatRateDefault,
    });
    if (sale.approvalRequired) throw new ValidationError("LOOSE_DIAMOND_SALE_PRICE_BELOW_MINIMUM");
  }

  return Object.freeze({
    ...piece,
    // Shared receive carries tax authority at the document envelope.  Keep it
    // on the normalized physical piece for profile calculators without
    // creating a second tax engine or allowing a client rate to override the
    // company policy.
    taxTreatment: piece.taxTreatment ?? context.item?.taxTreatment,
    taxContext: piece.taxContext ?? context.item?.taxContext,
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
    componentCost: diamondPiece?.componentCost ?? finiteOrNull(piece.componentCost, "COMPONENT_COST"),
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
    currentValuation,
    pricing,
  });
}

function looseDetailsAsPrimarySubject(looseDetails) {
  if (!looseDetails) return null;
  const base = {
    role: "PRIMARY_SUBJECT", componentKind: looseDetails.kind, componentCount: 1, sequence: 0,
    name: looseDetails.stoneName || (looseDetails.kind === "PEARL" ? "لؤلؤ" : "حجر"),
    componentType: looseDetails.diamondType || looseDetails.pearlType || null,
    componentCarat: looseDetails.carat, componentWeight: looseDetails.totalPearlWeight || null,
    measurementUnit: looseDetails.kind === "PEARL" || (looseDetails.carat !== null && looseDetails.carat !== undefined) ? "CT" : "GRAM", notes: looseDetails.notes,
  };
  if (looseDetails.kind === "DIAMOND") return { ...base, diamondDetails: looseDetails };
  if (looseDetails.kind === "GEMSTONE") return { ...base, gemstoneDetails: looseDetails };
  return { ...base, pearlDetails: looseDetails };
}

async function recordAssetEvent({ models, transaction, asset, context, eventType, oldStatus = null, newStatus, sourceType, sourceId, note, idempotencyKey = null, oldContextExtra = {}, newContextExtra = {} }) {
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
    employeeCode: context.employeeCode || null,
    employeeName: context.actorName || null,
    branch: context.branchName,
    note,
    notes: note,
    sourceDocument: sourceId,
    sourceType,
    sourceId,
    beforeState: oldStatus ? `operational_status:${oldStatus}` : null,
    afterState: `operational_status:${newStatus}`,
    oldContext: oldStatus ? { operationalStatus: oldStatus, ...oldContextExtra } : null,
    newContext: { operationalStatus: newStatus, inventoryProfile: asset.inventoryProfile, ...newContextExtra },
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

function resolveReceiptEvidenceOrdinal({ piece = {}, pieceIndex } = {}) {
  const candidates = [piece.pieceIndex, pieceIndex];
  const zeroBased = candidates.find((value) => {
    if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0;
    if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number.isSafeInteger(Number(value));
    return false;
  });
  if (zeroBased === undefined) throw new ValidationError("INVENTORY_V2_RECEIPT_EVIDENCE_ORDINAL_INVALID");
  const ordinal = Number(zeroBased) + 1;
  if (!Number.isFinite(ordinal) || !Number.isSafeInteger(ordinal) || ordinal < 1) {
    throw new ValidationError("INVENTORY_V2_RECEIPT_EVIDENCE_ORDINAL_INVALID");
  }
  return ordinal;
}

async function persistReceiptEvidence({ models, transaction, asset, poItem, piece, pieceIndex, context }) {
  const receivedAt = context.occurredAt || new Date();
  const revisionId = newId("IMCOST");
  const ordinal = resolveReceiptEvidenceOrdinal({ piece, pieceIndex });
  await models.sequelize.query(`INSERT INTO asset_origins
    (id,asset_id,company_id,branch_id,origin_type,purchase_order_item_id,received_at,received_by,mapping_classification)
    VALUES (:id,:assetId,:companyId,:branchId,'PURCHASE_ORDER',:poItemId,:receivedAt,:receivedBy,'V2_RUNTIME_RECEIPT')`, {
    replacements: { id: newId("IMORIGIN"), assetId: asset.id, companyId: context.companyId, branchId: context.branchId, poItemId: poItem.id, receivedAt, receivedBy: context.actorId || null }, transaction,
  });
  await models.sequelize.query(`INSERT INTO purchase_order_item_asset_links
    (id,purchase_order_item_id,asset_id,company_id,ordinal,received_at,received_by,mapping_classification)
    VALUES (:id,:poItemId,:assetId,:companyId,:ordinal,:receivedAt,:receivedBy,'V2_RUNTIME_RECEIPT')`, {
    replacements: { id: newId("IMPO"), poItemId: poItem.id, assetId: asset.id, companyId: context.companyId, ordinal, receivedAt, receivedBy: context.actorId || null }, transaction,
  });
  await models.sequelize.query(`INSERT INTO asset_purchase_cost_revisions
    (id,asset_id,company_id,branch_id,revision_no,currency,purchase_gold_rate,gold_rate_source,gold_value,making_per_gram,making_total,certificate_cost,component_cost,vat_enabled,vat_rate,vat_rate_source,vat_base,vat_amount,total_purchase_cost,supplier_id,purchase_date,purchase_order_item_id,is_current,created_by,provenance,mapping_classification)
    VALUES (:id,:assetId,:companyId,:branchId,1,:currency,:purchaseGoldRate,:goldRateSource,:goldValue,:makingPerGram,:makingTotal,:certificateCost,:componentCost,:vatEnabled,:vatRate,:vatRateSource,:vatBase,:vatAmount,:totalPurchaseCost,:supplierId,:purchaseDate,:poItemId,true,:createdBy,:provenance,'V2_RUNTIME_RECEIPT')`, {
    replacements: {
      id: revisionId, assetId: asset.id, companyId: context.companyId, branchId: context.branchId, currency: context.currency || null,
      purchaseGoldRate: piece.purchaseGoldRate ?? null, goldRateSource: piece.goldRateSource || null, goldValue: piece.loosePurchase?.purchaseBaseCost ?? piece.goldValue,
      makingPerGram: piece.makingPerGram ?? null, makingTotal: piece.makingTotal ?? null, certificateCost: piece.certificateCost ?? null,
      componentCost: piece.loosePurchase?.additionalCost ?? piece.componentCost ?? null, vatEnabled: Number(piece.vat.vatRate) > 0, vatRate: piece.vat.vatRate,
      vatRateSource: piece.vat.vatRateSource, vatBase: piece.vat.vatBase, vatAmount: piece.vat.vatAmount,
      totalPurchaseCost: piece.purchaseCost, supplierId: context.supplierId, purchaseDate: context.purchaseDate, poItemId: poItem.id,
      createdBy: context.actorId || null, provenance: JSON.stringify({
        contract: "V2_RUNTIME_RECEIPT", profile: piece.profile, perPiece: true,
        ...(piece.goldValuation?.rateSnapshot ? { goldRateSnapshot: piece.goldValuation.rateSnapshot } : {}),
        ...(piece.__gbpCalculation ? { calculationAuthority: "GBP_03_R2_GOLD_CENTER_GLOBAL_SPOT", currentRateType: piece.goldValuation?.currentRateType || "GLOBAL" } : {}),
      }),
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
  const assertCertificateAvailable = async (certificate) => {
    if (!certificate || piece.profile !== "DIAMOND_JEWELLERY") return;
    const duplicate = await models.sequelize.query(`SELECT ac.id
      FROM asset_certificates ac
      INNER JOIN assets a ON a.id=ac.asset_id
      WHERE a.company_id=:companyId
        AND lower(ac.issuer)=lower(:issuer)
        AND ac.certificate_number=:certificateNumber
      LIMIT 1`, {
      replacements: { companyId: context.companyId, issuer: certificate.issuer || certificate.authority, certificateNumber: certificate.certificateNumber },
      transaction, type: models.sequelize.QueryTypes.SELECT,
    });
    if (duplicate[0]) throw new ValidationError("DIAMOND_CERTIFICATE_DUPLICATE");
  };
  await assertCertificateAvailable(effectiveCertificate);
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
  let componentsWithCertificates = piece.components;
  if (piece.profile === "DIAMOND_JEWELLERY" && Array.isArray(piece.components)) {
    componentsWithCertificates = [];
    for (const component of piece.components) {
      if (!component.certificate) { componentsWithCertificates.push(component); continue; }
      const issuer = component.certificate.authority || component.certificate.issuer;
      const certificate = { ...component.certificate, issuer, issueDate: component.certificate.issueDate || context.purchaseDate };
      await assertCertificateAvailable(certificate);
      const certificateId = newId("IMCERT");
      await models.AssetCertificate.create({
        id: certificateId, assetId: asset.id, type: "DIAMOND_COMPONENT_CERTIFICATE", issuer,
        certificateNumber: certificate.certificateNumber, issueDate: certificate.issueDate, url: certificate.url || null,
      }, { transaction });
      componentsWithCertificates.push({ ...component, certificateId });
    }
  }
  const resolvedPiece = { ...piece, components: componentsWithCertificates, looseDetails: resolvedLoose.details };
  const loosePrimarySubject = looseDetailsAsPrimarySubject(resolvedPiece.looseDetails);
  await persistAssetComponents({ models, transaction, asset, components: loosePrimarySubject ? [loosePrimarySubject] : resolvedPiece.components, companyId: context.companyId });
  await profileMasterDataService.persistAssetReferences({ models, companyId: context.companyId, assetId: asset.id, references: resolvedLoose.references, transaction });
  const currentValuation = piece.currentValuation || (piece.profile === "LOOSE_DIAMOND" ? null : {
    rateSource: "RECEIPT_INITIAL", goldRate: piece.purchaseGoldRate ?? null, goldValue: piece.goldValue,
    makingValue: piece.makingTotal ?? null, certificateValue: piece.certificateCost,
    componentValue: piece.componentCost ?? null, vatRate: piece.vat.vatRate,
    vatRateSource: piece.vat.vatRateSource, vatBase: piece.vat.vatBase,
    vatAmount: piece.vat.vatAmount, totalValue: piece.purchaseCost,
  });
  if (currentValuation) await models.sequelize.query(`INSERT INTO asset_current_valuations
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

async function transitionAsset({ models, transaction, asset, assetId = null, context, toStatus, eventType, movementType, sourceType, sourceId, note, idempotencyKey = null, toBranchId = null, toLocationId = null }) {
  if (!transaction) throw new Error("INVENTORY_CANONICAL_TRANSITION_TRANSACTION_REQUIRED");
  const id = assetId || asset?.id;
  if (!id) throw new Error("INVENTORY_CANONICAL_TRANSITION_ASSET_REQUIRED");
  // The public canonical entrypoint owns serialization.  A caller supplied
  // model can only identify the Asset; final state validation always reads the
  // PostgreSQL row under FOR UPDATE in this exact transaction.
  const lockedAsset = await models.Asset.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
  if (!lockedAsset) throw new Error("INVENTORY_CANONICAL_TRANSITION_ASSET_NOT_FOUND");
  if (!context?.companyId || context.companyId !== lockedAsset.companyId) throw new Error("INVENTORY_CANONICAL_TRANSITION_COMPANY_SCOPE_INVALID");
  const fromStatus = operationalStatusOf(lockedAsset);
  if (!TRANSITIONS[fromStatus]?.has(toStatus)) throw new Error(`INVENTORY_V2_INVALID_STATE_TRANSITION:${fromStatus}:${toStatus}`);
  if (fromStatus === "PENDING_INTEGRATION" && toStatus === "AVAILABLE") {
    if (lockedAsset.source !== "customer_gold_purchase" || lockedAsset.inventoryProfile !== "CGP_CUSTOMER_GOLD_PURCHASE" || context.cgpAvailabilityCapability !== CGP_AVAILABILITY_CAPABILITY) {
      throw new Error("INVENTORY_CGP_PENDING_AVAILABLE_EVALUATOR_REQUIRED");
    }
  }
  if (["PENDING_INTEGRATION", "AVAILABLE"].includes(fromStatus) && toStatus === "REVERSAL_PENDING") {
    if (lockedAsset.source !== "customer_gold_purchase" || lockedAsset.inventoryProfile !== "CGP_CUSTOMER_GOLD_PURCHASE" || context.cgpReversalHoldCapability !== CGP_REVERSAL_HOLD_CAPABILITY) {
      throw new Error("INVENTORY_CGP_REVERSAL_HOLD_AUTHORITY_REQUIRED");
    }
  }
  if (fromStatus === "REVERSAL_PENDING" && toStatus === "REVERSED" && context.cgpReversalFinalizeCapability !== CGP_REVERSAL_FINALIZE_CAPABILITY) {
    throw new Error("INVENTORY_CGP_REVERSAL_FINALIZER_REQUIRED");
  }
  const fromBranchId = lockedAsset.branchId;
  const fromLocationId = lockedAsset.locationId;
  await lockedAsset.update({ operationalStatus: toStatus, status: LEGACY_STATUS[toStatus], branchId: toBranchId || lockedAsset.branchId, locationId: toLocationId ?? lockedAsset.locationId, updatedBy: context.actorId || null }, { transaction, inventoryCanonicalTransition: true });
  const event = await recordAssetEvent({ models, transaction, asset: { ...lockedAsset.toJSON(), operationalStatus: toStatus }, context, eventType, oldStatus: fromStatus, newStatus: toStatus, sourceType, sourceId, note, idempotencyKey });
  await recordMovement({ models, transaction, asset: lockedAsset, context, movementType, sourceType, sourceId, eventId: event.id, fromBranchId, toBranchId: toBranchId || fromBranchId, fromLocationId, toLocationId: toLocationId ?? fromLocationId });
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

async function unassignRfid({ models, transaction, asset, context, reason, idempotencyKey }) {
  const normalizedReason = String(reason || "").trim();
  if (!normalizedReason) throw new Error("INVENTORY_V2_RFID_UNASSIGN_REASON_REQUIRED");
  const [current] = await models.sequelize.query(`SELECT id,rfid_number FROM asset_rfid_assignments
    WHERE asset_id=:assetId AND is_current=true AND status='ACTIVE' FOR UPDATE`, {
    replacements: { assetId: asset.id }, transaction,
  });
  if (!current.length) throw new Error("INVENTORY_V2_RFID_NOT_ASSIGNED");
  const assignment = current[0];
  const occurredAt = context.occurredAt || new Date();
  await models.sequelize.query(`UPDATE asset_rfid_assignments
    SET is_current=false,status='INACTIVE',ended_at=:occurredAt,ended_by=:actorId,replacement_reason=:reason
    WHERE id=:id`, {
    replacements: { id: assignment.id, occurredAt, actorId: context.actorId || null, reason: normalizedReason }, transaction,
  });
  await asset.update({ rfid: null, updatedBy: context.actorId || null }, { transaction });
  const event = await recordAssetEvent({
    models, transaction, asset, context, eventType: "RFID_UNASSIGNED",
    oldStatus: asset.operationalStatus, newStatus: asset.operationalStatus,
    sourceType: "RFID_ASSIGNMENT", sourceId: assignment.id,
    note: normalizedReason, idempotencyKey,
  });
  return { assignmentId: assignment.id, rfidNumber: assignment.rfid_number, eventId: event.id, reason: normalizedReason };
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
  await asset.update({
    tagState: "PRINTED",
    tagStateClassification: kind === "INITIAL" ? "V2_INITIAL_PRINTED" : "V2_REPRINTED",
    updatedBy: context.actorId || null,
  }, { transaction });
  await recordAssetEvent({ models, transaction, asset, context, eventType: kind === 'INITIAL' ? 'TAG_PRINTED' : 'TAG_REPRINTED', oldStatus: asset.operationalStatus, newStatus: asset.operationalStatus, sourceType: 'ASSET_TAG_PRINT', sourceId: id, note: reason || 'Barcode tag printed', idempotencyKey: `${idempotencyKey}:event` });
  return { id, printKind: kind, barcode: asset.barcode };
}

function normalizeComponentsForProfile(profile, components = []) {
  if (profile === "DIAMOND_JEWELLERY") return diamondJewelleryProfileService.normalizeComponents(components);
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
    const isDiamondJewelleryComponent = asset.inventoryProfile === "DIAMOND_JEWELLERY" && componentKind === "DIAMOND";
    const purchaseCostInput = component.purchaseCost ?? component.cost ?? component.stoneCost ?? component.pearlCost;
    const currentValueInput = component.currentValue ?? purchaseCostInput;
    const purchaseCost = isDiamondJewelleryComponent && (purchaseCostInput === undefined || purchaseCostInput === null || purchaseCostInput === "")
      ? null
      : (finiteOrNull(purchaseCostInput, "PURCHASE_COST") || 0);
    const currentValue = isDiamondJewelleryComponent && (currentValueInput === undefined || currentValueInput === null || currentValueInput === "")
      ? null
      : (finiteOrNull(currentValueInput, "CURRENT_VALUE") || 0);
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
          color: Array.isArray(d.color) ? d.color.join(", ") : (d.color ?? d.stoneColor ?? null),
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
      const settings = Array.isArray(g.settings)
        ? g.settings.map((value) => String(value).trim()).filter(Boolean)
        : (g.setting ? [String(g.setting).trim()] : []);
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
          setting: settings.length === 1 ? settings[0] : null,
        },
        transaction,
      });
      if (settings.length) {
        for (let settingIndex = 0; settingIndex < settings.length; settingIndex += 1) {
          const [master] = await models.sequelize.query(`SELECT id,canonical_value,display_label FROM profile_master_data
            WHERE company_id=:companyId AND category_key='GEMSTONE_SETTING' AND is_active=true
              AND (display_label=:label OR canonical_value=:value) LIMIT 1`, {
            replacements: { companyId, label: settings[settingIndex], value: settings[settingIndex].toLocaleLowerCase("en-US") },
            transaction, type: models.sequelize.QueryTypes.SELECT,
          });
          if (!master) throw new ValidationError("PROFILE_MASTER_DATA_ACTIVE_VALUE_REQUIRED");
          await models.sequelize.query(`INSERT INTO asset_gemstone_component_settings
            (id,component_id,company_id,master_data_id,sequence,value_snapshot,label_snapshot,created_at,updated_at)
            VALUES (:id,:componentId,:companyId,:masterDataId,:sequence,:valueSnapshot,:labelSnapshot,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, {
            replacements: { id: newId("IMGSET"), componentId, companyId, masterDataId: master.id, sequence: settingIndex, valueSnapshot: master.canonical_value, labelSnapshot: master.display_label }, transaction,
          });
        }
      }
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

module.exports = { OPERATIONAL_STATUS, CONDITION, TAG_STATE, EVENT_ONLY_TERMS, LEGACY_STATUS, TRANSITIONS, legacySubtypeForProfile, operationalStatusOf, createCgpAvailabilityTransitionContext, createCgpReversalHoldTransitionContext, createCgpReversalFinalizeTransitionContext, requireV2ReceiptPieces, normalizeReceiptPiece, resolveReceiptEvidenceOrdinal, looseDetailsAsPrimarySubject, newId, recordAssetEvent, recordMovement, persistReceiptEvidence, persistManufacturingEvidence, linkInvoiceAsset, transitionAsset, assignRfid, unassignRfid, recordRfidScan, recordTagPrint, normalizeComponentsForProfile, persistAssetComponents, fetchAssetComponents, updateAssetComponents };
