const { Op, QueryTypes } = require("sequelize");
const models = require("../models");
const postingService = require("./posting.service");
const auditService = require("./audit.service");
const idempotencyService = require("./idempotency.service");
const settingsService = require("./settings.service");
const permissionService = require("./permission.service");
const notificationService = require("./notification.service");
const { SYSTEM_ACCOUNT_ROLES, resolveSystemAccountRole } = require("./company-bootstrap.service");
const { requireOperationalBranch, assertBranchCustomer, assertSameBranch } = require("./branch-isolation.service");
const { AppError, ValidationError, NotFoundError, ConflictError } = require("../utils/errors");

// Bilingual, stable-coded errors for reservation deposit configuration and the
// mandatory initial-payment rule (Phase 32.6-Post-C). The message carries both
// Arabic and English so the frontend can display a clear localized string, and
// the errorCode is a stable semantic identifier for error mapping.
function reservationConfigError(code, ar, en) {
  return new AppError(`${ar} | ${en}`, 422, code);
}

const MONEY_SCALE = 100000000n;
const DISPLAY_SCALE = 10000n;
const RESERVED_STATUSES = new Set(["reserved"]);
const INELIGIBLE_RESERVATION_STATUSES = new Set(["completed", "cancelled", "cancelled_refund_pending", "refunded", "expired"]);

function nowStamp() {
  return Date.now();
}

function actorName(user) {
  if (!user) return "System";
  return [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || user.id || "System";
}

async function reservationVisibilityWhere(companyId, user, branchId) {
  const where = { companyId };
  // A supplied branch is server-authenticated context, not a client filter.
  // It must scope every operational reservation read, including users who can
  // otherwise read company-wide reservation lists.
  if (branchId) {
    where.branchId = branchId;
    return where;
  }
  if (user?.accountType === "branch_shell") {
    where.branchId = branchId || user.branchId || "__NO_VISIBLE_RESERVATION_SCOPE__";
    return where;
  }
  if (!user || ["admin", "owner"].includes(user.role)) return where;
  if (await permissionService.userHasPermission(user, "reservations.view_all")) return where;
  if (await permissionService.userHasPermission(user, "sales.view")) return where;
  if (await permissionService.userHasPermission(user, "reservations.view_branch")) {
    where.branchId = branchId || user.branchId || null;
    return where;
  }
  if (await permissionService.userHasPermission(user, "reservations.view_own")) {
    where[Op.or] = [
      { createdBy: actorName(user) },
      { updatedBy: actorName(user) },
    ];
    return where;
  }
  where.id = "__NO_VISIBLE_RESERVATION_SCOPE__";
  return where;
}

async function requireReservationInBranch({ companyId, branchId, reservationId, transaction = null, lock = false }) {
  const branch = await requireOperationalBranch({ companyId, branchId, transaction });
  const reservation = await models.Reservation.findOne({
    where: { id: reservationId, companyId, branchId: branch.id },
    transaction,
    lock: lock && transaction ? transaction.LOCK.UPDATE : undefined,
  });
  if (!reservation) throw new NotFoundError("Reservation not found");
  return reservation;
}

function parseMoneyUnits(value, fieldName = "amount") {
  if (value === null || value === undefined || value === "") return 0n;
  const raw = String(value).trim();
  if (!/^\d+(\.\d{1,8})?$/.test(raw)) {
    throw new ValidationError(`${fieldName} must be a positive decimal with up to 8 decimals`);
  }
  const [whole, frac = ""] = raw.split(".");
  return BigInt(whole) * MONEY_SCALE + BigInt((frac + "00000000").slice(0, 8));
}

function formatMoney(units) {
  const sign = units < 0n ? "-" : "";
  const abs = units < 0n ? -units : units;
  const whole = abs / MONEY_SCALE;
  const frac = (abs % MONEY_SCALE).toString().padStart(8, "0").replace(/0+$/, "");
  return `${sign}${whole}${frac ? `.${frac}` : ".0000"}`;
}

function toNumber(units) {
  return Number(formatMoney(units));
}

function compareMoney(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function treasuryAccountCode(paymentMethod = "cash") {
  const method = String(paymentMethod || "cash").toLowerCase();
  return method.includes("card") || method.includes("bank") || method.includes("شبك") || method.includes("تحويل")
    ? "1120"
    : "1110";
}

function paymentMethodFromTreasuryCode(code = "1110") {
  return String(code) === "1120" ? "bank" : "cash";
}

function accountNameFromCode(code = "1110") {
  return String(code) === "1120" ? "bank" : "cash";
}

function roundMoneyNumber(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function vatInclusiveTotalsFromGross(grossTotal, vatRatePercent = 0) {
  const total = roundMoneyNumber(grossTotal);
  const rate = Number(vatRatePercent) || 0;
  if (rate <= 0) {
    return { subtotal: total, taxBase: total, tax: 0, total, vatRate: rate };
  }
  const taxBase = roundMoneyNumber(total / (1 + rate / 100));
  const tax = roundMoneyNumber(total - taxBase);
  return { subtotal: taxBase, taxBase, tax, total, vatRate: rate };
}

async function nextInvoiceNumber(companyId, prefix, transaction) {
  const rows = await models.Invoice.findAll({
    where: {
      companyId,
      [Op.or]: [
        { id: { [Op.like]: `${prefix}-%` } },
        { invoiceNumber: { [Op.like]: `${prefix}-%` } },
      ],
    },
    attributes: ["id", "invoiceNumber"],
    paranoid: false,
    transaction,
  });
  let max = 0;
  const consider = (val) => {
    if (typeof val === "string" && val.startsWith(`${prefix}-`)) {
      const n = parseInt(val.slice(prefix.length + 1), 10);
      if (Number.isInteger(n) && n > max) max = n;
    }
  };
  for (const r of rows) {
    consider(r.id);
    consider(r.invoiceNumber);
  }
  return `${prefix}-${String(max + 1).padStart(6, "0")}`;
}

function normalizeItems(body) {
  const source = Array.isArray(body.items) && body.items.length
    ? body.items
    : body.assetId
      ? [{ assetId: body.assetId, agreedPrice: body.agreedPrice }]
      : [];
  if (!source.length) throw new ValidationError("Reservation requires at least one asset item");

  const seen = new Set();
  return source.map((item, index) => {
    const assetId = String(item.assetId || item.id || "").trim();
    if (!assetId) throw new ValidationError(`Reservation item ${index + 1} is missing assetId`);
    if (seen.has(assetId)) throw new ConflictError("The same asset cannot appear twice in one reservation");
    seen.add(assetId);
    return {
      assetId,
      agreedPrice: item.agreedPrice !== undefined && item.agreedPrice !== null ? item.agreedPrice : item.price
    };
  });
}

function normalizeInitialPayment(body) {
  const source = body.initialPayment || {};
  const amount = source.amount !== undefined && source.amount !== null ? source.amount : body.deposit;
  const amountUnits = parseMoneyUnits(amount || 0, "initial payment amount");
  if (amountUnits === 0n) return null;
  return {
    amountUnits,
    paymentMethod: source.paymentMethod || body.paymentMethod || "cash",
    receivedEmployeeId: source.receivedEmployeeId || body.receivedEmployeeId || null,
    sourceReference: source.sourceReference || null
  };
}

async function getReservationAdvancesAccount(companyId, branchId, transaction) {
  // Posting never accepts or selects a liability account from the request.
  return resolveSystemAccountRole(companyId, branchId, SYSTEM_ACCOUNT_ROLES.CUSTOMER_DEPOSIT_LIABILITY, transaction);
}

function reservationStatusForTotals(paidUnits, agreedUnits) {
  if (paidUnits === 0n) return "active";
  if (paidUnits < agreedUnits) return "partially_paid";
  return "fully_paid";
}

async function calculatePostedPayments(reservationId, companyId, transaction) {
  const payments = await models.ReservationPayment.findAll({
    where: { reservationId, companyId, status: "posted" },
    transaction,
    lock: true
  });
  return payments.reduce((sum, payment) => sum + parseMoneyUnits(payment.amount, "posted payment amount"), 0n);
}

async function calculateActiveItemTotal(reservationId, companyId, transaction) {
  const items = await models.ReservationItem.findAll({
    where: { reservationId, companyId, status: "active" },
    transaction,
    lock: true
  });
  return items.reduce((sum, item) => sum + parseMoneyUnits(item.agreedPrice, "item agreed price"), 0n);
}

async function audit(companyId, action, payload, transaction) {
  await auditService.record(companyId, {
    action,
    description: payload.description || action,
    user: payload.user || "System",
    userId: payload.userId || null,
    place: payload.branchId || "Reservation",
    sourceDocument: payload.reservationId,
    severity: payload.severity || "info",
    before: payload.before ? JSON.stringify(payload.before) : null,
    after: payload.after ? JSON.stringify(payload.after) : null
  }, { transaction });
}

async function notifyReservation(companyId, event, reservation, payload = {}, transaction) {
  await notificationService.createNotification(companyId, {
    title: payload.title || `Reservation ${event}`,
    message: payload.message || `Reservation ${reservation.id} ${event}.`,
    type: payload.type || "info",
    entityType: "Reservation",
    entityId: reservation.id,
    sourceType: "reservation",
    sourceId: reservation.id,
    eventKey: `${companyId}:reservation:${reservation.id}:${event}:${payload.sourceId || ""}`,
  }, { transaction });
}

function uid(prefix) {
  return `${prefix}-${nowStamp()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Trusted current time is read from the database, never from the client, so
// expiry eligibility and extension bounds cannot be manipulated by a caller.
async function trustedNow(transaction) {
  const [row] = await models.sequelize.query("SELECT now() AS now", {
    type: QueryTypes.SELECT,
    transaction
  });
  return new Date(row.now);
}

function parseExpiry(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Server-trusted current agreed price for an asset (VAT-inclusive snapshot).
// The client never supplies reservation prices; every amendment/renewal price
// is resolved from the asset record.
function currentAssetPriceUnits(asset) {
  const units = parseMoneyUnits(asset.price, "asset price");
  if (units <= 0n) throw new ValidationError(`Asset ${asset.id} has no valid current price`);
  return units;
}

// Per-payment transferable/refundable availability for a renewal source
// reservation: posted payment value that has not already been transferred out
// or refunded. Original payment rows are never mutated; the transfer and refund
// subledgers are the source of truth.
async function sourcePaymentAvailability(reservationId, companyId, transaction) {
  const payments = await models.ReservationPayment.findAll({
    where: { reservationId, companyId, status: "posted" },
    transaction,
    lock: true,
    order: [["receivedAt", "ASC"], ["id", "ASC"]]
  });
  const availability = [];
  for (const payment of payments) {
    const paidUnits = parseMoneyUnits(payment.amount, "posted payment amount");
    const transfers = await models.ReservationPaymentTransfer.findAll({
      where: { sourcePaymentId: payment.id, companyId, status: "posted" },
      transaction
    });
    const transferredUnits = transfers.reduce((sum, t) => sum + parseMoneyUnits(t.amount, "transfer amount"), 0n);
    const allocations = await models.ReservationRefundAllocation.findAll({
      where: { reservationPaymentId: payment.id, companyId },
      transaction
    });
    const refundedUnits = allocations.reduce((sum, a) => sum + parseMoneyUnits(a.allocatedAmount, "allocated amount"), 0n);
    const remaining = paidUnits - transferredUnits - refundedUnits;
    if (remaining > 0n) availability.push({ payment, remaining });
  }
  return availability;
}

async function calculateTransferableUnits(reservationId, companyId, transaction) {
  const availability = await sourcePaymentAvailability(reservationId, companyId, transaction);
  const units = availability.reduce((sum, a) => sum + a.remaining, 0n);
  return { units, availability };
}

// Greedily allocate a target amount across available source payments without
// exceeding any payment's remaining transferable/refundable balance.
function allocateAcrossPayments(availability, targetUnits) {
  const allocations = [];
  let remaining = targetUnits;
  for (const entry of availability) {
    if (remaining <= 0n) break;
    const take = entry.remaining < remaining ? entry.remaining : remaining;
    if (take > 0n) {
      allocations.push({ payment: entry.payment, units: take });
      entry.remaining -= take;
      remaining -= take;
    }
  }
  if (remaining > 0n) throw new ConflictError("Insufficient source balance to allocate the requested transfer/refund amount");
  return allocations;
}

class ReservationService {
  async list({ companyId, query = {}, user = null, branchId = null }) {
    const page = Math.max(parseInt(query.page || "1", 10), 1);
    const pageSize = Math.min(Math.max(parseInt(query.pageSize || "50", 10), 1), 200);
    const where = await reservationVisibilityWhere(companyId, user, branchId);
    if (query.search) {
      const s = `%${query.search}%`;
      where[Op.or] = [
        { id: { [Op.iLike]: s } },
        { customerName: { [Op.iLike]: s } },
        { assetName: { [Op.iLike]: s } },
      ];
    }
    const { rows, count } = await models.Reservation.findAndCountAll({
      where,
      include: [
        { model: models.ReservationItem, as: "items", required: false },
        { model: models.ReservationPayment, as: "payments", required: false },
        { model: models.ReservationRefund, as: "refunds", required: false },
      ],
      order: [["createdAt", "DESC"]],
      limit: pageSize,
      offset: (page - 1) * pageSize,
      distinct: true
    });
    return { items: rows, total: count, page, pageSize, totalPages: Math.max(Math.ceil(count / pageSize), 1) };
  }

  async getById({ companyId, id, user = null, branchId = null }) {
    const where = await reservationVisibilityWhere(companyId, user, branchId);
    where[Op.and] = [...(where[Op.and] || []), { id }];
    const reservation = await models.Reservation.findOne({
      where,
      include: [
        { model: models.ReservationItem, as: "items", required: false },
        { model: models.ReservationPayment, as: "payments", required: false },
        { model: models.ReservationPaymentApplication, as: "paymentApplications", required: false },
        { model: models.ReservationRefund, as: "refunds", required: false, include: [{ model: models.ReservationRefundAllocation, as: "allocations", required: false }] },
        { model: models.ReservationAmendment, as: "amendments", required: false, include: [{ model: models.ReservationAmendmentItem, as: "items", required: false }] },
        { model: models.ReservationExpiryExtension, as: "expiryExtensions", required: false },
        { model: models.ReservationRenewal, as: "renewalsAsSource", required: false },
      ]
    });
    if (!reservation) throw new NotFoundError("Reservation not found");
    return reservation;
  }

  async createReservation({ companyId, branchId, user, body = {}, idempotencyKey }) {
    if (!idempotencyKey) throw new ValidationError("Idempotency-Key is required for reservation creation");
    const scope = "reservation.create";
    const requestHash = idempotencyService.hashRequest(scope, body);
    const t = await models.sequelize.transaction();
    try {
      const claim = await idempotencyService.claim({ models, companyId, scope, key: idempotencyKey, requestHash, transaction: t });
      if (!claim.claimed) {
        try { await t.rollback(); } catch (_) {}
        const prior = await idempotencyService.resolveExisting({ models, companyId, scope, key: idempotencyKey, requestHash });
        if (prior.state === "replay") return { statusCode: prior.statusCode, responseBody: prior.responseBody };
        throw new ConflictError(prior.message);
      }

      const response = await this._createReservationInTransaction({ companyId, branchId, user, body, idempotencyKey, transaction: t });
      const responseBody = { success: true, data: response };
      await idempotencyService.succeed({ request: claim.request, statusCode: 201, responseBody, transaction: t });
      await t.commit();
      return { statusCode: 201, responseBody };
    } catch (error) {
      try { await t.rollback(); } catch (_) {}
      throw error;
    }
  }

  async _createReservationInTransaction({ companyId, branchId, user, body, idempotencyKey, transaction }) {
    const effectiveBranch = await requireOperationalBranch({ companyId, branchId, transaction });
    const customer = await models.Customer.findOne({
      where: { id: body.customerId, companyId },
      transaction,
      lock: true
    });
    if (!customer) throw new NotFoundError("Customer not found");
    await assertBranchCustomer({ companyId, branchId: effectiveBranch.id, customerId: customer.id, transaction, lock: true });

    const branch = effectiveBranch;

    const itemInputs = normalizeItems(body);
    const assetIds = itemInputs.map((item) => item.assetId).sort();
    const assets = await models.Asset.findAll({
      where: { companyId, id: assetIds },
      transaction,
      lock: true
    });
    if (assets.length !== assetIds.length) throw new NotFoundError("One or more reservation assets were not found");
    const assetsById = new Map(assets.map((asset) => [asset.id, asset]));

    const itemRows = [];
    let agreedTotalUnits = 0n;
    for (const input of itemInputs) {
      const asset = assetsById.get(input.assetId);
      if (asset.status !== "available") throw new ConflictError(`Asset ${asset.id} is not available for reservation`);
      assertSameBranch(asset, branch.id, "Asset");
      const agreedPriceUnits = parseMoneyUnits(input.agreedPrice !== undefined && input.agreedPrice !== null ? input.agreedPrice : asset.price, "agreed price");
      if (agreedPriceUnits <= 0n) throw new ValidationError("Reservation item agreed price must be greater than zero");
      agreedTotalUnits += agreedPriceUnits;
      itemRows.push({ asset, agreedPriceUnits });
    }

    const initialPayment = normalizeInitialPayment(body);
    // Phase 32.6-Post-C — a manually created reservation must start with an
    // initial payment greater than zero. This applies only to the public manual
    // creation path; internal renewal successors are created directly via
    // Reservation.create and are funded by advance transfer, so they never reach
    // this method and are unaffected.
    if (!initialPayment) {
      throw reservationConfigError(
        "RESERVATION_INITIAL_PAYMENT_REQUIRED",
        "يجب تسجيل دفعة أولى أكبر من صفر لإنشاء الحجز.",
        "An initial payment greater than zero is required to create the reservation."
      );
    }
    const explicitMethod = body.initialPayment?.paymentMethod || body.paymentMethod;
    if (!explicitMethod) {
      throw reservationConfigError(
        "RESERVATION_PAYMENT_METHOD_REQUIRED",
        "طريقة الدفع مطلوبة لتسجيل دفعة الحجز الأولى.",
        "A payment method is required to record the reservation initial payment."
      );
    }
    if (compareMoney(initialPayment.amountUnits, agreedTotalUnits) > 0) {
      throw new ValidationError("Initial reservation payment cannot exceed the reservation total | دفعة الحجز الأولى لا يمكن أن تتجاوز إجمالي الحجز");
    }
    const advancesAccount = initialPayment ? await getReservationAdvancesAccount(companyId, branch.id, transaction) : null;
    const paidUnits = initialPayment ? initialPayment.amountUnits : 0n;
    const remainingUnits = agreedTotalUnits - paidUnits;
    const status = reservationStatusForTotals(paidUnits, agreedTotalUnits);
    const id = body.id || `RES-${nowStamp()}`;
    const createdBy = actorName(user);
    const firstAsset = itemRows[0].asset;
    const createdAt = new Date();

    const reservation = await models.Reservation.create({
      id,
      companyId,
      assetId: firstAsset.id,
      assetName: firstAsset.name,
      customerId: customer.id,
      customerName: customer.name,
      branch: branch?.name || body.branch || firstAsset.branch || "Main Branch",
      branchId: branch.id,
      currency: body.currency || "AED",
      deposit: 0,
      agreedTotal: formatMoney(agreedTotalUnits),
      paidTotal: formatMoney(paidUnits),
      remainingTotal: formatMoney(remainingUnits),
      excessTotal: "0.0000",
      expiresAt: body.expiresAt,
      fullyPaidAt: status === "fully_paid" ? createdAt : null,
      finalInvoiceId: null,
      workflowVersion: 2,
      isLegacy: false,
      version: 1,
      createdBy,
      updatedBy: createdBy,
      status,
      notes: body.notes || null
    }, { transaction });

    let itemIndex = 0;
    for (const row of itemRows) {
      itemIndex += 1;
      await models.ReservationItem.create({
        id: `RSI-${nowStamp()}-${itemIndex}`,
        companyId,
        reservationId: reservation.id,
        assetId: row.asset.id,
        assetName: row.asset.name,
        itemType: "asset",
        agreedPrice: formatMoney(row.agreedPriceUnits),
        originalPrice: row.asset.price,
        status: "active",
        reservedAt: createdAt,
        addedBy: createdBy
      }, { transaction });
      await row.asset.update({ status: "reserved" }, { transaction });
      await models.AssetEvent.create({
        id: `EV-RES-${reservation.id}-${itemIndex}`,
        assetId: row.asset.id,
        action: "RESERVED",
        date: createdAt.toISOString(),
        user: createdBy,
        branch: reservation.branch,
        note: `Reserved by reservation ${reservation.id}`,
        sourceDocument: reservation.id,
        beforeState: "status:available",
        afterState: "status:reserved",
        severity: "info"
      }, { transaction });
      await audit(companyId, "reservation.item_reserved", {
        reservationId: reservation.id,
        branchId: reservation.branchId,
        user: createdBy,
        userId: user?.id,
        after: { assetId: row.asset.id, agreedPrice: formatMoney(row.agreedPriceUnits), status: "reserved" }
      }, transaction);
    }

    let payment = null;
    if (initialPayment) {
      payment = await this._createPaymentInTransaction({
        companyId,
        reservation,
        customer,
        user,
        amountUnits: initialPayment.amountUnits,
        paymentMethod: initialPayment.paymentMethod,
        receivedEmployeeId: initialPayment.receivedEmployeeId,
        sourceReference: initialPayment.sourceReference,
        advancesAccount,
        idempotencyKey: `${idempotencyKey}:initial-payment`,
        transaction
      });
    }

    await audit(companyId, "reservation.created", {
      reservationId: reservation.id,
      branchId: reservation.branchId,
      user: createdBy,
      userId: user?.id,
      after: { reservationId: reservation.id, agreedTotal: formatMoney(agreedTotalUnits), paidTotal: formatMoney(paidUnits), remainingTotal: formatMoney(remainingUnits), status }
    }, transaction);
    await notifyReservation(companyId, "created", reservation, {
      title: "Reservation created",
      message: `Reservation ${reservation.id} was created for ${reservation.customerName}.`,
      type: "info"
    }, transaction);
    if (status === "fully_paid") {
      await audit(companyId, "reservation.fully_paid", {
        reservationId: reservation.id,
        branchId: reservation.branchId,
        user: createdBy,
        userId: user?.id,
        after: { paidTotal: formatMoney(paidUnits), status }
      }, transaction);
      await notifyReservation(companyId, "fully_paid", reservation, {
        title: "Reservation fully paid",
        message: `Reservation ${reservation.id} is fully paid and ready for final sale.`,
        type: "success"
      }, transaction);
    }

    return { reservation, payment };
  }

  async addPayment({ companyId, branchId, user, reservationId, body = {}, idempotencyKey }) {
    if (!idempotencyKey) throw new ValidationError("Idempotency-Key is required for reservation payment");
    const scope = "reservation.payment";
    const requestHash = idempotencyService.hashRequest(scope, body, { reservationId });
    const t = await models.sequelize.transaction();
    try {
      const claim = await idempotencyService.claim({ models, companyId, scope, key: idempotencyKey, requestHash, transaction: t });
      if (!claim.claimed) {
        try { await t.rollback(); } catch (_) {}
        const prior = await idempotencyService.resolveExisting({ models, companyId, scope, key: idempotencyKey, requestHash });
        if (prior.state === "replay") return { statusCode: prior.statusCode, responseBody: prior.responseBody };
        throw new ConflictError(prior.message);
      }

      const reservation = await requireReservationInBranch({
        companyId,
        branchId,
        reservationId,
        transaction: t,
        lock: true
      });
      if (reservation.isLegacy || Number(reservation.workflowVersion || 1) < 2) {
        throw new ConflictError("Legacy reservations cannot receive new ledger payments");
      }
      if (INELIGIBLE_RESERVATION_STATUSES.has(reservation.status)) {
        throw new ConflictError("Reservation is not eligible for payment");
      }
      await assertBranchCustomer({ companyId, branchId, customerId: reservation.customerId, transaction: t, lock: true });

      const amountUnits = parseMoneyUnits(body.amount, "payment amount");
      if (amountUnits <= 0n) throw new ValidationError("Reservation payment amount must be greater than zero");
      const agreedTotalUnits = await calculateActiveItemTotal(reservation.id, companyId, t);
      const paidBeforeUnits = await calculatePostedPayments(reservation.id, companyId, t);
      const remainingBeforeUnits = agreedTotalUnits - paidBeforeUnits;
      if (remainingBeforeUnits <= 0n) throw new ConflictError("Reservation is already fully paid");
      if (amountUnits > remainingBeforeUnits) throw new ValidationError("Reservation payment cannot exceed remaining amount");

      const advancesAccount = await getReservationAdvancesAccount(companyId, branchId, t);
      const payment = await this._createPaymentInTransaction({
        companyId,
        reservation,
        customer: { id: reservation.customerId, name: reservation.customerName },
        user,
        amountUnits,
        paymentMethod: body.paymentMethod || "cash",
        receivedEmployeeId: body.receivedEmployeeId || null,
        sourceReference: body.sourceReference || null,
        advancesAccount,
        idempotencyKey,
        transaction: t
      });

      const paidAfterUnits = paidBeforeUnits + amountUnits;
      const remainingAfterUnits = agreedTotalUnits - paidAfterUnits;
      const status = reservationStatusForTotals(paidAfterUnits, agreedTotalUnits);
      await reservation.update({
        agreedTotal: formatMoney(agreedTotalUnits),
        paidTotal: formatMoney(paidAfterUnits),
        remainingTotal: formatMoney(remainingAfterUnits),
        excessTotal: "0.0000",
        status,
        fullyPaidAt: status === "fully_paid" ? new Date() : null,
        version: Number(reservation.version || 0) + 1,
        updatedBy: actorName(user)
      }, { transaction: t });
      await notifyReservation(companyId, "payment_posted", reservation, {
        title: "Reservation payment posted",
        message: `Reservation ${reservation.id} received payment ${formatMoney(amountUnits)} ${reservation.currency || "AED"}.`,
        type: "success",
        sourceId: payment.id
      }, t);
      if (status === "fully_paid") {
        await audit(companyId, "reservation.fully_paid", {
          reservationId: reservation.id,
          branchId: reservation.branchId,
          user: actorName(user),
          userId: user?.id,
          after: { paidTotal: formatMoney(paidAfterUnits), status }
        }, t);
        await notifyReservation(companyId, "fully_paid", reservation, {
          title: "Reservation fully paid",
          message: `Reservation ${reservation.id} is fully paid and ready for final sale.`,
          type: "success"
        }, t);
      }

      const responseBody = { success: true, data: { reservation, payment } };
      await idempotencyService.succeed({ request: claim.request, statusCode: 201, responseBody, transaction: t });
      await t.commit();
      return { statusCode: 201, responseBody };
    } catch (error) {
      try { await t.rollback(); } catch (_) {}
      throw error;
    }
  }

  async completeSale({ companyId, branchId, user, reservationId, body = {}, idempotencyKey }) {
    if (!idempotencyKey) throw new ValidationError("Idempotency-Key is required for reservation completion");
    const scope = "reservation.complete";
    const requestHash = idempotencyService.hashRequest(scope, body, { reservationId });
    const t = await models.sequelize.transaction();
    try {
      const claim = await idempotencyService.claim({ models, companyId, scope, key: idempotencyKey, requestHash, transaction: t });
      if (!claim.claimed) {
        try { await t.rollback(); } catch (_) {}
        const prior = await idempotencyService.resolveExisting({ models, companyId, scope, key: idempotencyKey, requestHash });
        if (prior.state === "replay") return { statusCode: prior.statusCode, responseBody: prior.responseBody };
        throw new ConflictError(prior.message);
      }

      const response = await this._completeSaleInTransaction({ companyId, branchId, user, reservationId, body, idempotencyKey, transaction: t });
      const responseBody = { success: true, data: response };
      await idempotencyService.succeed({ request: claim.request, statusCode: 201, responseBody, transaction: t });
      await t.commit();
      return { statusCode: 201, responseBody };
    } catch (error) {
      try { await t.rollback(); } catch (_) {}
      throw error;
    }
  }

  async _completeSaleInTransaction({ companyId, branchId, user, reservationId, body = {}, transaction }) {
    const actor = actorName(user);
    const reservation = await requireReservationInBranch({
      companyId,
      branchId,
      reservationId,
      transaction,
      lock: true
    });
    if (reservation.isLegacy || Number(reservation.workflowVersion || 1) < 2) {
      throw new ConflictError("Legacy reservations cannot be completed through the new workflow");
    }
    if (reservation.finalInvoiceId || reservation.status === "completed") {
      throw new ConflictError("Reservation is already completed");
    }
    if (["cancelled", "cancelled_refund_pending", "refunded", "expired"].includes(reservation.status)) {
      throw new ConflictError("Cancelled, refunded, or expired reservations cannot be completed");
    }
    const customer = await models.Customer.findOne({ where: { id: reservation.customerId, companyId }, transaction, lock: true });
    if (!customer) throw new NotFoundError("Reservation customer not found");
    const branch = reservation.branchId
      ? await models.Branch.findOne({ where: { id: reservation.branchId, companyId, isActive: true }, transaction, lock: true })
      : null;
    if (reservation.branchId && !branch) throw new ValidationError("Reservation branch is not active or not found");

    const items = await models.ReservationItem.findAll({
      where: { reservationId: reservation.id, companyId, status: "active" },
      transaction,
      lock: true
    });
    if (!items.length) throw new ValidationError("Reservation has no active items to complete");

    const payments = await models.ReservationPayment.findAll({
      where: { reservationId: reservation.id, companyId, status: "posted" },
      transaction,
      lock: true
    });
    if (!payments.length) throw new ValidationError("Reservation has no posted payments to apply");

    const agreedTotalUnits = items.reduce((sum, item) => sum + parseMoneyUnits(item.agreedPrice, "item agreed price"), 0n);
    const paidUnits = payments.reduce((sum, payment) => sum + parseMoneyUnits(payment.amount, "posted payment amount"), 0n);
    if (paidUnits !== agreedTotalUnits) {
      throw new ConflictError("Reservation must be fully paid before final sale completion");
    }

    const existingApplications = await models.ReservationPaymentApplication.count({
      where: { companyId, reservationId: reservation.id },
      transaction
    });
    if (existingApplications > 0) throw new ConflictError("Reservation payments have already been applied");

    const assetRows = [];
    let subtotal = 0;
    for (const item of items) {
      const asset = await models.Asset.findOne({ where: { id: item.assetId, companyId }, transaction, lock: true });
      if (!asset) throw new NotFoundError(`Reserved asset ${item.assetId} was not found`);
      if (asset.status !== "reserved") throw new ConflictError(`Reserved asset ${asset.id} is not in reserved status`);
      assertSameBranch(asset, reservation.branchId, "Reserved asset");
      const price = toNumber(parseMoneyUnits(item.agreedPrice, "item agreed price"));
      subtotal += price;
      assetRows.push({ item, asset, price });
    }

    const settings = await settingsService.getCompanySettings(companyId, { transaction });
    const totals = vatInclusiveTotalsFromGross(subtotal, settings.vatRate);
    const totalUnits = parseMoneyUnits(totals.total, "invoice total");
    if (totalUnits !== agreedTotalUnits) {
      throw new ConflictError("Reservation total no longer matches final invoice total; reprice/item-change workflow is required before completion");
    }

    const advancesAccount = await getReservationAdvancesAccount(companyId, reservation.branchId, transaction);
    const now = new Date();
    const nowStr = now.toISOString().slice(0, 16).replace("T", " ");
    const prefix = settings.invoicePrefix || "INV-2026";
    const invoiceNumber = await nextInvoiceNumber(companyId, prefix, transaction);
    const invoiceId = body.invoiceId || `INV-RES-${nowStamp()}-${Math.random().toString(36).slice(2, 8)}`;

    const invoice = await models.Invoice.create({
      id: invoiceId,
      companyId,
      branchId: reservation.branchId || null,
      branch: branch?.name || reservation.branch || "Main Branch",
      customerId: reservation.customerId,
      customerName: reservation.customerName,
      type: "sale",
      date: body.date || nowStr.slice(0, 10),
      subtotal: totals.taxBase,
      tax: totals.tax,
      vatRate: totals.vatRate,
      discount: Number(body.discount) || 0,
      makingCharge: Number(body.makingCharge) || 0,
      stoneValue: Number(body.stoneValue) || 0,
      total: totals.total,
      paidAmount: totals.total,
      remainingAmount: 0,
      status: "paid",
      paymentMethod: "reservation_advance",
      paymentSplits: [],
      notes: body.notes || `Final sale from reservation ${reservation.id}`,
      relatedInvoiceId: reservation.id,
      idempotencyKey: null,
      postingStatus: "posted",
      invoiceNumber,
      postedAt: nowStr
    }, { transaction });

    const invoiceItems = [];
    for (const row of assetRows) {
      const invoiceItem = await models.InvoiceItem.create({
        invoiceId,
        assetId: row.asset.id,
        name: row.asset.name,
        quantity: 1,
        price: row.price,
        cost: Number(row.asset.cost) || 0,
        weight: Number(row.asset.netWeight || row.asset.goldWeight || row.asset.grossWeight || row.asset.weight) || 0,
        karat: row.asset.karat || null,
        discount: 0,
        makingCharge: 0,
        stoneValue: 0
      }, { transaction });
      invoiceItems.push(invoiceItem.toJSON());
      await row.asset.update({ status: "sold" }, { transaction });
      await row.item.update({ status: "sold" }, { transaction });
      await models.StockMovement.create({
        id: `SM-RES-SALE-${nowStamp()}-${Math.random().toString(36).slice(2, 6)}`,
        companyId,
        productId: null,
        assetId: row.asset.id,
        productCode: row.asset.barcode || row.asset.id,
        type: "sale",
        quantityIn: 0,
        quantityOut: 1,
        weightIn: 0,
        weightOut: Number(row.asset.netWeight || row.asset.goldWeight || row.asset.grossWeight || row.asset.weight) || 0,
        unitCost: Number(row.asset.cost) || 0,
        totalCost: Number(row.asset.cost) || 0,
        referenceType: "reservation_final_sale",
        referenceId: invoiceId,
        customerId: reservation.customerId,
        branchId: reservation.branchId || null,
        createdBy: user?.id || actor
      }, { transaction });
      await models.AssetEvent.create({
        id: `ASE-RES-COMP-${nowStamp()}-${Math.random().toString(36).slice(2, 6)}`,
        assetId: row.asset.id,
        action: "SALE",
        date: nowStr.slice(0, 10),
        user: actor,
        branch: branch?.name || reservation.branch || "Main Branch",
        note: `Sold by final reservation invoice ${invoiceNumber}`,
        sourceDocument: invoiceId,
        beforeState: "status:reserved",
        afterState: "status:sold",
        severity: "info"
      }, { transaction });
    }

    const invoiceForPosting = invoice.toJSON();
    invoiceForPosting.status = "due";
    invoiceForPosting.paidAmount = 0;
    invoiceForPosting.remainingAmount = totals.total;
    const saleJournal = await postingService.postInvoiceEntry(invoiceForPosting, invoiceItems, actor, { transaction });
    const settlementJournal = await postingService.postReservationAdvanceSettlementEntry(reservation, totals.total, actor, {
      transaction,
      advancesAccountCode: advancesAccount.code,
      invoiceId,
      date: invoice.date,
      branchId: reservation.branchId
    });

    for (const payment of payments) {
      await models.ReservationPaymentApplication.create({
        id: `RPA-${nowStamp()}-${Math.random().toString(36).slice(2, 8)}`,
        companyId,
        reservationId: reservation.id,
        reservationPaymentId: payment.id,
        finalInvoiceId: invoiceId,
        appliedAmount: payment.amount,
        appliedAt: now,
        appliedBy: actor,
        sourceReference: settlementJournal.id
      }, { transaction });
    }

    await reservation.update({
      status: "completed",
      finalInvoiceId: invoiceId,
      completedAt: now,
      completedBy: actor,
      paidTotal: formatMoney(paidUnits),
      remainingTotal: "0.0000",
      excessTotal: "0.0000",
      version: Number(reservation.version || 0) + 1,
      updatedBy: actor
    }, { transaction });

    await audit(companyId, "reservation.completed", {
      reservationId: reservation.id,
      branchId: reservation.branchId,
      user: actor,
      userId: user?.id,
      before: { status: "fully_paid", finalInvoiceId: null },
      after: { status: "completed", finalInvoiceId: invoiceId, invoiceNumber, appliedPayments: payments.length, saleJournalId: saleJournal.id, settlementJournalId: settlementJournal.id }
    }, transaction);
    await notifyReservation(companyId, "completed", reservation, {
      title: "Reservation completed",
      message: `Reservation ${reservation.id} was completed as invoice ${invoiceNumber}.`,
      type: "success",
      sourceId: invoiceId
    }, transaction);

    return { reservation, invoice, saleJournal, settlementJournal, appliedPayments: payments.length };
  }

  async cancelReservation({ companyId, branchId, user, reservationId, body = {} }) {
    const t = await models.sequelize.transaction();
    try {
      const actor = actorName(user);
      const reservation = await requireReservationInBranch({ companyId, branchId, reservationId, transaction: t, lock: true });
      if (reservation.isLegacy || Number(reservation.workflowVersion || 1) < 2) {
        throw new ConflictError("Legacy reservations cannot be cancelled through the new workflow");
      }
      if (reservation.finalInvoiceId || reservation.status === "completed") throw new ConflictError("Completed reservations cannot be cancelled");
      if (reservation.status === "refunded") throw new ConflictError("Refunded reservations cannot be cancelled again");
      const reason = String(body.reason || body.cancellationReason || "").trim();
      if (!reason) throw new ValidationError("Cancellation reason is required");

      const paidUnits = await calculatePostedPayments(reservation.id, companyId, t);
      const nextStatus = paidUnits > 0n ? "cancelled_refund_pending" : "cancelled";
      const now = new Date();
      const releasedCount = await this._releaseActiveReservationItems(reservation, {
        companyId, actor, now, reason, transaction: t,
        eventAction: "RESERVATION_CANCELLED", note: `Reservation ${reservation.id} cancelled: ${reason}`
      });
      const items = { length: releasedCount };
      await reservation.update({
        status: nextStatus,
        cancelledAt: now,
        cancelledBy: actor,
        cancellationReason: reason,
        refundStatus: paidUnits > 0n ? "pending" : null,
        version: Number(reservation.version || 0) + 1,
        updatedBy: actor
      }, { transaction: t });
      await audit(companyId, "reservation.cancelled", {
        reservationId: reservation.id,
        branchId: reservation.branchId,
        user: actor,
        userId: user?.id,
        before: { status: reservation.status },
        after: { status: nextStatus, reason, paidTotal: formatMoney(paidUnits), releasedItems: releasedCount }
      }, t);
      await notifyReservation(companyId, "cancelled", reservation, {
        title: "Reservation cancelled",
        message: `Reservation ${reservation.id} was cancelled. Refund pending: ${paidUnits > 0n ? "yes" : "no"}.`,
        type: paidUnits > 0n ? "warning" : "info"
      }, t);
      await t.commit();
      return { statusCode: 200, responseBody: { success: true, data: { reservation } } };
    } catch (error) {
      try { await t.rollback(); } catch (_) {}
      throw error;
    }
  }

  async requestRefund({ companyId, branchId, user, reservationId, body = {} }) {
    const t = await models.sequelize.transaction();
    try {
      const actor = actorName(user);
      const reservation = await requireReservationInBranch({ companyId, branchId, reservationId, transaction: t, lock: true });
      if (reservation.isLegacy || Number(reservation.workflowVersion || 1) < 2) throw new ConflictError("Legacy reservations cannot be refunded through the new workflow");
      if (reservation.status !== "cancelled_refund_pending") throw new ConflictError("Reservation must be cancelled with refund pending before refund request");
      if (reservation.finalInvoiceId) throw new ConflictError("Completed reservations cannot be refunded through reservation refund");
      const activeRenewal = await models.ReservationRenewal.findOne({ where: { companyId, sourceReservationId: reservation.id, status: ["requested", "pending_excess_refund", "ready_to_activate", "activated"] }, transaction: t, lock: true });
      if (activeRenewal) throw new ConflictError("A renewal is in progress for this reservation; full refund is not available");
      const existing = await models.ReservationRefund.findOne({ where: { companyId, reservationId: reservation.id, refundType: "reservation_full", status: ["requested", "approved", "executed"] }, transaction: t, lock: true });
      if (existing) throw new ConflictError("Reservation refund already exists");

      const payments = await models.ReservationPayment.findAll({ where: { reservationId: reservation.id, companyId, status: "posted" }, transaction: t, lock: true });
      if (!payments.length) throw new ValidationError("Reservation has no posted payments to refund");
      const amountUnits = payments.reduce((sum, payment) => sum + parseMoneyUnits(payment.amount, "posted payment amount"), 0n);
      if (amountUnits <= 0n) throw new ValidationError("Refund amount must be greater than zero");
      const requestedAmount = body.amount !== undefined && body.amount !== null ? parseMoneyUnits(body.amount, "refund amount") : amountUnits;
      if (requestedAmount !== amountUnits) throw new ValidationError("Reservation refunds must be full; partial refunds are not allowed");
      const method = body.refundMethod || body.requestedRefundMethod || payments[0].paymentMethod || "cash";
      const treasuryCode = treasuryAccountCode(method);
      const methods = [...new Set(payments.map((p) => String(p.paymentMethod || "cash").toLowerCase()))];
      const differs = !methods.includes(String(method || "cash").toLowerCase());
      const reason = String(body.reason || "").trim();
      if (!reason) throw new ValidationError("Refund request reason is required");
      const now = new Date();
      const refund = await models.ReservationRefund.create({
        id: `RRF-${nowStamp()}-${Math.random().toString(36).slice(2, 8)}`,
        companyId,
        reservationId: reservation.id,
        customerId: reservation.customerId,
        branchId: reservation.branchId || null,
        amount: formatMoney(amountUnits),
        currency: reservation.currency || "AED",
        status: "requested",
        requestedRefundMethod: method,
        treasuryAccountCode: treasuryCode,
        originalPaymentMethodsSummary: methods.map((paymentMethod) => ({
          paymentMethod,
          amount: formatMoney(payments.filter((p) => String(p.paymentMethod || "cash").toLowerCase() === paymentMethod).reduce((sum, p) => sum + parseMoneyUnits(p.amount, "posted payment amount"), 0n))
        })),
        methodDiffersFromOriginal: differs,
        methodOverrideApproved: false,
        reason,
        requestedBy: actor,
        requestedAt: now,
        version: 1
      }, { transaction: t });
      await reservation.update({ refundStatus: "requested", version: Number(reservation.version || 0) + 1, updatedBy: actor }, { transaction: t });
      await audit(companyId, "reservation.refund_requested", {
        reservationId: reservation.id,
        branchId: reservation.branchId,
        user: actor,
        userId: user?.id,
        after: { refundId: refund.id, amount: refund.amount, method, methodDiffersFromOriginal: differs, reason }
      }, t);
      await notifyReservation(companyId, "refund_requested", reservation, {
        title: "Reservation refund requested",
        message: `Refund ${refund.id} was requested for reservation ${reservation.id}.`,
        type: "approval",
        sourceId: refund.id
      }, t);
      await t.commit();
      return { statusCode: 201, responseBody: { success: true, data: { reservation, refund } } };
    } catch (error) {
      try { await t.rollback(); } catch (_) {}
      throw error;
    }
  }

  async approveRefund({ companyId, branchId, user, refundId, body = {} }) {
    const t = await models.sequelize.transaction();
    try {
      const actor = actorName(user);
      const refund = await models.ReservationRefund.findOne({ where: { id: refundId, companyId }, transaction: t, lock: true });
      if (!refund) throw new NotFoundError("Reservation refund not found");
      if (refund.refundType && refund.refundType !== "reservation_full") throw new ConflictError("Renewal excess refunds use the dedicated renewal excess refund workflow");
      if (refund.status !== "requested") throw new ConflictError("Only requested refunds can be approved");
      const reservation = await requireReservationInBranch({ companyId, branchId, reservationId: refund.reservationId, transaction: t, lock: true });
      if (reservation.status !== "cancelled_refund_pending") throw new ConflictError("Reservation is not awaiting refund");
      const now = new Date();
      await refund.update({
        status: "approved",
        approvedBy: actor,
        approvedAt: now,
        methodOverrideApproved: Boolean(body.methodOverrideApproved || !refund.methodDiffersFromOriginal),
        version: Number(refund.version || 0) + 1
      }, { transaction: t });
      await reservation.update({ refundStatus: "approved", updatedBy: actor, version: Number(reservation.version || 0) + 1 }, { transaction: t });
      await audit(companyId, "reservation.refund_approved", {
        reservationId: reservation.id,
        branchId: reservation.branchId,
        user: actor,
        userId: user?.id,
        after: { refundId: refund.id, amount: refund.amount, methodOverrideApproved: refund.methodOverrideApproved }
      }, t);
      await notifyReservation(companyId, "refund_approved", reservation, {
        title: "Reservation refund approved",
        message: `Refund ${refund.id} was approved for reservation ${reservation.id}.`,
        type: "success",
        sourceId: refund.id
      }, t);
      await t.commit();
      return { statusCode: 200, responseBody: { success: true, data: { reservation, refund } } };
    } catch (error) {
      try { await t.rollback(); } catch (_) {}
      throw error;
    }
  }

  async rejectRefund({ companyId, branchId, user, refundId, body = {} }) {
    const t = await models.sequelize.transaction();
    try {
      const actor = actorName(user);
      const refund = await models.ReservationRefund.findOne({ where: { id: refundId, companyId }, transaction: t, lock: true });
      if (!refund) throw new NotFoundError("Reservation refund not found");
      if (refund.refundType && refund.refundType !== "reservation_full") throw new ConflictError("Renewal excess refunds use the dedicated renewal excess refund workflow");
      if (refund.status !== "requested") throw new ConflictError("Only requested refunds can be rejected");
      const reason = String(body.reason || body.rejectionReason || "").trim();
      if (!reason) throw new ValidationError("Rejection reason is required");
      const reservation = await requireReservationInBranch({ companyId, branchId, reservationId: refund.reservationId, transaction: t, lock: true });
      const now = new Date();
      await refund.update({ status: "rejected", rejectedBy: actor, rejectedAt: now, rejectionReason: reason, version: Number(refund.version || 0) + 1 }, { transaction: t });
      if (reservation) await reservation.update({ refundStatus: "rejected", updatedBy: actor, version: Number(reservation.version || 0) + 1 }, { transaction: t });
      await audit(companyId, "reservation.refund_rejected", {
        reservationId: refund.reservationId,
        branchId: refund.branchId,
        user: actor,
        userId: user?.id,
        after: { refundId: refund.id, reason }
      }, t);
      if (reservation) {
        await notifyReservation(companyId, "refund_rejected", reservation, {
          title: "Reservation refund rejected",
          message: `Refund ${refund.id} was rejected for reservation ${refund.reservationId}.`,
          type: "warning",
          sourceId: refund.id
        }, t);
      }
      await t.commit();
      return { statusCode: 200, responseBody: { success: true, data: { reservation, refund } } };
    } catch (error) {
      try { await t.rollback(); } catch (_) {}
      throw error;
    }
  }

  async executeRefund({ companyId, branchId, user, refundId, body = {}, idempotencyKey }) {
    if (!idempotencyKey) throw new ValidationError("Idempotency-Key is required for reservation refund execution");
    const scope = "reservation.refund.execute";
    const requestHash = idempotencyService.hashRequest(scope, body, { refundId });
    const t = await models.sequelize.transaction();
    try {
      const claim = await idempotencyService.claim({ models, companyId, scope, key: idempotencyKey, requestHash, transaction: t });
      if (!claim.claimed) {
        try { await t.rollback(); } catch (_) {}
        const prior = await idempotencyService.resolveExisting({ models, companyId, scope, key: idempotencyKey, requestHash });
        if (prior.state === "replay") return { statusCode: prior.statusCode, responseBody: prior.responseBody };
        throw new ConflictError(prior.message);
      }
      const response = await this._executeRefundInTransaction({ companyId, branchId, user, refundId, body, idempotencyKey, transaction: t });
      const responseBody = { success: true, data: response };
      await idempotencyService.succeed({ request: claim.request, statusCode: 200, responseBody, transaction: t });
      await t.commit();
      return { statusCode: 200, responseBody };
    } catch (error) {
      try { await t.rollback(); } catch (_) {}
      throw error;
    }
  }

  async _executeRefundInTransaction({ companyId, branchId, user, refundId, body = {}, idempotencyKey, transaction }) {
    const actor = actorName(user);
    const refund = await models.ReservationRefund.findOne({ where: { id: refundId, companyId }, transaction, lock: true });
    if (!refund) throw new NotFoundError("Reservation refund not found");
    if (refund.refundType && refund.refundType !== "reservation_full") throw new ConflictError("Renewal excess refunds use the dedicated renewal excess refund workflow");
    if (refund.status === "executed") throw new ConflictError("Reservation refund has already been executed");
    if (refund.status !== "approved") throw new ConflictError("Reservation refund must be approved before execution");
    if (refund.methodDiffersFromOriginal && !refund.methodOverrideApproved) {
      throw new ConflictError("Different refund method requires approval before execution");
    }
    const reservation = await requireReservationInBranch({
      companyId,
      branchId,
      reservationId: refund.reservationId,
      transaction,
      lock: true
    });
    if (reservation.status !== "cancelled_refund_pending") throw new ConflictError("Reservation is not awaiting refund execution");
    if (reservation.finalInvoiceId) throw new ConflictError("Completed reservations cannot be refunded");
    const payments = await models.ReservationPayment.findAll({ where: { reservationId: reservation.id, companyId, status: "posted" }, transaction, lock: true });
    const refundUnits = parseMoneyUnits(refund.amount, "refund amount");
    const paidUnits = payments.reduce((sum, payment) => sum + parseMoneyUnits(payment.amount, "posted payment amount"), 0n);
    if (refundUnits !== paidUnits) throw new ValidationError("Reservation refund must equal all posted reservation payments");
    const advancesAccount = await getReservationAdvancesAccount(companyId, reservation.branchId, transaction);
    const treasuryCode = body.treasuryAccountCode || refund.treasuryAccountCode || treasuryAccountCode(refund.requestedRefundMethod);
    const now = new Date();
    await refund.update({
      treasuryAccountCode: treasuryCode,
      executedBy: actor,
      executedAt: now,
      idempotencyKey,
      version: Number(refund.version || 0) + 1
    }, { transaction });
    const journal = await postingService.postReservationRefundEntry(refund, actor, {
      transaction,
      advancesAccountCode: advancesAccount.code,
      treasuryAccountCode: treasuryCode,
      branchId: reservation.branchId
    });
    const account = accountNameFromCode(treasuryCode);
    const cashTx = await models.CashTransaction.create({
      id: `TX-RES-REF-${nowStamp()}-${Math.random().toString(36).slice(2, 6)}`,
      companyId,
      branchId: reservation.branchId || null,
      branch: reservation.branch || "Main Branch",
      type: "cash_out",
      account,
      amount: formatMoney(refundUnits),
      category: "استرداد دفعات حجز",
      counterAccountCode: advancesAccount.code,
      description: `استرداد حجز ${reservation.id}`,
      reference: refund.id,
      date: now.toISOString().slice(0, 10),
      status: "posted",
      createdBy: user?.id || actor,
      journalEntryId: journal.id,
      idempotencyKey
    }, { transaction });
    for (const payment of payments) {
      await models.ReservationRefundAllocation.create({
        id: `RRA-${nowStamp()}-${Math.random().toString(36).slice(2, 8)}`,
        companyId,
        reservationRefundId: refund.id,
        reservationPaymentId: payment.id,
        allocatedAmount: payment.amount
      }, { transaction });
      await payment.update({ status: "refunded", refundOf: refund.id }, { transaction });
    }
    await refund.update({ status: "executed", journalEntryId: journal.id, cashTransactionId: cashTx.id }, { transaction });
    await reservation.update({
      status: "refunded",
      refundedAt: now,
      refundStatus: "executed",
      paidTotal: "0.0000",
      remainingTotal: "0.0000",
      excessTotal: "0.0000",
      version: Number(reservation.version || 0) + 1,
      updatedBy: actor
    }, { transaction });
    await audit(companyId, "reservation.refund_executed", {
      reservationId: reservation.id,
      branchId: reservation.branchId,
      user: actor,
      userId: user?.id,
      after: { refundId: refund.id, amount: refund.amount, journalEntryId: journal.id, cashTransactionId: cashTx.id, allocations: payments.length }
    }, transaction);
    await notifyReservation(companyId, "refund_executed", reservation, {
      title: "Reservation refund executed",
      message: `Refund ${refund.id} was executed for reservation ${reservation.id}.`,
      type: "success",
      sourceId: refund.id
    }, transaction);
    return { reservation, refund, journal, cashTransaction: cashTx, allocations: payments.length };
  }

  // ─── Phase 32.6-Fix C — Item Amendments ───────────────────────────────────
  async amendItems({ companyId, branchId, user, reservationId, body = {}, idempotencyKey }) {
    if (!idempotencyKey) throw new ValidationError("Idempotency-Key is required for reservation amendment");
    const scope = "reservation.amend";
    const requestHash = idempotencyService.hashRequest(scope, body, { reservationId });
    const t = await models.sequelize.transaction();
    try {
      const claim = await idempotencyService.claim({ models, companyId, scope, key: idempotencyKey, requestHash, transaction: t });
      if (!claim.claimed) {
        try { await t.rollback(); } catch (_) {}
        const prior = await idempotencyService.resolveExisting({ models, companyId, scope, key: idempotencyKey, requestHash });
        if (prior.state === "replay") return { statusCode: prior.statusCode, responseBody: prior.responseBody };
        throw new ConflictError(prior.message);
      }
      const response = await this._amendItemsInTransaction({ companyId, branchId, user, reservationId, body, idempotencyKey, transaction: t });
      const responseBody = { success: true, data: response };
      await idempotencyService.succeed({ request: claim.request, statusCode: 200, responseBody, transaction: t });
      await t.commit();
      return { statusCode: 200, responseBody };
    } catch (error) {
      try { await t.rollback(); } catch (_) {}
      throw error;
    }
  }

  async _amendItemsInTransaction({ companyId, branchId, user, reservationId, body = {}, idempotencyKey, transaction }) {
    const actor = actorName(user);
    const reason = String(body.reason || "").trim();
    if (!reason) throw new ValidationError("Amendment reason is required");

    const reservation = await requireReservationInBranch({
      companyId,
      branchId,
      reservationId,
      transaction,
      lock: true
    });
    if (reservation.isLegacy || Number(reservation.workflowVersion || 1) < 2) {
      throw new ConflictError("Legacy reservations cannot be amended through the new workflow");
    }
    if (!["active", "partially_paid", "fully_paid"].includes(reservation.status)) {
      throw new ConflictError("Only active reservations before completion can be amended");
    }
    if (reservation.finalInvoiceId) throw new ConflictError("Completed reservations cannot be amended");
    const addAssetIds = Array.isArray(body.addAssetIds) ? body.addAssetIds.map((v) => String(v).trim()).filter(Boolean) : [];
    const removeItemIds = Array.isArray(body.removeItemIds) ? body.removeItemIds.map((v) => String(v).trim()).filter(Boolean) : [];
    const repriceItemIds = Array.isArray(body.repriceItemIds) ? body.repriceItemIds.map((v) => String(v).trim()).filter(Boolean) : [];
    const replacements = Array.isArray(body.replacements)
      ? body.replacements.map((r) => ({ removeItemId: String(r.removeItemId || "").trim(), addAssetId: String(r.addAssetId || "").trim() }))
      : [];
    for (const r of replacements) {
      if (!r.removeItemId || !r.addAssetId) throw new ValidationError("Each replacement requires removeItemId and addAssetId");
    }
    if (!addAssetIds.length && !removeItemIds.length && !repriceItemIds.length && !replacements.length) {
      throw new ValidationError("Amendment requires at least one add, remove, replace, or reprice operation");
    }

    // Lock active items.
    const activeItems = await models.ReservationItem.findAll({
      where: { reservationId: reservation.id, companyId, status: "active" },
      transaction,
      lock: true,
      order: [["id", "ASC"]]
    });
    const itemsById = new Map(activeItems.map((i) => [i.id, i]));

    const removalIds = new Set([...removeItemIds, ...replacements.map((r) => r.removeItemId)]);
    for (const id of removalIds) {
      if (!itemsById.has(id)) throw new ConflictError(`Reservation item ${id} is not an active item of this reservation`);
    }
    for (const id of repriceItemIds) {
      if (!itemsById.has(id)) throw new ConflictError(`Reprice target ${id} is not an active item of this reservation`);
      if (removalIds.has(id)) throw new ConflictError(`Item ${id} cannot be both removed and repriced`);
    }

    // Collect and lock all incoming assets (added + replacement-in) deterministically.
    const incomingAssetIds = [...addAssetIds, ...replacements.map((r) => r.addAssetId)];
    const incomingSeen = new Set();
    for (const aid of incomingAssetIds) {
      if (incomingSeen.has(aid)) throw new ConflictError(`Asset ${aid} cannot be added twice in one amendment`);
      incomingSeen.add(aid);
    }
    const remainingActiveAssetIds = new Set(
      activeItems.filter((i) => !removalIds.has(i.id)).map((i) => i.assetId)
    );
    for (const aid of incomingAssetIds) {
      if (remainingActiveAssetIds.has(aid)) throw new ConflictError(`Asset ${aid} is already reserved in this reservation`);
    }

    const sortedAssetIds = [...new Set([...incomingAssetIds, ...activeItems.map((i) => i.assetId)])].sort();
    const lockedAssets = sortedAssetIds.length
      ? await models.Asset.findAll({ where: { companyId, id: sortedAssetIds }, transaction, lock: true })
      : [];
    const assetsById = new Map(lockedAssets.map((a) => [a.id, a]));

    for (const aid of incomingAssetIds) {
      const asset = assetsById.get(aid);
      if (!asset) throw new NotFoundError(`Asset ${aid} was not found`);
      if (asset.status !== "available") throw new ConflictError(`Asset ${aid} is not available for reservation`);
      if (reservation.branchId && asset.branchId && asset.branchId !== reservation.branchId) {
        throw new ConflictError(`Asset ${aid} belongs to another branch`);
      }
    }

    // Compute before/after snapshots.
    const beforeTotalUnits = activeItems.reduce((s, i) => s + parseMoneyUnits(i.agreedPrice, "item agreed price"), 0n);
    const paidUnits = await calculatePostedPayments(reservation.id, companyId, transaction);

    const now = await trustedNow(transaction);
    const amendmentId = uid("RAM");
    const amendmentDetails = [];

    // Determine the final active item set total.
    let afterTotalUnits = 0n;
    let finalActiveCount = 0;
    for (const item of activeItems) {
      if (removalIds.has(item.id)) continue;
      if (repriceItemIds.includes(item.id)) {
        const asset = assetsById.get(item.assetId);
        afterTotalUnits += currentAssetPriceUnits(asset);
      } else {
        afterTotalUnits += parseMoneyUnits(item.agreedPrice, "item agreed price");
      }
      finalActiveCount += 1;
    }
    for (const aid of incomingAssetIds) {
      afterTotalUnits += currentAssetPriceUnits(assetsById.get(aid));
      finalActiveCount += 1;
    }
    if (finalActiveCount === 0) throw new ValidationError("An amendment cannot leave a reservation with no active items");
    if (afterTotalUnits < paidUnits) {
      throw new ConflictError("Amendment would leave the reservation total below the paid amount; partial refunds are not allowed while active");
    }

    // Apply removals (removeItemIds + replacement removeIds → released, asset available).
    for (const item of activeItems) {
      if (!removalIds.has(item.id)) continue;
      const asset = assetsById.get(item.assetId);
      if (asset && asset.status === "reserved") {
        await asset.update({ status: "available" }, { transaction });
        await models.AssetEvent.create({
          id: uid("ASE-RES-AMEND-REL"),
          assetId: asset.id,
          action: "RESERVATION_ITEM_RELEASED",
          date: now.toISOString().slice(0, 10),
          user: actor,
          branch: reservation.branch,
          note: `Released from reservation ${reservation.id} by amendment ${amendmentId}: ${reason}`,
          sourceDocument: reservation.id,
          beforeState: "status:reserved",
          afterState: "status:available",
          severity: "info"
        }, { transaction });
      }
      const isReplacedOut = replacements.some((r) => r.removeItemId === item.id);
      await item.update({ status: "released", releasedAt: now, releaseReason: reason }, { transaction });
      amendmentDetails.push({
        action: isReplacedOut ? "replaced_out" : "removed",
        reservationItemId: item.id,
        assetId: item.assetId,
        oldPrice: item.agreedPrice,
        previousActiveState: "active",
        newActiveState: "released"
      });
      await audit(companyId, "reservation.item_removed", {
        reservationId: reservation.id, branchId: reservation.branchId, user: actor, userId: user?.id,
        before: { itemId: item.id, assetId: item.assetId, status: "active" },
        after: { status: "released", replacedOut: isReplacedOut }
      }, transaction);
    }

    // Apply repricing on surviving active items.
    for (const item of activeItems) {
      if (!repriceItemIds.includes(item.id) || removalIds.has(item.id)) continue;
      const asset = assetsById.get(item.assetId);
      const oldPrice = item.agreedPrice;
      const newUnits = currentAssetPriceUnits(asset);
      await item.update({ agreedPrice: formatMoney(newUnits) }, { transaction });
      amendmentDetails.push({
        action: "repriced",
        reservationItemId: item.id,
        assetId: item.assetId,
        oldPrice,
        newPrice: formatMoney(newUnits),
        previousActiveState: "active",
        newActiveState: "active"
      });
      await audit(companyId, "reservation.item_repriced", {
        reservationId: reservation.id, branchId: reservation.branchId, user: actor, userId: user?.id,
        before: { itemId: item.id, agreedPrice: oldPrice },
        after: { agreedPrice: formatMoney(newUnits) }
      }, transaction);
    }

    // Apply additions and replacement-ins (new active items, assets reserved).
    const replacementInByAsset = new Map(replacements.map((r) => [r.addAssetId, r.removeItemId]));
    let addIndex = 0;
    for (const aid of incomingAssetIds) {
      addIndex += 1;
      const asset = assetsById.get(aid);
      const priceUnits = currentAssetPriceUnits(asset);
      const newItem = await models.ReservationItem.create({
        id: `RSI-${nowStamp()}-A${addIndex}-${Math.random().toString(36).slice(2, 5)}`,
        companyId,
        reservationId: reservation.id,
        assetId: asset.id,
        assetName: asset.name,
        itemType: "asset",
        agreedPrice: formatMoney(priceUnits),
        originalPrice: asset.price,
        status: "active",
        reservedAt: now,
        addedBy: actor
      }, { transaction });
      await asset.update({ status: "reserved" }, { transaction });
      await models.AssetEvent.create({
        id: uid("ASE-RES-AMEND-ADD"),
        assetId: asset.id,
        action: "RESERVED",
        date: now.toISOString().slice(0, 10),
        user: actor,
        branch: reservation.branch,
        note: `Added to reservation ${reservation.id} by amendment ${amendmentId}`,
        sourceDocument: reservation.id,
        beforeState: "status:available",
        afterState: "status:reserved",
        severity: "info"
      }, { transaction });
      const isReplacementIn = replacementInByAsset.has(aid);
      amendmentDetails.push({
        action: isReplacementIn ? "replaced_in" : "added",
        reservationItemId: newItem.id,
        assetId: asset.id,
        previousAssetId: isReplacementIn ? (itemsById.get(replacementInByAsset.get(aid))?.assetId || null) : null,
        newPrice: formatMoney(priceUnits),
        previousActiveState: "available",
        newActiveState: "active"
      });
      await audit(companyId, "reservation.item_added", {
        reservationId: reservation.id, branchId: reservation.branchId, user: actor, userId: user?.id,
        after: { itemId: newItem.id, assetId: asset.id, agreedPrice: formatMoney(priceUnits), replacedIn: isReplacementIn }
      }, transaction);
    }

    // Recalculate remaining + status server-side.
    const remainingAfterUnits = afterTotalUnits - paidUnits;
    const nextStatus = reservationStatusForTotals(paidUnits, afterTotalUnits);
    const beforeStatus = reservation.status;

    // Classify amendment type.
    const hasAdd = addAssetIds.length > 0;
    const hasRemove = removeItemIds.length > 0;
    const hasReplace = replacements.length > 0;
    const hasReprice = repriceItemIds.length > 0;
    const opFlags = [hasAdd, hasRemove, hasReplace, hasReprice].filter(Boolean).length;
    let amendmentType = "mixed";
    if (opFlags === 1) {
      amendmentType = hasAdd ? "add_items" : hasRemove ? "remove_items" : hasReplace ? "replace_items" : "reprice_items";
    }

    const amendment = await models.ReservationAmendment.create({
      id: amendmentId,
      companyId,
      reservationId: reservation.id,
      amendmentType,
      reason,
      beforeTotal: formatMoney(beforeTotalUnits),
      afterTotal: formatMoney(afterTotalUnits),
      beforePaid: formatMoney(paidUnits),
      afterPaid: formatMoney(paidUnits),
      beforeRemaining: formatMoney(beforeTotalUnits - paidUnits),
      afterRemaining: formatMoney(remainingAfterUnits),
      beforeStatus,
      afterStatus: nextStatus,
      idempotencyKey,
      createdBy: actor,
      employeeId: user?.employeeId || null
    }, { transaction });

    for (const detail of amendmentDetails) {
      await models.ReservationAmendmentItem.create({
        id: uid("RAI"),
        companyId,
        amendmentId: amendment.id,
        reservationId: reservation.id,
        action: detail.action,
        reservationItemId: detail.reservationItemId || null,
        assetId: detail.assetId || null,
        previousAssetId: detail.previousAssetId || null,
        oldPrice: detail.oldPrice != null ? detail.oldPrice : null,
        newPrice: detail.newPrice != null ? detail.newPrice : null,
        previousActiveState: detail.previousActiveState || null,
        newActiveState: detail.newActiveState || null
      }, { transaction });
    }

    await reservation.update({
      agreedTotal: formatMoney(afterTotalUnits),
      paidTotal: formatMoney(paidUnits),
      remainingTotal: formatMoney(remainingAfterUnits),
      excessTotal: "0.0000",
      status: nextStatus,
      fullyPaidAt: nextStatus === "fully_paid" ? (reservation.fullyPaidAt || now) : null,
      version: Number(reservation.version || 0) + 1,
      updatedBy: actor
    }, { transaction });

    await audit(companyId, "reservation.amendment_created", {
      reservationId: reservation.id, branchId: reservation.branchId, user: actor, userId: user?.id,
      before: { total: formatMoney(beforeTotalUnits), status: beforeStatus },
      after: { amendmentId: amendment.id, type: amendmentType, total: formatMoney(afterTotalUnits), status: nextStatus, added: addAssetIds.length, removed: removeItemIds.length, replaced: replacements.length, repriced: repriceItemIds.length }
    }, transaction);
    await audit(companyId, "reservation.total_changed", {
      reservationId: reservation.id, branchId: reservation.branchId, user: actor, userId: user?.id,
      before: { total: formatMoney(beforeTotalUnits) }, after: { total: formatMoney(afterTotalUnits) }
    }, transaction);
    await audit(companyId, "reservation.status_recalculated", {
      reservationId: reservation.id, branchId: reservation.branchId, user: actor, userId: user?.id,
      before: { status: beforeStatus }, after: { status: nextStatus }
    }, transaction);
    await notifyReservation(companyId, "amended", reservation, {
      title: "Reservation amended",
      message: `Reservation ${reservation.id} was amended (${amendmentType}).`,
      type: "info",
      sourceId: amendment.id
    }, transaction);

    const items = await models.ReservationItem.findAll({ where: { reservationId: reservation.id, companyId }, transaction, order: [["reservedAt", "ASC"]] });
    return { reservation, amendment, items };
  }

  // Shared atomic release used by manual cancellation and automatic expiry so
  // both paths release reserved assets and mark items released identically.
  async _releaseActiveReservationItems(reservation, { companyId, actor, now, reason, transaction, eventAction, note }) {
    const items = await models.ReservationItem.findAll({
      where: { reservationId: reservation.id, companyId, status: "active" },
      transaction,
      lock: true,
      order: [["id", "ASC"]]
    });
    for (const item of items) {
      const asset = await models.Asset.findOne({ where: { id: item.assetId, companyId }, transaction, lock: true });
      if (asset && asset.status === "reserved") {
        await asset.update({ status: "available" }, { transaction });
        await models.AssetEvent.create({
          id: uid("ASE-RES-REL"),
          assetId: asset.id,
          action: eventAction,
          date: now.toISOString().slice(0, 10),
          user: actor,
          branch: reservation.branch,
          note,
          sourceDocument: reservation.id,
          beforeState: "status:reserved",
          afterState: "status:available",
          severity: "info"
        }, { transaction });
        await audit(companyId, "reservation.item_released", {
          reservationId: reservation.id, branchId: reservation.branchId, user: actor,
          after: { assetId: asset.id, itemId: item.id }
        }, transaction);
      }
      await item.update({ status: "released", releasedAt: now, releaseReason: reason }, { transaction });
    }
    return items.length;
  }

  // ─── Phase 32.6-Fix C — Expiry Extension ──────────────────────────────────
  async extendExpiry({ companyId, branchId, user, reservationId, body = {}, idempotencyKey }) {
    if (!idempotencyKey) throw new ValidationError("Idempotency-Key is required for expiry extension");
    const scope = "reservation.extend_expiry";
    const requestHash = idempotencyService.hashRequest(scope, body, { reservationId });
    const t = await models.sequelize.transaction();
    try {
      const claim = await idempotencyService.claim({ models, companyId, scope, key: idempotencyKey, requestHash, transaction: t });
      if (!claim.claimed) {
        try { await t.rollback(); } catch (_) {}
        const prior = await idempotencyService.resolveExisting({ models, companyId, scope, key: idempotencyKey, requestHash });
        if (prior.state === "replay") return { statusCode: prior.statusCode, responseBody: prior.responseBody };
        throw new ConflictError(prior.message);
      }

      const actor = actorName(user);
      const reservation = await requireReservationInBranch({
        companyId,
        branchId,
        reservationId,
        transaction: t,
        lock: true
      });
      if (reservation.isLegacy || Number(reservation.workflowVersion || 1) < 2) throw new ConflictError("Legacy reservations cannot be extended through the new workflow");
      if (!["active", "partially_paid", "fully_paid"].includes(reservation.status)) throw new ConflictError("Only active reservations before completion can have their expiry extended");
      const reason = String(body.reason || "").trim();
      if (!reason) throw new ValidationError("Extension reason is required");

      const now = await trustedNow(t);
      const oldExpiry = parseExpiry(reservation.expiresAt);
      const newExpiry = parseExpiry(body.newExpiry || body.expiresAt);
      if (!newExpiry) throw new ValidationError("A valid new expiry date/time is required");
      if (oldExpiry && oldExpiry.getTime() <= now.getTime()) throw new ConflictError("Reservation has already expired and cannot be extended");
      if (newExpiry.getTime() <= now.getTime()) throw new ValidationError("New expiry must be in the future");
      if (oldExpiry && newExpiry.getTime() <= oldExpiry.getTime()) throw new ValidationError("New expiry must be later than the current expiry");

      const newExpiryStr = typeof (body.newExpiry || body.expiresAt) === "string" ? String(body.newExpiry || body.expiresAt) : newExpiry.toISOString();
      await models.ReservationExpiryExtension.create({
        id: uid("REX"),
        companyId,
        reservationId: reservation.id,
        oldExpiry: String(reservation.expiresAt),
        newExpiry: newExpiryStr,
        reason,
        extendedBy: actor,
        extendedAt: now,
        idempotencyKey
      }, { transaction: t });
      await reservation.update({
        expiresAt: newExpiryStr,
        lastExtendedAt: now,
        lastExtendedBy: actor,
        extensionCount: Number(reservation.extensionCount || 0) + 1,
        version: Number(reservation.version || 0) + 1,
        updatedBy: actor
      }, { transaction: t });
      await audit(companyId, "reservation.expiry_extended", {
        reservationId: reservation.id, branchId: reservation.branchId, user: actor, userId: user?.id,
        before: { expiresAt: String(reservation.expiresAt) }, after: { expiresAt: newExpiryStr, reason }
      }, t);
      await notifyReservation(companyId, "expiry_extended", reservation, {
        title: "Reservation expiry extended",
        message: `Reservation ${reservation.id} expiry was extended to ${newExpiryStr}.`,
        type: "info",
        sourceId: idempotencyKey
      }, t);

      const responseBody = { success: true, data: { reservation } };
      await idempotencyService.succeed({ request: claim.request, statusCode: 200, responseBody, transaction: t });
      await t.commit();
      return { statusCode: 200, responseBody };
    } catch (error) {
      try { await t.rollback(); } catch (_) {}
      throw error;
    }
  }

  // ─── Phase 32.6-Fix C — Automatic Expiry ──────────────────────────────────
  // Scheduler entry point: process reservations whose exact expiry time has
  // passed. Each reservation is processed in its own transaction under a
  // FOR UPDATE SKIP LOCKED row lock so concurrent workers never double-process.
  async processDueExpirations({ companyId = null, limit = 100, idPrefix = null } = {}) {
    const summary = { processed: 0, skipped: 0, failed: 0, reservationIds: [] };
    const nowRef = await trustedNow(null);
    // idPrefix is an optional operational scoping filter (e.g. by id namespace);
    // the production scheduler passes none and processes every due reservation.
    const rows = await models.sequelize.query(
      `SELECT id FROM reservations
       WHERE status IN ('active','partially_paid','fully_paid')
         AND is_legacy = false
         AND expires_at IS NOT NULL
         AND expires_at::timestamptz <= :now
         ${companyId ? "AND company_id = :companyId" : ""}
         ${idPrefix ? "AND id LIKE :idPrefix" : ""}
       ORDER BY expires_at ASC
       LIMIT :limit
       FOR UPDATE SKIP LOCKED`,
      { type: QueryTypes.SELECT, replacements: { now: nowRef.toISOString(), companyId, limit, idPrefix } }
    );
    for (const row of rows) {
      try {
        const result = await this._expireOneReservation(row.id);
        if (result === "processed") { summary.processed += 1; summary.reservationIds.push(row.id); }
        else summary.skipped += 1;
      } catch (error) {
        summary.failed += 1;
        try { require("../utils/logger").error(`[ReservationExpiry] Failed to expire ${row.id}: ${error.message}`); } catch (_) {}
      }
    }
    return summary;
  }

  // ─── Phase 32.6-Fix D Closure — Approaching-Expiry Notifications ──────────
  // Finds active reservations whose expiry falls within [now, now + warningHours]
  // and emits a deduplicated "approaching_expiry" notification targeted to authorized users.
  async processApproachingExpiryNotifications({ companyId = null, limit = 200, idPrefix = null } = {}) {
    const summary = { notified: 0, skipped: 0, failed: 0, reservationIds: [] };
    const nowRef = await trustedNow(null);
    // Fetch active reservations expiring within the maximum window (e.g. 365 days)
    const maxHorizon = new Date(nowRef.getTime() + 365 * 24 * 60 * 60 * 1000);
    const rows = await models.sequelize.query(
      `SELECT id, company_id, customer_name, expires_at, created_by FROM reservations
       WHERE status IN ('active','partially_paid','fully_paid')
         AND is_legacy = false
         AND expires_at IS NOT NULL
         AND expires_at::timestamptz > :now
         AND expires_at::timestamptz <= :maxHorizon
         ${companyId ? "AND company_id = :companyId" : ""}
         ${idPrefix ? "AND id LIKE :idPrefix" : ""}
       ORDER BY expires_at ASC
       LIMIT :limit`,
      { type: QueryTypes.SELECT, replacements: { now: nowRef.toISOString(), maxHorizon: maxHorizon.toISOString(), companyId, limit, idPrefix } }
    );

    const settingsService = require("./settings.service");
    for (const row of rows) {
      try {
        const companySettings = await settingsService.getCompanySettings(row.company_id);
        const warningHours = Number(companySettings.reservationExpiryWarningHours) || 72;
        const warningMs = warningHours * 60 * 60 * 1000;

        const expiryTime = new Date(row.expires_at).getTime();
        const nowTime = nowRef.getTime();

        // Check if the reservation expiry falls within the warning window
        if (expiryTime > nowTime && expiryTime <= nowTime + warningMs) {
          const daysLeft = Math.max(0, Math.ceil((expiryTime - nowTime) / (24 * 60 * 60 * 1000)));
          const expiryEpoch = expiryTime;

          // Resolve creator user
          const creatorUser = await models.User.findOne({
            where: {
              companyId: row.company_id,
              [Op.or]: [
                { id: row.created_by || "" },
                models.sequelize.where(
                  models.sequelize.fn("concat", models.sequelize.col("first_name"), " ", models.sequelize.col("last_name")),
                  row.created_by || ""
                )
              ]
            }
          });

          const recipients = [];
          if (creatorUser) {
            recipients.push({ userId: creatorUser.id, roleId: null, label: `user:${creatorUser.id}` });
          }
          recipients.push({ userId: null, roleId: `ROLE-${row.company_id}-manager`, label: "role:manager" });
          recipients.push({ userId: null, roleId: `ROLE-${row.company_id}-admin`, label: "role:admin" });

          let notifiedThisRow = false;
          for (const recipient of recipients) {
            const eventKey = `reservation.approaching_expiry:${row.company_id}:${row.id}:${expiryEpoch}:${warningHours}:${recipient.label}`;
            try {
              const existing = await models.Notification.findOne({ where: { companyId: row.company_id, eventKey } });
              if (existing) {
                summary.skipped += 1;
                continue;
              }
              await notificationService.createNotification(row.company_id, {
                title: "Reservation approaching expiry",
                message: `Reservation ${row.id} (${row.customer_name || "customer"}) expires in ${daysLeft} day(s).`,
                type: "warning",
                entityType: "Reservation",
                entityId: row.id,
                sourceType: "reservation",
                sourceId: row.id,
                userId: recipient.userId,
                roleId: recipient.roleId,
                eventKey
              });
              summary.notified += 1;
              notifiedThisRow = true;
            } catch (innerError) {
              if (innerError.name === "SequelizeUniqueConstraintError" || (innerError.parent && innerError.parent.code === "23505")) {
                summary.skipped += 1;
              } else {
                summary.failed += 1;
                try { require("../utils/logger").error(`[ApproachingExpiry] Failed to notify ${recipient.label} for reservation ${row.id}: ${innerError.message}`); } catch (_) {}
              }
            }
          }
          if (notifiedThisRow) {
            summary.reservationIds.push(row.id);
          }
        }
      } catch (error) {
        summary.failed += 1;
        try { require("../utils/logger").error(`[ApproachingExpiry] Error processing reservation ${row.id}: ${error.message}`); } catch (_) {}
      }
    }
    return summary;
  }

  async _expireOneReservation(reservationId) {
    const t = await models.sequelize.transaction();
    try {
      const reservation = await models.Reservation.findOne({ where: { id: reservationId }, transaction: t, lock: true });
      if (!reservation) { await t.rollback(); return "skipped"; }
      const companyId = reservation.companyId;
      const now = await trustedNow(t);
      // Re-check eligibility under the row lock.
      if (reservation.isLegacy || Number(reservation.workflowVersion || 1) < 2) { await t.rollback(); return "skipped"; }
      if (!["active", "partially_paid", "fully_paid"].includes(reservation.status)) { await t.rollback(); return "skipped"; }
      const expiry = parseExpiry(reservation.expiresAt);
      if (!expiry || expiry.getTime() > now.getTime()) { await t.rollback(); return "skipped"; }

      const actor = "System (Automatic Expiry)";
      const reason = `Automatic expiry at ${now.toISOString()} (expiry ${reservation.expiresAt})`;
      const paidUnits = await calculatePostedPayments(reservation.id, companyId, t);
      const nextStatus = paidUnits > 0n ? "cancelled_refund_pending" : "cancelled";
      const releasedCount = await this._releaseActiveReservationItems(reservation, {
        companyId, actor, now, reason, transaction: t,
        eventAction: "RESERVATION_EXPIRED", note: `Reservation ${reservation.id} released by automatic expiry`
      });
      await reservation.update({
        status: nextStatus,
        cancelledAt: now,
        cancelledBy: actor,
        cancellationReason: reason,
        expiredAt: now,
        expiryProcessedAt: now,
        expiredBySystem: true,
        expiryCancellationReason: reason,
        refundStatus: paidUnits > 0n ? "pending" : null,
        version: Number(reservation.version || 0) + 1,
        updatedBy: actor
      }, { transaction: t });
      await audit(companyId, "reservation.expired", {
        reservationId: reservation.id, branchId: reservation.branchId, user: actor,
        before: { status: reservation.status, expiresAt: String(reservation.expiresAt) },
        after: { status: nextStatus, releasedItems: releasedCount, paidTotal: formatMoney(paidUnits) }
      }, t);
      await audit(companyId, "reservation.expiry_cancelled", {
        reservationId: reservation.id, branchId: reservation.branchId, user: actor,
        after: { status: nextStatus, cause: "automatic_expiry" }
      }, t);
      if (paidUnits > 0n) {
        await audit(companyId, "reservation.refund_pending", {
          reservationId: reservation.id, branchId: reservation.branchId, user: actor,
          after: { status: nextStatus, paidTotal: formatMoney(paidUnits) }
        }, t);
      }
      await notifyReservation(companyId, "expired", reservation, {
        title: "Reservation expired",
        message: `Reservation ${reservation.id} expired and was moved to ${nextStatus}.`,
        type: paidUnits > 0n ? "warning" : "info"
      }, t);
      await t.commit();
      return "processed";
    } catch (error) {
      try { await t.rollback(); } catch (_) {}
      throw error;
    }
  }

  // ─── Phase 32.6-Fix C — Renewal After Expiry ──────────────────────────────
  async renewReservation({ companyId, branchId, user, reservationId, body = {}, idempotencyKey }) {
    if (!idempotencyKey) throw new ValidationError("Idempotency-Key is required for reservation renewal");
    const scope = "reservation.renew";
    const requestHash = idempotencyService.hashRequest(scope, body, { reservationId });
    const t = await models.sequelize.transaction();
    try {
      const claim = await idempotencyService.claim({ models, companyId, scope, key: idempotencyKey, requestHash, transaction: t });
      if (!claim.claimed) {
        try { await t.rollback(); } catch (_) {}
        const prior = await idempotencyService.resolveExisting({ models, companyId, scope, key: idempotencyKey, requestHash });
        if (prior.state === "replay") return { statusCode: prior.statusCode, responseBody: prior.responseBody };
        throw new ConflictError(prior.message);
      }
      const response = await this._renewInTransaction({ companyId, branchId, user, reservationId, body, idempotencyKey, transaction: t });
      const responseBody = { success: true, data: response };
      await idempotencyService.succeed({ request: claim.request, statusCode: 201, responseBody, transaction: t });
      await t.commit();
      return { statusCode: 201, responseBody };
    } catch (error) {
      try { await t.rollback(); } catch (_) {}
      throw error;
    }
  }

  async _renewInTransaction({ companyId, branchId, user, reservationId, body = {}, idempotencyKey, transaction }) {
    const actor = actorName(user);
    const reason = String(body.reason || "").trim();
    if (!reason) throw new ValidationError("Renewal reason is required");

    const source = await requireReservationInBranch({ companyId, branchId, reservationId, transaction, lock: true });
    if (source.isLegacy || Number(source.workflowVersion || 1) < 2) throw new ConflictError("Legacy reservations cannot be renewed through the new workflow");
    if (!source.expiredBySystem) throw new ConflictError("Only automatically expired reservations can be renewed");
    if (source.status === "renewed" || source.successorReservationId) throw new ConflictError("Reservation has already been renewed");
    if (!["cancelled_refund_pending", "cancelled"].includes(source.status)) throw new ConflictError("Reservation is not in an expired renewable state");
    if (source.finalInvoiceId) throw new ConflictError("Completed reservations cannot be renewed");

    const activeRefund = await models.ReservationRefund.findOne({
      where: { companyId, reservationId: source.id, refundType: "reservation_full", status: ["requested", "approved"] },
      transaction, lock: true
    });
    if (activeRefund) throw new ConflictError("A full refund is already in progress for this reservation");
    const existingRenewal = await models.ReservationRenewal.findOne({
      where: { companyId, sourceReservationId: source.id, status: ["requested", "pending_excess_refund", "ready_to_activate", "activated"] },
      transaction, lock: true
    });
    if (existingRenewal) throw new ConflictError("A renewal is already in progress for this reservation");

    // Successor item selection — client supplies asset ids only; prices are
    // resolved server-side from the current asset records.
    const rawAssetIds = Array.isArray(body.successorAssetIds) && body.successorAssetIds.length
      ? body.successorAssetIds
      : Array.isArray(body.items) ? body.items.map((i) => i.assetId) : [];
    const successorAssetIds = [...new Set(rawAssetIds.map((v) => String(v || "").trim()).filter(Boolean))];
    if (!successorAssetIds.length) throw new ValidationError("Renewal requires at least one successor asset");
    if (successorAssetIds.length !== rawAssetIds.length) throw new ConflictError("A successor asset cannot be selected twice");

    const now = await trustedNow(transaction);
    const newExpiry = parseExpiry(body.newExpiry || body.expiresAt);
    if (!newExpiry) throw new ValidationError("A valid successor expiry date/time is required");
    if (newExpiry.getTime() <= now.getTime()) throw new ValidationError("Successor expiry must be in the future");
    const newExpiryStr = typeof (body.newExpiry || body.expiresAt) === "string" ? String(body.newExpiry || body.expiresAt) : newExpiry.toISOString();

    const assets = await models.Asset.findAll({ where: { companyId, id: [...successorAssetIds].sort() }, transaction, lock: true });
    if (assets.length !== successorAssetIds.length) throw new NotFoundError("One or more successor assets were not found");
    const assetsById = new Map(assets.map((a) => [a.id, a]));
    let successorTotalUnits = 0n;
    const priceEvidence = [];
    for (const aid of successorAssetIds) {
      const asset = assetsById.get(aid);
      if (asset.status !== "available") throw new ConflictError(`Asset ${aid} is not available for the successor reservation`);
      assertSameBranch(asset, source.branchId, "Asset");
      const priceUnits = currentAssetPriceUnits(asset);
      successorTotalUnits += priceUnits;
      priceEvidence.push({ assetId: aid, price: formatMoney(priceUnits), resolvedAt: now.toISOString() });
    }

    const { units: transferableUnits } = await calculateTransferableUnits(source.id, companyId, transaction);
    const advancesAccount = await getReservationAdvancesAccount(companyId, source.branchId, transaction);

    // Create successor reservation + items (assets reserved).
    const successorId = body.successorId || uid("RES");
    const firstAsset = assetsById.get(successorAssetIds[0]);
    const successor = await models.Reservation.create({
      id: successorId,
      companyId,
      assetId: firstAsset.id,
      assetName: firstAsset.name,
      customerId: source.customerId,
      customerName: source.customerName,
      branch: source.branch,
      branchId: source.branchId || null,
      currency: source.currency || "AED",
      deposit: 0,
      agreedTotal: formatMoney(successorTotalUnits),
      paidTotal: "0.0000",
      remainingTotal: formatMoney(successorTotalUnits),
      excessTotal: "0.0000",
      expiresAt: newExpiryStr,
      workflowVersion: 2,
      isLegacy: false,
      version: 1,
      predecessorReservationId: source.id,
      status: "pending_renewal_settlement",
      createdBy: actor,
      updatedBy: actor,
      notes: body.notes || `Renewal successor of reservation ${source.id}`
    }, { transaction });

    let itemIndex = 0;
    for (const aid of successorAssetIds) {
      itemIndex += 1;
      const asset = assetsById.get(aid);
      const priceUnits = currentAssetPriceUnits(asset);
      await models.ReservationItem.create({
        id: `RSI-${nowStamp()}-S${itemIndex}-${Math.random().toString(36).slice(2, 5)}`,
        companyId,
        reservationId: successor.id,
        assetId: asset.id,
        assetName: asset.name,
        itemType: "asset",
        agreedPrice: formatMoney(priceUnits),
        originalPrice: asset.price,
        status: "active",
        reservedAt: now,
        addedBy: actor
      }, { transaction });
      await asset.update({ status: "reserved" }, { transaction });
      await models.AssetEvent.create({
        id: uid("ASE-RES-RENEW"),
        assetId: asset.id,
        action: "RESERVED",
        date: now.toISOString().slice(0, 10),
        user: actor,
        branch: successor.branch,
        note: `Reserved by renewal successor ${successor.id} of ${source.id}`,
        sourceDocument: successor.id,
        beforeState: "status:available",
        afterState: "status:reserved",
        severity: "info"
      }, { transaction });
    }

    const excessUnits = transferableUnits > successorTotalUnits ? transferableUnits - successorTotalUnits : 0n;
    const renewal = await models.ReservationRenewal.create({
      id: uid("RRN"),
      companyId,
      sourceReservationId: source.id,
      successorReservationId: successor.id,
      customerId: source.customerId,
      branchId: source.branchId || null,
      currency: source.currency || "AED",
      sourceTransferableBalance: formatMoney(transferableUnits),
      successorTotal: formatMoney(successorTotalUnits),
      transferAmount: "0.0000",
      excessRefundAmount: formatMoney(excessUnits),
      status: "requested",
      currentPriceEvidence: priceEvidence,
      reason,
      requestedBy: actor,
      requestedAt: now,
      idempotencyKey,
      version: 1
    }, { transaction });

    await audit(companyId, "reservation.renewal_requested", {
      reservationId: source.id, branchId: source.branchId, user: actor, userId: user?.id,
      after: { renewalId: renewal.id, successorId: successor.id, transferable: formatMoney(transferableUnits), successorTotal: formatMoney(successorTotalUnits), excess: formatMoney(excessUnits) }
    }, transaction);
    await audit(companyId, "reservation.successor_created", {
      reservationId: successor.id, branchId: successor.branchId, user: actor, userId: user?.id,
      after: { predecessorId: source.id, successorId: successor.id, total: formatMoney(successorTotalUnits), items: successorAssetIds.length }
    }, transaction);
    await notifyReservation(companyId, "renewal_requested", source, {
      title: "Reservation renewal requested",
      message: `Reservation ${source.id} renewal created successor ${successor.id}.`,
      type: "info",
      sourceId: renewal.id
    }, transaction);

    if (transferableUnits <= successorTotalUnits) {
      // No excess — transfer the full eligible balance and activate immediately.
      const transferredUnits = await this._transferAndActivateSuccessor({
        companyId, source, successor, renewal, transferUnits: transferableUnits, advancesAccount, actor, now, idempotencyKey, transaction
      });
      await this._finalizeSuccessorActivation({ companyId, source, successor, renewal, transferredUnits, successorTotalUnits, actor, now, transaction });
      const refreshed = await models.Reservation.findOne({ where: { id: successor.id, companyId }, transaction });
      return { source, successor: refreshed, renewal, mode: "activated", transferAmount: formatMoney(transferredUnits) };
    }

    // Excess — successor stays pending; require excess refund before activation.
    const methods = [...new Set((await models.ReservationPayment.findAll({ where: { reservationId: source.id, companyId, status: "posted" }, transaction })).map((p) => String(p.paymentMethod || "cash").toLowerCase()))];
    const refundMethod = body.refundMethod || body.requestedRefundMethod || methods[0] || "cash";
    const differs = !methods.includes(String(refundMethod || "cash").toLowerCase());
    const excessRefund = await models.ReservationRefund.create({
      id: uid("RRF"),
      companyId,
      reservationId: source.id,
      customerId: source.customerId,
      branchId: source.branchId || null,
      amount: formatMoney(excessUnits),
      currency: source.currency || "AED",
      status: "requested",
      refundType: "renewal_excess",
      renewalId: renewal.id,
      requestedRefundMethod: refundMethod,
      treasuryAccountCode: treasuryAccountCode(refundMethod),
      methodDiffersFromOriginal: differs,
      methodOverrideApproved: false,
      reason: `Renewal excess refund for renewal ${renewal.id}`,
      requestedBy: actor,
      requestedAt: now,
      version: 1
    }, { transaction });
    await renewal.update({ status: "pending_excess_refund", excessRefundId: excessRefund.id, version: Number(renewal.version || 0) + 1 }, { transaction });
    await source.update({ renewalStatus: "pending_excess_refund", updatedBy: actor, version: Number(source.version || 0) + 1 }, { transaction });
    await audit(companyId, "reservation.renewal_excess_refund_requested", {
      reservationId: source.id, branchId: source.branchId, user: actor, userId: user?.id,
      after: { renewalId: renewal.id, refundId: excessRefund.id, excess: formatMoney(excessUnits) }
    }, transaction);
    await notifyReservation(companyId, "renewal_excess_refund_requested", source, {
      title: "Renewal excess refund requested",
      message: `Renewal ${renewal.id} requires excess refund ${excessRefund.id}.`,
      type: "approval",
      sourceId: excessRefund.id
    }, transaction);

    return { source, successor, renewal, excessRefund, mode: "pending_excess_refund", excessAmount: formatMoney(excessUnits) };
  }

  // Allocate transfer value from the source's available advance payments to new
  // successor payment rows. No cash/bank/revenue/VAT/AR/COGS/inventory line and
  // no new advance journal are produced: the customer's Reservation Advances
  // liability, customer, branch, company, and currency are all unchanged. The
  // immutable transfer subledger is the reconciliation source of truth.
  async _transferAndActivateSuccessor({ companyId, source, successor, renewal, transferUnits, advancesAccount, actor, now, idempotencyKey, transaction }) {
    if (transferUnits <= 0n) return 0n;
    const availability = await sourcePaymentAvailability(source.id, companyId, transaction);
    const allocations = allocateAcrossPayments(availability, transferUnits);
    let transferred = 0n;
    let idx = 0;
    for (const alloc of allocations) {
      idx += 1;
      const targetPayment = await models.ReservationPayment.create({
        id: `RSP-XFER-${nowStamp()}-${idx}-${Math.random().toString(36).slice(2, 5)}`,
        companyId,
        reservationId: successor.id,
        customerId: successor.customerId,
        branchId: successor.branchId || null,
        amount: formatMoney(alloc.units),
        currency: successor.currency || "AED",
        paymentMethod: "reservation_transfer",
        treasuryAccountCode: alloc.payment.treasuryAccountCode || "1110",
        advancesAccountId: advancesAccount.id,
        advancesAccountCode: advancesAccount.code,
        receiptNumber: `RCP-XFER-${nowStamp()}-${idx}`,
        status: "posted",
        journalEntryId: null,
        receivedBy: actor,
        receivedAt: now,
        origin: "renewal_transfer"
      }, { transaction });
      const transfer = await models.ReservationPaymentTransfer.create({
        id: uid("RPT"),
        companyId,
        renewalId: renewal.id,
        sourceReservationId: source.id,
        targetReservationId: successor.id,
        sourcePaymentId: alloc.payment.id,
        targetPaymentId: targetPayment.id,
        customerId: source.customerId,
        branchId: source.branchId || null,
        currency: source.currency || "AED",
        amount: formatMoney(alloc.units),
        advancesAccountCode: advancesAccount.code,
        journalEntryId: null,
        status: "posted",
        transferredBy: actor,
        transferredAt: now,
        idempotencyKey
      }, { transaction });
      await targetPayment.update({ sourceTransferId: transfer.id }, { transaction });
      transferred += alloc.units;
      await audit(companyId, "reservation.payment_transferred", {
        reservationId: successor.id, branchId: successor.branchId, user: actor,
        after: { transferId: transfer.id, renewalId: renewal.id, sourcePaymentId: alloc.payment.id, targetPaymentId: targetPayment.id, amount: formatMoney(alloc.units) }
      }, transaction);
    }
    return transferred;
  }

  async _finalizeSuccessorActivation({ companyId, source, successor, renewal, transferredUnits, successorTotalUnits, actor, now, transaction }) {
    const remainingUnits = successorTotalUnits - transferredUnits;
    const status = reservationStatusForTotals(transferredUnits, successorTotalUnits);
    await successor.update({
      paidTotal: formatMoney(transferredUnits),
      remainingTotal: formatMoney(remainingUnits),
      status,
      fullyPaidAt: status === "fully_paid" ? now : null,
      version: Number(successor.version || 0) + 1,
      updatedBy: actor
    }, { transaction });
    await source.update({
      status: "renewed",
      renewedAt: now,
      renewedBy: actor,
      successorReservationId: successor.id,
      renewalStatus: "renewed",
      version: Number(source.version || 0) + 1,
      updatedBy: actor
    }, { transaction });
    await renewal.update({
      status: "activated",
      transferAmount: formatMoney(transferredUnits),
      successorReservationId: successor.id,
      activatedBy: actor,
      activatedAt: now,
      version: Number(renewal.version || 0) + 1
    }, { transaction });
    await audit(companyId, "reservation.renewed", {
      reservationId: source.id, branchId: source.branchId, user: actor,
      after: { renewalId: renewal.id, successorId: successor.id, transferAmount: formatMoney(transferredUnits) }
    }, transaction);
    await audit(companyId, "reservation.successor_activated", {
      reservationId: successor.id, branchId: successor.branchId, user: actor,
      after: { successorId: successor.id, status, paidTotal: formatMoney(transferredUnits), remaining: formatMoney(remainingUnits) }
    }, transaction);
    await notifyReservation(companyId, "renewed", source, {
      title: "Reservation renewed",
      message: `Reservation ${source.id} was renewed as ${successor.id}.`,
      type: "success",
      sourceId: renewal.id
    }, transaction);
  }

  async approveRenewalExcessRefund({ companyId, branchId, user, refundId, body = {} }) {
    const t = await models.sequelize.transaction();
    try {
      const actor = actorName(user);
      const refund = await models.ReservationRefund.findOne({ where: { id: refundId, companyId, refundType: "renewal_excess" }, transaction: t, lock: true });
      if (!refund) throw new NotFoundError("Renewal excess refund not found");
      await requireReservationInBranch({
        companyId,
        branchId,
        reservationId: refund.reservationId,
        transaction: t,
        lock: true
      });
      if (refund.status !== "requested") throw new ConflictError("Only requested renewal excess refunds can be approved");
      const now = new Date();
      await refund.update({
        status: "approved",
        approvedBy: actor,
        approvedAt: now,
        methodOverrideApproved: Boolean(body.methodOverrideApproved || !refund.methodDiffersFromOriginal),
        version: Number(refund.version || 0) + 1
      }, { transaction: t });
      await audit(companyId, "reservation.renewal_excess_refund_approved", {
        reservationId: refund.reservationId, branchId: refund.branchId, user: actor, userId: user?.id,
        after: { refundId: refund.id, renewalId: refund.renewalId, amount: refund.amount, methodOverrideApproved: refund.methodOverrideApproved }
      }, t);
      await t.commit();
      return { statusCode: 200, responseBody: { success: true, data: { refund } } };
    } catch (error) {
      try { await t.rollback(); } catch (_) {}
      throw error;
    }
  }

  async executeRenewalExcessRefund({ companyId, branchId, user, refundId, body = {}, idempotencyKey }) {
    if (!idempotencyKey) throw new ValidationError("Idempotency-Key is required for renewal excess refund execution");
    const scope = "reservation.renewal.excess.execute";
    const requestHash = idempotencyService.hashRequest(scope, body, { refundId });
    const t = await models.sequelize.transaction();
    try {
      const claim = await idempotencyService.claim({ models, companyId, scope, key: idempotencyKey, requestHash, transaction: t });
      if (!claim.claimed) {
        try { await t.rollback(); } catch (_) {}
        const prior = await idempotencyService.resolveExisting({ models, companyId, scope, key: idempotencyKey, requestHash });
        if (prior.state === "replay") return { statusCode: prior.statusCode, responseBody: prior.responseBody };
        throw new ConflictError(prior.message);
      }
      const response = await this._executeRenewalExcessRefundInTransaction({ companyId, branchId, user, refundId, body, idempotencyKey, transaction: t });
      const responseBody = { success: true, data: response };
      await idempotencyService.succeed({ request: claim.request, statusCode: 200, responseBody, transaction: t });
      await t.commit();
      return { statusCode: 200, responseBody };
    } catch (error) {
      try { await t.rollback(); } catch (_) {}
      throw error;
    }
  }

  async _executeRenewalExcessRefundInTransaction({ companyId, branchId, user, refundId, body = {}, idempotencyKey, transaction }) {
    const actor = actorName(user);
    const refund = await models.ReservationRefund.findOne({ where: { id: refundId, companyId, refundType: "renewal_excess" }, transaction, lock: true });
    if (!refund) throw new NotFoundError("Renewal excess refund not found");
    if (refund.status === "executed") throw new ConflictError("Renewal excess refund has already been executed");
    if (refund.status !== "approved") throw new ConflictError("Renewal excess refund must be approved before execution");
    if (refund.methodDiffersFromOriginal && !refund.methodOverrideApproved) throw new ConflictError("Different refund method requires approval before execution");

    const renewal = await models.ReservationRenewal.findOne({ where: { id: refund.renewalId, companyId }, transaction, lock: true });
    if (!renewal) throw new NotFoundError("Renewal not found");
    if (renewal.status !== "pending_excess_refund") throw new ConflictError("Renewal is not awaiting excess refund");
    const source = await requireReservationInBranch({
      companyId,
      branchId,
      reservationId: renewal.sourceReservationId,
      transaction,
      lock: true
    });
    const successor = await models.Reservation.findOne({ where: { id: renewal.successorReservationId, companyId }, transaction, lock: true });
    if (!successor) throw new NotFoundError("Renewal reservations not found");
    assertSameBranch(successor, branchId, "Renewal successor");

    const now = new Date();
    const advancesAccount = await getReservationAdvancesAccount(companyId, source.branchId, transaction);
    const treasuryCode = body.treasuryAccountCode || refund.treasuryAccountCode || treasuryAccountCode(refund.requestedRefundMethod);
    const excessUnits = parseMoneyUnits(refund.amount, "excess refund amount");
    const successorTotalUnits = parseMoneyUnits(renewal.successorTotal, "successor total");

    // Post the excess refund: Dr Reservation Advances / Cr selected Cash/Bank.
    await refund.update({ treasuryAccountCode: treasuryCode, executedBy: actor, executedAt: now, idempotencyKey, version: Number(refund.version || 0) + 1 }, { transaction });
    const journal = await postingService.postReservationRefundEntry(refund, actor, {
      transaction, advancesAccountCode: advancesAccount.code, treasuryAccountCode: treasuryCode, branchId: source.branchId
    });
    const cashTx = await models.CashTransaction.create({
      id: uid("TX-RES-XSREF"),
      companyId,
      branchId: source.branchId || null,
      branch: source.branch || "Main Branch",
      type: "cash_out",
      account: accountNameFromCode(treasuryCode),
      amount: formatMoney(excessUnits),
      category: "استرداد فائض تجديد حجز",
      counterAccountCode: advancesAccount.code,
      description: `استرداد فائض تجديد حجز ${source.id}`,
      reference: refund.id,
      date: now.toISOString().slice(0, 10),
      status: "posted",
      createdBy: user?.id || actor,
      journalEntryId: journal.id,
      idempotencyKey
    }, { transaction });

    // Allocate the excess against the source's available advance payments
    // (records the refunded portion without mutating original payment rows).
    const availabilityForRefund = await sourcePaymentAvailability(source.id, companyId, transaction);
    const refundAllocations = allocateAcrossPayments(availabilityForRefund, excessUnits);
    for (const alloc of refundAllocations) {
      await models.ReservationRefundAllocation.create({
        id: uid("RRA"),
        companyId,
        reservationRefundId: refund.id,
        reservationPaymentId: alloc.payment.id,
        allocatedAmount: formatMoney(alloc.units)
      }, { transaction });
    }
    await refund.update({ status: "executed", journalEntryId: journal.id, cashTransactionId: cashTx.id }, { transaction });
    await audit(companyId, "reservation.renewal_excess_refund_executed", {
      reservationId: source.id, branchId: source.branchId, user: actor, userId: user?.id,
      after: { refundId: refund.id, renewalId: renewal.id, amount: refund.amount, journalEntryId: journal.id, cashTransactionId: cashTx.id }
    }, transaction);

    await renewal.update({ status: "ready_to_activate", version: Number(renewal.version || 0) + 1 }, { transaction });

    // Transfer exactly the successor total, then activate the successor.
    const transferredUnits = await this._transferAndActivateSuccessor({
      companyId, source, successor, renewal, transferUnits: successorTotalUnits, advancesAccount, actor, now, idempotencyKey, transaction
    });
    await this._finalizeSuccessorActivation({ companyId, source, successor, renewal, transferredUnits, successorTotalUnits, actor, now, transaction });

    const refreshedSuccessor = await models.Reservation.findOne({ where: { id: successor.id, companyId }, transaction });
    return { source, successor: refreshedSuccessor, renewal, refund, journal, cashTransaction: cashTx, transferAmount: formatMoney(transferredUnits) };
  }

  async _createPaymentInTransaction({ companyId, reservation, customer, user, amountUnits, paymentMethod, receivedEmployeeId, sourceReference, advancesAccount, idempotencyKey, transaction }) {
    const receivedAt = new Date();
    const actor = actorName(user);
    const payment = await models.ReservationPayment.create({
      id: `RSP-${nowStamp()}-${Math.floor(Math.random() * 100000)}`,
      companyId,
      reservationId: reservation.id,
      customerId: customer.id,
      branchId: reservation.branchId || null,
      amount: formatMoney(amountUnits),
      currency: reservation.currency || "AED",
      paymentMethod,
      treasuryAccountCode: treasuryAccountCode(paymentMethod),
      advancesAccountId: advancesAccount.id,
      advancesAccountCode: advancesAccount.code,
      receiptNumber: `RCP-RES-${nowStamp()}-${Math.floor(Math.random() * 1000)}`,
      status: "posted",
      idempotencyKey,
      receivedBy: actor,
      receivedEmployeeId,
      receivedAt,
      sourceReference
    }, { transaction });

    const journal = await postingService.postReservationPaymentEntry(payment, actor, {
      transaction,
      treasuryAccountCode: payment.treasuryAccountCode,
      advancesAccountCode: advancesAccount.code,
      branchId: reservation.branchId
    });
    await payment.update({ journalEntryId: journal.id }, { transaction });
    await audit(companyId, "reservation.payment_posted", {
      reservationId: reservation.id,
      branchId: reservation.branchId,
      user: actor,
      userId: user?.id,
      after: {
        paymentId: payment.id,
        receiptNumber: payment.receiptNumber,
        amount: formatMoney(amountUnits),
        journalEntryId: journal.id,
        treasuryAccountCode: payment.treasuryAccountCode,
        advancesAccountCode: advancesAccount.code
      }
    }, transaction);
    return payment;
  }
}

module.exports = new ReservationService();
module.exports._internal = {
  parseMoneyUnits,
  formatMoney,
  toNumber,
  getReservationAdvancesAccount,
  treasuryAccountCode,
  reservationVisibilityWhere,
  actorName
};
