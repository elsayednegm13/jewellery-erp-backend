"use strict";

const Decimal = require("decimal.js");
const models = require("../models");
const settingsService = require("./settings.service");
const { AppError, NotFoundError, ValidationError } = require("../utils/errors");

const NOTICE_AR = "هذا إيصال استلام عربون وليس فاتورة ضريبية نهائية. تُحتسب ضريبة المنتج وتُثبت مرة واحدة عند إتمام البيع وإصدار الفاتورة النهائية.";
const NOTICE_EN = "This is a reservation deposit receipt, not a final tax invoice. Product tax is calculated and posted once when the sale is completed and the final invoice is issued.";
const SNAPSHOT_VERSION = 1;

function decimal(value) { return new Decimal(value || 0); }
function money(value) { return decimal(value).toDecimalPlaces(4).toFixed(4); }
function documentId() { return `RDR-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

function receiptResource(receipt) {
  if (!receipt) return null;
  const snapshot = receipt.snapshot || {};
  return {
    id: receipt.id,
    receiptNumber: receipt.receiptNumber,
    reservationId: receipt.reservationId,
    paymentId: receipt.reservationPaymentId,
    branchId: receipt.branchId,
    postedAt: receipt.postedAt,
    status: receipt.status,
    snapshotVersion: receipt.snapshotVersion,
    snapshot
  };
}

function historyRow(receipt) {
  const snapshot = receipt.snapshot || {};
  const financial = snapshot.financialSummary || {};
  const payment = snapshot.payment || {};
  return {
    id: receipt.id,
    receiptNumber: receipt.receiptNumber,
    paymentId: receipt.reservationPaymentId,
    postedAt: receipt.postedAt,
    employee: snapshot.employee || null,
    paymentMethod: payment.method || null,
    paymentReference: payment.externalReference || null,
    currentPaymentAmount: payment.amount || "0.0000",
    previousReceivedTotal: financial.previousReceived || "0.0000",
    cumulativeReceivedTotal: financial.cumulativeReceived || "0.0000",
    executedRefundTotal: financial.executedRefunds || "0.0000",
    netRetainedDeposit: financial.netRetained || "0.0000",
    remainingAmountDue: financial.remainingAmountDue || "0.0000",
    currency: payment.currency || null,
    status: receipt.status,
    legacy: false
  };
}

async function allocateNumber({ companyId, branchId, branchCode, postedAt, transaction }) {
  const year = new Date(postedAt).getUTCFullYear();
  if (!Number.isInteger(year)) throw new AppError("Receipt posting date is invalid.", 422, "DEPOSIT_RECEIPT_DATE_INVALID");
  await models.sequelize.query(
    `INSERT INTO reservation_deposit_receipt_sequences (company_id, branch_id, sequence_year, next_value, created_at, updated_at)
     VALUES (:companyId, :branchId, :year, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT (company_id, branch_id, sequence_year) DO NOTHING`,
    { replacements: { companyId, branchId, year }, transaction }
  );
  const [rows] = await models.sequelize.query(
    `UPDATE reservation_deposit_receipt_sequences
       SET next_value = next_value + 1, updated_at = CURRENT_TIMESTAMP
     WHERE company_id = :companyId AND branch_id = :branchId AND sequence_year = :year
     RETURNING next_value - 1 AS value`,
    { replacements: { companyId, branchId, year }, transaction }
  );
  const value = Number(rows?.[0]?.value);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new AppError("Unable to allocate a deposit receipt number.", 500, "DEPOSIT_RECEIPT_NUMBER_ALLOCATION_FAILED");
  }
  const code = String(branchCode || branchId).trim().toUpperCase();
  if (!code) throw new AppError("Receipt branch code is required.", 422, "DEPOSIT_RECEIPT_BRANCH_CODE_REQUIRED");
  return { year, value, receiptNumber: `DEP-${code}-${year}-${String(value).padStart(6, "0")}` };
}

async function buildSnapshot({ receiptId, payment, reservation, actor, transaction, allocation }) {
  const [company, branch, customer, items, refunds, payments, settings] = await Promise.all([
    models.Company.findOne({ where: { id: payment.companyId }, transaction, lock: transaction.LOCK.UPDATE }),
    models.Branch.findOne({ where: { id: payment.branchId, companyId: payment.companyId }, transaction, lock: transaction.LOCK.UPDATE }),
    models.Customer.findOne({ where: { id: payment.customerId, companyId: payment.companyId }, transaction, lock: transaction.LOCK.UPDATE }),
    models.ReservationItem.findAll({ where: { companyId: payment.companyId, reservationId: payment.reservationId, status: "active" }, transaction, lock: transaction.LOCK.UPDATE }),
    models.ReservationRefund.findAll({ where: { companyId: payment.companyId, reservationId: payment.reservationId, status: "executed" }, transaction, lock: transaction.LOCK.UPDATE }),
    models.ReservationPayment.findAll({ where: { companyId: payment.companyId, reservationId: payment.reservationId, status: "posted" }, transaction, lock: transaction.LOCK.UPDATE }),
    settingsService.getCompanySettings(payment.companyId, { transaction })
  ]);
  if (!company || !branch || !customer || !reservation) {
    throw new AppError("Required receipt identity data is unavailable.", 422, "DEPOSIT_RECEIPT_IDENTITY_REQUIRED");
  }
  const assetIds = items.map((item) => item.assetId).filter(Boolean);
  const assets = assetIds.length ? await models.Asset.findAll({ where: { companyId: payment.companyId, id: assetIds }, transaction, lock: transaction.LOCK.UPDATE }) : [];
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const current = decimal(payment.amount);
  const cumulative = payments.reduce((sum, row) => sum.plus(decimal(row.amount)), new Decimal(0));
  const previous = cumulative.minus(current);
  const executedRefunds = refunds.reduce((sum, row) => sum.plus(decimal(row.amount)), new Decimal(0));
  const gross = decimal(reservation.agreedTotal);
  const vatRate = decimal(settings?.vatRate);
  const productTax = vatRate.gt(0) ? gross.mul(vatRate).div(vatRate.plus(100)) : new Decimal(0);
  const netRetained = cumulative.minus(executedRefunds);
  const products = items.map((item) => {
    const asset = assetsById.get(item.assetId);
    return {
      id: item.assetId,
      name: item.assetName,
      code: asset?.barcode || asset?.inventoryCode || item.assetId,
      description: item.itemType || null,
      weight: asset?.netWeight != null ? money(asset.netWeight) : null,
      karat: asset?.karat || null,
      metal: asset?.type || null,
      stone: asset?.stoneDetails || null,
      specification: asset?.metadata || null,
      agreedPrice: money(item.agreedPrice)
    };
  });
  return {
    schemaVersion: SNAPSHOT_VERSION,
    document: {
      id: receiptId, receiptNumber: allocation.receiptNumber, status: "issued",
      postedAt: new Date(payment.receivedAt).toISOString(), reservationId: reservation.id,
      paymentId: payment.id, paymentReference: payment.sourceReference || null
    },
    company: {
      name: company.businessName, logo: company.logo || null, taxNumber: company.taxNumber || null,
      commercialRegister: company.commercialRegister || null,
      address: [company.address1, company.address2, company.city, company.country].filter(Boolean).join(", ") || null,
      phone: company.phone || null, email: company.email || null, website: company.website || null,
      footer: settings?.receipt?.footer || null
    },
    branch: { name: branch.name, code: branch.code, address: branch.address || null, phone: branch.phone || null },
    customer: { id: customer.id, name: customer.name, code: customer.id, phone: customer.phone || null },
    employee: { id: payment.receivedEmployeeId || null, name: payment.receivedBy || actor || null },
    products,
    productTotals: { preTax: money(gross.minus(productTax)), tax: money(productTax), taxInclusive: money(gross), vatRate: money(vatRate) },
    payment: { method: payment.paymentMethod, channel: payment.paymentMethod, externalReference: payment.sourceReference || null, amount: money(current), currency: payment.currency, depositTaxAmount: "0.0000" },
    financialSummary: {
      previousReceived: money(previous), cumulativeReceived: money(cumulative), executedRefunds: money(executedRefunds),
      netRetained: money(netRetained), remainingAmountDue: money(Decimal.max(0, gross.minus(netRetained)))
    },
    notices: { ar: NOTICE_AR, en: NOTICE_EN }
  };
}

async function createImmutableDocument({ payment, reservation, actor, transaction, allocation }) {
  const receiptId = documentId();
  const snapshot = await buildSnapshot({ receiptId, payment, reservation, actor, transaction, allocation });
  return models.ReservationDepositReceiptDocument.create({
    id: receiptId, companyId: payment.companyId, branchId: payment.branchId, reservationId: payment.reservationId,
    reservationPaymentId: payment.id, customerId: payment.customerId, employeeId: payment.receivedEmployeeId || null,
    receiptNumber: allocation.receiptNumber, sequenceYear: allocation.year, sequenceValue: allocation.value,
    postedAt: payment.receivedAt, status: "issued", snapshotVersion: SNAPSHOT_VERSION, snapshot,
    createdBy: payment.receivedBy || actor || null
  }, { transaction });
}

async function receiptInScope({ companyId, branchId, where }) {
  const receipt = await models.ReservationDepositReceiptDocument.findOne({ where: { companyId, ...where } });
  if (!receipt) throw new NotFoundError("Deposit receipt not found");
  if (!branchId || String(receipt.branchId) !== String(branchId)) throw new NotFoundError("Deposit receipt not found");
  return receipt;
}

async function readById({ companyId, branchId, receiptId }) {
  return receiptResource(await receiptInScope({ companyId, branchId, where: { id: receiptId } }));
}

async function readByNumber({ companyId, branchId, receiptNumber }) {
  const value = String(receiptNumber || "").trim();
  if (value.length < 8 || value.length > 180) throw new ValidationError("Invalid receipt number");
  return receiptResource(await receiptInScope({ companyId, branchId, where: { receiptNumber: value } }));
}

async function readByPaymentId({ companyId, branchId, paymentId }) {
  const payment = await models.ReservationPayment.findOne({ where: { id: paymentId, companyId } });
  if (!payment || !branchId || String(payment.branchId) !== String(branchId)) throw new NotFoundError("Deposit receipt not found");
  const receipt = await models.ReservationDepositReceiptDocument.findOne({ where: { companyId, reservationPaymentId: payment.id } });
  if (!receipt) throw new AppError("This payment predates immutable receipt issuance.", 409, "LEGACY_PAYMENT_WITHOUT_IMMUTABLE_RECEIPT");
  return receiptResource(receipt);
}

async function history({ companyId, branchId, reservationId, page = 1, pageSize = 50 }) {
  const reservation = await models.Reservation.findOne({ where: { id: reservationId, companyId } });
  if (!reservation || !branchId || String(reservation.branchId) !== String(branchId)) throw new NotFoundError("Reservation not found");
  if (!reservation.branchId) throw new AppError("Branchless legacy reservations require manual review.", 409, "LEGACY_BRANCHLESS_RESERVATION_MANUAL_REVIEW");
  const safePage = Math.max(Number.parseInt(page, 10) || 1, 1);
  const safePageSize = Math.min(Math.max(Number.parseInt(pageSize, 10) || 50, 1), 200);
  const { rows, count } = await models.ReservationDepositReceiptDocument.findAndCountAll({
    where: { companyId, branchId, reservationId }, order: [["postedAt", "DESC"], ["id", "DESC"]],
    limit: safePageSize, offset: (safePage - 1) * safePageSize
  });
  return { items: rows.map(historyRow), total: count, page: safePage, pageSize: safePageSize, totalPages: Math.max(Math.ceil(count / safePageSize), 1) };
}

module.exports = {
  NOTICE_AR, NOTICE_EN, SNAPSHOT_VERSION, allocateNumber, createImmutableDocument,
  receiptResource, historyRow, readById, readByNumber, readByPaymentId, history
};
