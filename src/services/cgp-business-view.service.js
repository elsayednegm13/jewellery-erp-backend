"use strict";

// Read-only business projection for the CGP workspace.  It deliberately
// composes already-owned records; it does not create a second posting,
// inventory, accounting, Gold Center, CRM, or settlement authority.
const { QueryTypes } = require("sequelize");
const models = require("../models");
const draftService = require("./gold-purchase-draft.service");
const { buildPaymentSummary } = require("./cgp-payment-summary");

async function getBusinessView({ context, id }) {
  const document = await draftService.findScoped("cgp", context, id, null, { includeVoided: true });
  const serialized = draftService.serialize(document);
  const eventId = serialized.postingReference || null;
  if (!eventId) {
    return {
      document: serialized,
      integrations: [],
      assets: [],
      accounting: null,
      goldCenter: null,
      crm: null,
      payable: null,
      settlements: [],
      reversal: null,
      pricingSnapshots: [],
    };
  }

  const replacements = { companyId: context.companyId, branchId: context.branchId, documentId: serialized.id, eventId };
  const [integrations, assets, pricingSnapshots, liability, goldCenter, reversal, settlements] = await Promise.all([
    models.IntegrationStatus.findAll({ where: { sourceEventId: eventId }, order: [["consumerName", "ASC"]] }),
    models.sequelize.query(`
      SELECT a.id,a.name,a.description,a.barcode,a.karat,a.gross_weight AS "grossWeight",
             a.net_weight AS "netWeight",a.gold_weight AS "pureGoldWeight",
             a.operational_status AS "operationalStatus",a.status,a.branch_id AS "branchId",
             ao.cgp_item_id AS "cgpItemId",a.source,a.inventory_profile AS "inventoryProfile"
      FROM asset_origins ao JOIN assets a ON a.id=ao.asset_id
      WHERE ao.company_id=:companyId AND ao.branch_id=:branchId AND ao.origin_type='CUSTOMER_GOLD_PURCHASE'
        AND ao.cgp_item_id IN (SELECT id FROM customer_gold_purchase_items WHERE document_id=:documentId)
      ORDER BY ao.cgp_item_id`, { replacements, type: QueryTypes.SELECT }),
    models.CgpPricingSnapshot.findAll({ where: { cgpDocumentId: serialized.id, companyId: context.companyId, branchId: context.branchId }, order: [["cgpItemId", "ASC"]] }),
    models.CustomerFinancialLiability.findOne({ where: { sourceEventId: eventId, sourceDocumentId: serialized.id, companyId: context.companyId, branchId: context.branchId } }),
    models.GoldCoreEvent.findOne({ where: { sourceEventId: eventId, sourceDocumentId: serialized.id, companyId: context.companyId, branchId: context.branchId } }),
    models.CgpReversalRequest.findOne({ where: { cgpDocumentId: serialized.id, companyId: context.companyId, branchId: context.branchId }, order: [["requestedAt", "DESC"]] }),
    models.sequelize.query(`
      SELECT s.id,s.total_amount AS "totalAmount",s.status,s.executed_at AS "executedAt",
             s.journal_entry_id AS "journalEntryId",l.method,l.amount,l.bank_reference AS "bankReference"
      FROM financial_settlements s
      LEFT JOIN financial_settlement_legs l ON l.settlement_id=s.id
      WHERE s.company_id=:companyId AND s.branch_id=:branchId AND s.source_document_id=:documentId
      ORDER BY s.executed_at DESC,l.id`, { replacements, type: QueryTypes.SELECT }),
  ]);

  const settlementRows = settlements || [];
  const paid = settlementRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const payable = liability ? {
    id: liability.id,
    originalAmount: liability.originalAmount,
    settledAmount: liability.settledAmount,
    outstandingAmount: liability.outstandingAmount,
    status: liability.status,
    journalEntryId: liability.journalEntryId,
    currency: liability.currency,
    paidFromSettlementRows: paid.toFixed(4),
  } : null;
  const integrationRows = integrations.map((row) => row.toJSON());
  const byConsumer = Object.fromEntries(integrationRows.map((row) => [String(row.consumerName).toUpperCase(), row]));
  const paymentSummary = buildPaymentSummary({
    originalAmount: serialized.totalPayableToCustomer,
    settledAmount: payable?.settledAmount,
    outstandingAmount: payable?.outstandingAmount,
    settlementPaidAmount: paid.toFixed(4),
  });
  return {
    document: serialized,
    integrations: integrationRows,
    integrationSummary: {
      inventory: byConsumer.INVENTORY || null,
      accounting: byConsumer.ACCOUNTING || null,
      goldCenter: byConsumer["GOLD_CENTER"] || byConsumer.GOLD || null,
      crm: byConsumer.CRM || null,
    },
    assets,
    accounting: liability ? { status: byConsumer.ACCOUNTING?.status || "PENDING", journalEntryId: liability.journalEntryId, recognizedValue: liability.originalAmount } : null,
    goldCenter: goldCenter?.toJSON?.() || null,
    crm: byConsumer.CRM || null,
    payable,
    settlements: settlementRows,
    // `paymentSummary` is additive; the legacy paid/remaining/status fields
    // remain available for existing clients while valid numeric zero is kept.
    settlementSummary: { ...paymentSummary, status: payable?.status || "NOT_RECOGNIZED" },
    reversal: reversal?.toJSON?.() || null,
    pricingSnapshots: pricingSnapshots.map((row) => row.toJSON()),
  };
}

module.exports = { getBusinessView };
