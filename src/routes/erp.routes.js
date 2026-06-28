const express = require("express");
const bcrypt = require("bcryptjs");
const { Op } = require("sequelize");
const { authMiddleware, requirePermission, requireAnyPermission } = require("../middleware/auth.middleware");
const ErpController = require("../controllers/erp.controller");
const models = require("../models");
const postingService = require("../services/posting.service");
const journalService = require("../services/journal.service");
const goldService = require("../services/gold.service");
const settingsService = require("../services/settings.service");
const salesService = require("../services/sales.service");
const goldCostService = require("../services/gold-cost.service");
const auditService = require("../services/audit.service");
const { emitEntityChanged } = require("../services/realtime-helper.service");
const notificationService = require("../services/notification.service");
const logger = require("../utils/logger");
const { ValidationError, NotFoundError, ConflictError, ForbiddenError } = require("../utils/errors");
const uploadMiddleware = require("../middleware/upload.middleware");
const { moveUploadedFileSafe } = require("../utils/file-move");

const router = express.Router();
const allowAuthenticated = (req, res, next) => next();

// Restrict an invoice where-clause to POSTED invoices only — the single source
// of truth for every financial aggregate (sales totals, customer purchases,
// branch/customer KPIs). Drafts and cancelled drafts must never be counted.
const postedInvoiceWhere = (where = {}) => ({ ...where, postingStatus: "posted" });

// Compute the next sequential customer-facing invoice number for a company.
// Draws from the MAX of BOTH `id` and `invoice_number` matching the padded
// `${prefix}-NNNNNN` pattern, so POS checkout (id == invoiceNumber) and posted
// drafts (id = DRAFT-*, invoiceNumber = INV-*) share ONE sequence and never
// collide. Run inside the posting transaction.
async function nextInvoiceNumber(companyId, prefix, t) {
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
    transaction: t,
  });
  let max = 0;
  const consider = (val) => {
    if (typeof val === "string" && val.startsWith(`${prefix}-`)) {
      const n = parseInt(val.slice(prefix.length + 1), 10);
      if (Number.isInteger(n) && n > max) max = n;
    }
  };
  for (const r of rows) { consider(r.id); consider(r.invoiceNumber); }
  return `${prefix}-${String(max + 1).padStart(6, "0")}`;
}

function getPurityFromKarat(karat) {
  const numericKarat = Number(karat);
  if (numericKarat === 24) return 1;
  if (numericKarat === 22) return 0.916;
  if (numericKarat === 21) return 0.875;
  if (numericKarat === 18) return 0.75;
  return null;
}

function isArabicRequest(req) {
  return String(req.headers["accept-language"] || req.headers["x-locale"] || "ar").toLowerCase().startsWith("ar");
}

function linkedDeleteMessage(req) {
  return isArabicRequest(req)
    ? "لا يمكن حذف هذا السجل لأنه مرتبط بحركات أو مستندات. يمكنك إلغاء تنشيطه بدلًا من الحذف."
    : "This record cannot be deleted because it is linked to transactions or documents. You can deactivate it instead.";
}

function lastActiveBranchDeactivateMessage(req) {
  return isArabicRequest(req)
    ? "لا يمكن إلغاء تنشيط آخر فرع نشط. يجب أن يكون هناك فرع نشط واحد على الأقل."
    : "You cannot deactivate the last active branch. At least one active branch is required.";
}

function lastActiveBranchDeleteMessage(req) {
  return isArabicRequest(req)
    ? "لا يمكن حذف آخر فرع نشط. يجب أن يكون هناك فرع نشط واحد على الأقل."
    : "You cannot delete the last active branch. At least one active branch is required.";
}

function linkedRecordsError(req, code, linked) {
  const err = new ValidationError(linkedDeleteMessage(req), linked);
  err.errorCode = code || "HAS_LINKED_RECORDS";
  err.linked = linked;
  return err;
}

async function countLinkedRecords(checks) {
  const entries = await Promise.all(
    checks.map(async ([key, fn]) => [key, await fn()])
  );
  return Object.fromEntries(entries.filter(([, count]) => Number(count) > 0));
}

const CRUD_PERMISSIONS = {
  customers: "customers",
  suppliers: "suppliers",
  assets: "inventory",
  products: "inventory",
  "stock-movements": "inventory",
  invoices: "sales",
  reservations: "sales",
  "purchase-orders": "suppliers",
  "approval-requests": "approvals",
  "journal-entries": "accounting",
  accounts: "accounting",
  "cash-transactions": "treasury",
  branches: "branches",
};

function guardFor(resourceName, action) {
  const permissionModule = CRUD_PERMISSIONS[resourceName];
  if (!permissionModule) return allowAuthenticated;
  const mappedAction = action === "list" || action === "get" ? "view" : action;
  const candidates = [
    `${permissionModule}.${mappedAction}`,
    mappedAction === "delete" ? `${permissionModule}.update` : null,
    mappedAction === "update" ? `${permissionModule}.adjust` : null,
    mappedAction === "create" ? `${permissionModule}.update` : null,
    permissionModule === "approvals" && mappedAction !== "view" ? "approvals.manage" : null,
    permissionModule === "accounting" && mappedAction !== "view" ? "accounting.post" : null,
    permissionModule === "treasury" && mappedAction !== "view" ? "treasury.update" : null,
  ].filter(Boolean);
  return candidates.length === 1 ? requirePermission(candidates[0]) : requireAnyPermission(candidates);
}

/**
 * Utility to define standard CRUD routes for any Sequelize model
 */
function setupCrud(resourceName, model, searchFields = ["name"]) {
  const controller = new ErpController(model, searchFields);

  router.get(`/${resourceName}`, authMiddleware, guardFor(resourceName, "list"), controller.list);
  router.get(`/${resourceName}/:id`, authMiddleware, guardFor(resourceName, "get"), controller.getById);
  router.post(`/${resourceName}`, authMiddleware, guardFor(resourceName, "create"), controller.create);
  // Support both PUT (full) and PATCH (partial) — the generic update merges
  // only the fields present in the body, so both are safe.
  router.put(`/${resourceName}/:id`, authMiddleware, guardFor(resourceName, "update"), controller.update);
  router.patch(`/${resourceName}/:id`, authMiddleware, guardFor(resourceName, "update"), controller.update);
  router.post(`/${resourceName}/:id/deactivate`, authMiddleware, guardFor(resourceName, "update"), controller.deactivate);
  router.post(`/${resourceName}/:id/reactivate`, authMiddleware, guardFor(resourceName, "update"), controller.reactivate);
  router.delete(`/${resourceName}/:id`, authMiddleware, guardFor(resourceName, "delete"), controller.delete);

  return controller;
}

// ─── Custom POS Checkout Endpoint ───────────────────────────────────────────
router.post("/pos/checkout", authMiddleware, requirePermission("pos.sell"), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const body = req.body || {};
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    const idempotencyKey = req.headers["idempotency-key"] || body.idempotencyKey;

    // 1. Idempotency Check
    if (idempotencyKey) {
      const existing = await models.Invoice.findOne({
        where: { idempotencyKey, companyId: req.companyId },
        include: [
          { model: models.InvoiceItem, as: "items" },
          { model: models.Installment, as: "installments" }
        ],
        transaction: t
      });
      if (existing) {
        await t.rollback();
        return res.status(200).json({ success: true, ...existing.toJSON(), data: existing.toJSON() });
      }
    }

    // 2. Extract active branch
    const branchId = req.headers["x-branch-id"] || body.branchId;
    if (!branchId) {
      throw new ValidationError("الفرع النشط مطلوب");
    }

    // Validate Branch belongs to same company, is active
    const branchRecord = await models.Branch.findOne({
      where: { id: branchId, companyId: req.companyId, isActive: true },
      transaction: t
    });
    if (!branchRecord) {
      throw new ValidationError("الفرع المحدد غير موجود أو غير نشط");
    }

    // Branch authorization check
    if (req.user && req.user.branchId && req.user.branchId !== branchId) {
      const hasCrossBranch = req.user.permissions && (req.user.permissions.includes("pos.view") || req.user.isAdmin);
      if (!hasCrossBranch) {
        throw new ValidationError("ليس لديك صلاحية على هذا الفرع");
      }
    }

    // 3. Customer validation
    const customerId = body.customerId;
    if (!customerId) {
      throw new ValidationError("العميل مطلوب لإتمام عملية البيع");
    }
    const customer = await models.Customer.findOne({
      where: { id: customerId, companyId: req.companyId },
      transaction: t
    });
    if (!customer) {
      throw new ValidationError("العميل المحدد غير موجود");
    }

    // 4. Products/assets validation
    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) {
      throw new ValidationError("لا يمكن البيع بدون منتجات في السلة");
    }

    const validatedItems = [];
    let subtotal = 0;

    for (const item of items) {
      const itemId = item.assetId || item.id;
      if (!itemId) continue;

      // 1. Try Product first
      const product = await models.Product.findOne({
        where: { id: itemId, companyId: req.companyId },
        lock: true,
        transaction: t
      });

      if (product) {
        const qty = Number(item.quantity) || 1;
        if (Number(product.quantityAvailable) < qty) {
          throw new ValidationError(`الكمية المطلوبة غير متاحة في المخزون للمنتج ${product.productName}. المتاح: ${product.quantityAvailable}`);
        }
        if (product.branchId !== branchId) {
          throw new ValidationError(`المنتج ${product.productName} تابع لفرع آخر وليس للفرع النشط`);
        }

        const itemWeight = Number(item.totalWeight) || (Number(product.averageUnitWeight || 0) * qty);
        const itemPrice = Number(item.price) || Number(product.salePrice) || 0;

        validatedItems.push({
          isProduct: true,
          product,
          quantity: qty,
          price: itemPrice,
          weight: itemWeight,
          cost: Number(product.unitCost) || 0,
          discount: Number(item.discount) || 0,
          makingCharge: Number(item.makingCharge) || 0,
          stoneValue: Number(item.stoneValue) || 0
        });

        subtotal += itemPrice * qty;
      } else {
        // 2. Try Asset
        const asset = await models.Asset.findOne({
          where: { id: itemId, companyId: req.companyId },
          lock: true,
          transaction: t
        });

        if (!asset) {
          throw new ValidationError(`المنتج ذو الرمز ${itemId} غير موجود في المخزون`);
        }
        if (asset.status !== "available") {
          throw new ValidationError(`المنتج ${asset.name} (${asset.id}) غير متاح للبيع حالياً، حالته: ${asset.status}`);
        }
        if (asset.branchId !== branchId) {
          throw new ValidationError(`المنتج ${asset.name} (${asset.id}) تابع لفرع آخر وليس للفرع النشط`);
        }

        validatedItems.push({
          isProduct: false,
          asset,
          quantity: 1,
          price: Number(item.price) || Number(asset.price) || 0,
          weight: Number(asset.grossWeight) || 0,
          cost: Number(asset.cost) || 0,
          discount: Number(item.discount) || 0,
          makingCharge: Number(item.makingCharge) || 0,
          stoneValue: Number(item.stoneValue) || 0
        });

        subtotal += Number(item.price) || Number(asset.price) || 0;
      }
    }
    const discount = Number(body.discount) || 0;
    const makingCharge = Number(body.makingCharge) || 0;
    const stoneValue = Number(body.stoneValue) || 0;

    if (discount > (subtotal + makingCharge + stoneValue)) {
      const hasDiscountApprove = req.user && (req.user.permissions && req.user.permissions.includes("pos.discount.approve") || req.user.isAdmin);
      if (!hasDiscountApprove) {
        throw new ValidationError("قيمة الخصم تتجاوز إجمالي الفاتورة وتتطلب صلاحية اعتماد الخصم");
      }
    }

    // 6. Settings + totals via the shared sales service (single source of truth)
    const settings = await settingsService.getCompanySettings(req.companyId, { transaction: t });
    const totals = salesService.computeTotals({ subtotal, makingCharge, stoneValue, discount, vatRatePercent: settings.vatRate });
    const vatRatePercent = totals.vatRate;
    const computedTax = totals.tax;
    const total = totals.total;

    // 7. Resolve payment outcome + installment schedule (shared rules/validation)
    const paymentMethod = body.paymentMethod || "cash";
    const payment = salesService.resolvePayment({
      paymentMethod,
      total,
      body,
      installmentRules: settings.installment,
      user: req.user,
    });
    const { paidAmount, remainingAmount, status, installmentsToCreate } = payment;

    // 8. Generate safe sequence invoice ID. Shared generator considers posted-
    // draft invoice_numbers too so POS and post-draft never reuse a number.
    // (Same INV-prefix-NNNNNN result as before; just collision-safe.)
    const prefix = settings.invoicePrefix || "INV-2026";
    const invoiceId = await nextInvoiceNumber(req.companyId, prefix, t);

    // 8. Create Invoice
    const nowStr = new Date().toISOString().slice(0, 16).replace("T", " ");
    const invoice = await models.Invoice.create({
      id: invoiceId,
      companyId: req.companyId,
      branchId,
      branch: branchRecord.name,
      customerId,
      customerName: customer.name,
      type: paymentMethod === "installment" ? "installment" : (paymentMethod === "deposit" ? "deposit" : "sale"),
      date: body.date || nowStr.slice(0, 10),
      // Stored subtotal is the net-of-VAT base (= total - tax) so the journal
      // entry balances and it matches the convention used by existing invoices.
      subtotal: totals.taxBase,
      tax: computedTax,
      vatRate: vatRatePercent,
      discount,
      makingCharge,
      stoneValue,
      total,
      paidAmount,
      remainingAmount,
      status,
      paymentMethod,
      paymentSplits: body.paymentSplits || [],
      downPayment: body.downPayment || 0,
      installmentCount: body.installmentCount || 0,
      guarantorName: body.guarantorName || "",
      guarantorPhone: body.guarantorPhone || "",
      installmentFrequency: body.installmentFrequency || "monthly",
      notes: body.notes || "",
      idempotencyKey: idempotencyKey || null,
      postingStatus: "posted", // immediate-post path (POS checkout)
      invoiceNumber: invoiceId, // customer-facing number == id for POS sales
      postedAt: nowStr
    }, { transaction: t });

    // 9. Create Invoice Items & Update Stock Status (Products & Assets)
    const invoiceItems = [];
    for (const vItem of validatedItems) {
      if (vItem.isProduct) {
        const product = vItem.product;
        const qty = vItem.quantity;
        
        // Decrement available and physical stock, increment sold count
        product.quantityAvailable = Math.round((Number(product.quantityAvailable) - qty) * 100) / 100;
        product.quantityOnHand = Math.round((Number(product.quantityOnHand) - qty) * 100) / 100;
        product.quantitySold = Math.round((Number(product.quantitySold) + qty) * 100) / 100;
        product.totalWeight = Math.round((Number(product.totalWeight) - vItem.weight) * 10000) / 10000;
        
        await product.save({ transaction: t, skipAdjustmentHook: true });

        // Log Stock Movement
        await models.StockMovement.create({
          id: `SM-SALE-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          companyId: req.companyId,
          productId: product.id,
          productCode: product.productCode,
          type: "sale",
          quantityIn: 0,
          quantityOut: qty,
          weightIn: 0,
          weightOut: vItem.weight,
          unitCost: vItem.cost,
          totalCost: vItem.cost * qty,
          referenceType: "Invoice",
          referenceId: invoiceId,
          customerId,
          branchId,
          createdBy: actor
        }, { transaction: t });

        // Create Invoice Item
        const invoiceItem = await models.InvoiceItem.create({
          invoiceId,
          assetId: product.id, // Store product.id inside assetId column
          name: product.productName,
          quantity: qty,
          price: vItem.price,
          cost: vItem.cost,
          weight: vItem.weight,
          karat: product.karat || null,
          discount: vItem.discount || 0,
          makingCharge: vItem.makingCharge || 0,
          stoneValue: vItem.stoneValue || 0
        }, { transaction: t });
        invoiceItems.push(invoiceItem.toJSON());
      } else {
        const asset = vItem.asset;
        // Create Invoice Item
        const invoiceItem = await models.InvoiceItem.create({
          invoiceId,
          assetId: asset.id,
          name: asset.name,
          quantity: 1,
          price: vItem.price,
          cost: vItem.cost,
          weight: vItem.weight,
          karat: asset.karat || null,
          discount: vItem.discount || 0,
          makingCharge: vItem.makingCharge || 0,
          stoneValue: vItem.stoneValue || 0
        }, { transaction: t });
        invoiceItems.push(invoiceItem.toJSON());

        // Update asset status to sold
        await asset.update({ status: "sold" }, { transaction: t });

        // Create Asset Event in timeline
        await models.AssetEvent.create({
          id: `ASE-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          assetId: asset.id,
          action: "SALE",
          date: nowStr.slice(0, 10),
          user: actor,
          branch: branchRecord.name,
          note: `تم البيع بموجب الفاتورة رقم ${invoiceId}`,
          sourceDocument: invoiceId,
          beforeState: "status:available",
          afterState: "status:sold"
        }, { transaction: t });
      }
    }

    // 10. Create Real Payment Records in `payments` table
    const paymentsCreated = [];
    if (paymentMethod === "split") {
      const splits = Array.isArray(body.paymentSplits) ? body.paymentSplits : [];
      for (const split of splits) {
        const payment = await models.Payment.create({
          id: `PAY-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          companyId: req.companyId,
          branchId,
          invoiceId,
          paymentMethod: split.method,
          amount: split.amount,
          reference: split.reference || "",
          date: body.date || nowStr.slice(0, 10),
          notes: `دفع مجزأ للفاتورة ${invoiceId}`
        }, { transaction: t });
        paymentsCreated.push(payment.toJSON());
      }
    } else if (paymentMethod === "installment") {
      const downPayment = Number(body.downPayment) || 0;
      if (downPayment > 0) {
        const payment = await models.Payment.create({
          id: `PAY-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          companyId: req.companyId,
          branchId,
          invoiceId,
          paymentMethod: "cash",
          amount: downPayment,
          reference: "",
          date: body.date || nowStr.slice(0, 10),
          notes: `دفعة أولى للفاتورة ${invoiceId}`
        }, { transaction: t });
        paymentsCreated.push(payment.toJSON());
      }
    } else {
      const payment = await models.Payment.create({
        id: `PAY-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        companyId: req.companyId,
        branchId,
        invoiceId,
        paymentMethod,
        amount: paidAmount,
        reference: body.reference || "",
        date: body.date || nowStr.slice(0, 10),
        notes: paymentMethod === "deposit" ? `عربون للفاتورة ${invoiceId}` : `سداد كامل للفاتورة ${invoiceId}`
      }, { transaction: t });
      paymentsCreated.push(payment.toJSON());
    }

    // 11. Create Installments in installments table
    const createdInstallmentRecords = [];
    if (installmentsToCreate.length > 0) {
      for (const inst of installmentsToCreate) {
        const installmentRecord = await models.Installment.create({
          id: `INST-${invoiceId}-${inst.sequence}`,
          companyId: req.companyId,
          invoiceId,
          customerId,
          customerName: customer.name,
          sequence: inst.sequence,
          dueDate: inst.dueDate,
          amount: inst.amount,
          paidAmount: 0,
          status: "pending",
          branch: branchRecord.name
        }, { transaction: t });
        createdInstallmentRecords.push(installmentRecord.toJSON());
      }
    }

    // 12. Create Cash Transactions & Post to Accounting Ledger
    const invPlain = invoice.toJSON();
    invPlain.downPayment = Number(body.downPayment) || 0;

    let journalEntry = null;
    try {
      if (invoice.type === "deposit") {
        journalEntry = await postingService.postDepositEntry(invPlain, actor, { transaction: t });
      } else {
        journalEntry = await postingService.postInvoiceEntry(invPlain, invoiceItems, actor, { transaction: t });
      }
    } catch (postErr) {
      logger.error(`[Posting] Failed to post journal entry: ${postErr.message}`);
      throw new Error(`خطأ في إنشاء القيد المحاسبي: ${postErr.message}`);
    }

    // Now record the treasury cash transactions
    for (const pay of paymentsCreated) {
      const methodLower = pay.paymentMethod.toLowerCase();
      const account = (methodLower.includes("card") || methodLower.includes("bank") || methodLower.includes("transfer") || methodLower.includes("شبكة") || methodLower.includes("تحويل")) ? "bank" : "cash";

      await models.CashTransaction.create({
        id: `TX-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        companyId: req.companyId,
        branchId,
        branch: branchRecord.name,
        type: "cash_in",
        account,
        amount: pay.amount,
        category: paymentMethod === "deposit" ? "عربون عميل" : "مبيعات مجوهرات",
        description: `مقبوضات فاتورة مبيعات رقم ${invoiceId} - طريقة الدفع: ${pay.paymentMethod}`,
        reference: invoiceId,
        date: body.date || nowStr.slice(0, 10),
        status: "posted",
        createdBy: req.user ? req.user.id : "System",
        journalEntryId: journalEntry ? journalEntry.id : null
      }, { transaction: t });
    }

    // 13. Award loyalty points + update the customer's outstanding balance.
    //     Both run INSIDE the sale transaction so they roll back with the sale
    //     (no orphan loyalty / balance drift if checkout fails).
    let loyalty = null;
    if (customerId) {
      loyalty = await awardLoyaltyForSale(req.companyId, customer, total, invoiceId, { transaction: t });
      // Credit/installment/deposit sales increase what the customer owes.
      if (remainingAmount > 0) {
        await customer.update(
          { balance: Math.round((Number(customer.balance || 0) + remainingAmount) * 100) / 100 },
          { transaction: t }
        );
      }
    }

    // 14. Record Audit Log — transaction MUST be the 3rd arg (opts), not in the
    // data object, so the audit row is part of `t` and rolls back if checkout fails.
    await auditService.record(req.companyId, {
      action: "pos.checkout",
      description: `تم إتمام عملية بيع فاتورة رقم ${invoiceId} بمبلغ ${total} بفرع ${branchRecord.name}`,
      user: actor,
      userId: req.user ? req.user.id : null,
      place: branchRecord.name,
      sourceDocument: "invoice",
      severity: "info",
      before: null,
      after: JSON.stringify({ invoiceId, total, paymentMethod })
    }, { transaction: t });

    // Recalculate customer net purchases
    const { recalculateCustomerNetPurchases } = require("../services/customer-purchases.service");
    await recalculateCustomerNetPurchases(models, req.companyId, customerId, { transaction: t });

    // Commit Transaction
    await t.commit();

    // 15. Create notification and emit events
    const notificationCurrency = settings.currency || "AED";
    emitEntityChanged(req.companyId, {
      entity: "Invoice",
      action: "create",
      id: invoiceId,
      branchId,
      related: {
        customerId: customer.id,
        assetIds: invoiceItems.map(i => i.assetId).filter(Boolean)
      }
    });
    await notificationService.createNotification(req.companyId, {
      title: "عملية بيع جديدة",
      message: `تم إنشاء الفاتورة ${invoiceId} للعميل ${customer.name} بقيمة ${total} ${notificationCurrency}.`,
      type: "success",
      entityType: "Invoice",
      entityId: invoiceId
    });

    const out = invoice.toJSON();
    out.journalEntry = journalEntry;
    out.installments = createdInstallmentRecords;
    out.payments = paymentsCreated;
    out.loyalty = loyalty;
    out.items = invoiceItems;

    return res.status(201).json({ success: true, ...out, data: out });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

// ─── Custom Sales Returns Endpoint ──────────────────────────────────────────
router.post("/sales/returns", authMiddleware, requirePermission("sales.create"), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const body = req.body || {};
    const { originalInvoiceId, returnedAssetIds = [], reason = "" } = body;

    if (req.headers["idempotency-key"] || body.idempotencyKey) {
      const idempotencyKey = req.headers["idempotency-key"] || body.idempotencyKey;
      const existing = await models.Invoice.findOne({
        where: { idempotencyKey, companyId: req.companyId },
        include: [{ model: models.InvoiceItem, as: "items" }],
        transaction: t
      });
      if (existing) {
        await t.rollback();
        return res.status(200).json({ success: true, ...existing.toJSON(), data: existing.toJSON() });
      }
    }

    if (!originalInvoiceId) {
      throw new ValidationError("رقم الفاتورة الأصلية مطلوب");
    }
    if (returnedAssetIds.length === 0) {
      throw new ValidationError("يجب اختيار عنصر واحد على الأقل للإرجاع");
    }

    // 1. Validate original invoice
    const originalInvoice = await models.Invoice.findOne({
      where: { id: originalInvoiceId, companyId: req.companyId },
      include: [{ model: models.InvoiceItem, as: "items" }],
      lock: true,
      transaction: t
    });
    if (!originalInvoice) {
      throw new ValidationError("لم يتم العثور على الفاتورة الأصلية");
    }
    if (originalInvoice.status === "returned") {
      throw new ValidationError("هذه الفاتورة تم إرجاعها بالكامل مسبقاً");
    }

    // 2. Validate returnable items and their state
    const assets = await models.Asset.findAll({
      where: { id: returnedAssetIds, companyId: req.companyId },
      lock: true,
      transaction: t
    });
    if (assets.length !== returnedAssetIds.length) {
      throw new ValidationError("بعض الأصول المحددة غير موجودة في النظام");
    }

    for (const asset of assets) {
      if (asset.status !== "sold") {
        throw new ValidationError(`المنتج ${asset.name} (${asset.id}) غير مباع حالياً، حالته: ${asset.status}`);
      }
      const hasItem = originalInvoice.items.some(i => i.assetId === asset.id);
      if (!hasItem) {
        throw new ValidationError(`المنتج ${asset.name} (${asset.id}) ليس جزءاً من الفاتورة الأصلية المحدد إرجاعها`);
      }
    }

    // 3. Extract branch and settings
    const branchId = req.headers["x-branch-id"] || req.body.branchId || originalInvoice.branchId;
    if (!branchId) {
      throw new ValidationError("الفرع النشط مطلوب لتسجيل المرتجع");
    }
    const branchRecord = await models.Branch.findOne({
      where: { id: branchId, companyId: req.companyId, isActive: true },
      transaction: t
    });
    if (!branchRecord) {
      throw new ValidationError("الفرع المحدد غير موجود أو غير نشط");
    }

    const settings = await settingsService.getCompanySettings(req.companyId, { transaction: t });
    const vatRatePercent = Number(originalInvoice.vatRate ?? settings.vatRate ?? 0);

    // 4. Calculate return totals
    const roundVal = (n) => Math.round((Number(n) || 0) * 100) / 100;
    let returnedSubtotal = 0;
    let returnedCost = 0;
    for (const asset of assets) {
      const item = originalInvoice.items.find(i => i.assetId === asset.id);
      returnedSubtotal += Number(item.price || 0);
      returnedCost += Number(item.cost || 0);
    }
    const returnedTax = roundVal(returnedSubtotal * (vatRatePercent / 100));
    const returnedTotal = roundVal(returnedSubtotal + returnedTax);

    // 5. Create credit note invoice ID
    const returnInvoiceId = `CN-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`;

    // 6. Create Return Invoice (Negative total representing credit note)
    const nowStr = new Date().toISOString().slice(0, 16).replace("T", " ");
    const returnInvoice = await models.Invoice.create({
      id: returnInvoiceId,
      companyId: req.companyId,
      branchId,
      branch: branchRecord.name,
      customerId: originalInvoice.customerId,
      customerName: originalInvoice.customerName,
      type: "return",
      date: nowStr.slice(0, 10),
      subtotal: -returnedSubtotal,
      tax: -returnedTax,
      vatRate: vatRatePercent,
      total: -returnedTotal,
      status: "returned",
      paymentMethod: originalInvoice.paymentMethod,
      relatedInvoiceId: originalInvoice.id,
      notes: reason || "مرتجع مبيعات",
      idempotencyKey: req.headers["idempotency-key"] || body.idempotencyKey || null,
      postingStatus: "posted", // immediate-post path (sales return)
      invoiceNumber: returnInvoiceId,
      postedAt: nowStr
    }, { transaction: t });

    // 7. Create Return Invoice Items and restore asset status
    const returnItems = [];
    for (const asset of assets) {
      const origItem = originalInvoice.items.find(i => i.assetId === asset.id);
      const returnItem = await models.InvoiceItem.create({
        invoiceId: returnInvoiceId,
        assetId: asset.id,
        name: asset.name,
        quantity: 1,
        price: -Number(origItem.price || 0),
        cost: Number(origItem.cost || 0),
        weight: Number(origItem.weight || 0),
        karat: origItem.karat,
        discount: -Number(origItem.discount || 0),
        makingCharge: -Number(origItem.makingCharge || 0),
        stoneValue: -Number(origItem.stoneValue || 0)
      }, { transaction: t });
      returnItems.push(returnItem);

      // Restore status to returned (not available blindly)
      await asset.update({ status: "returned" }, { transaction: t });

      // Create Asset Event
      await models.AssetEvent.create({
        id: `ASE-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        assetId: asset.id,
        action: "RETURNED",
        date: nowStr.slice(0, 10),
        user: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System",
        branch: branchRecord.name,
        note: `تم الإرجاع للفاتورة: ${originalInvoice.id}. السبب: ${reason || "غير محدد"}`,
        sourceDocument: originalInvoice.id,
        beforeState: "status:sold",
        afterState: "status:returned",
        severity: "info"
      }, { transaction: t });
    }

    // 8. Update original invoice status (fully returned or partial)
    const originalItemIds = originalInvoice.items.map(i => i.assetId);
    const otherReturns = await models.Invoice.findAll({
      where: postedInvoiceWhere({ relatedInvoiceId: originalInvoice.id, type: "return", companyId: req.companyId }),
      include: [{ model: models.InvoiceItem, as: "items" }],
      transaction: t
    });

    const previouslyReturnedAssetIds = new Set();
    for (const ret of otherReturns) {
      for (const item of ret.items) {
        previouslyReturnedAssetIds.add(item.assetId);
      }
    }
    for (const id of returnedAssetIds) {
      previouslyReturnedAssetIds.add(id);
    }

    const allItemsReturned = originalItemIds.every(id => previouslyReturnedAssetIds.has(id));
    await originalInvoice.update({
      status: allItemsReturned ? "returned" : "partial"
    }, { transaction: t });

    // 9. Post GL Journal Entry (posting service expects positive absolute figures)
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    let journalEntry = null;
    try {
      const returnInvoiceForPosting = {
        ...returnInvoice.toJSON(),
        total: returnedTotal,
        tax: returnedTax,
        subtotal: returnedSubtotal
      };
      journalEntry = await postingService.postReturnEntry(returnInvoiceForPosting, returnItems, actor, { transaction: t });
    } catch (postErr) {
      logger.error(`[Posting] Failed to post return journal entry: ${postErr.message}`);
      throw new Error(`خطأ في إنشاء القيد المحاسبي للمرتجع: ${postErr.message}`);
    }

    // 10. Record Treasury Cash Transaction (Cash Outward)
    const methodLower = originalInvoice.paymentMethod.toLowerCase();
    const account = (methodLower.includes("card") || methodLower.includes("bank") || methodLower.includes("transfer") || methodLower.includes("شبكة") || methodLower.includes("تحويل")) ? "bank" : "cash";

    await models.CashTransaction.create({
      id: `TX-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      companyId: req.companyId,
      branchId,
      branch: branchRecord.name,
      type: "cash_out",
      account,
      amount: returnedTotal,
      category: "مرتجع مبيعات",
      description: `مرتجع مبيعات للفاتورة رقم ${originalInvoice.id} - مستند دائن ${returnInvoiceId}`,
      reference: returnInvoiceId,
      date: nowStr.slice(0, 10),
      status: "posted",
      createdBy: req.user ? req.user.id : "System",
      journalEntryId: journalEntry ? journalEntry.id : null
    }, { transaction: t });

    // 11. Adjust Customer Outstanding Balance if needed (unpaid installment/due invoice)
    const customer = await models.Customer.findOne({
      where: { id: originalInvoice.customerId, companyId: req.companyId },
      transaction: t
    });
    if (customer && Number(originalInvoice.remainingAmount || 0) > 0) {
      const deduction = Math.min(Number(originalInvoice.remainingAmount), returnedTotal);
      await customer.update({
        balance: Math.max(0, roundVal(Number(customer.balance || 0) - deduction))
      }, { transaction: t });
      await originalInvoice.update({
        remainingAmount: roundVal(Number(originalInvoice.remainingAmount) - deduction)
      }, { transaction: t });
    }

    // 12. Write Audit Log
    await auditService.record(req.companyId, {
      action: "sales.return",
      description: `تم تسجيل مرتجع للفاتورة رقم ${originalInvoice.id} بمبلغ ${returnedTotal} - سند دائن رقم ${returnInvoiceId}`,
      user: actor,
      userId: req.user ? req.user.id : null,
      place: branchRecord.name,
      sourceDocument: "invoice",
      severity: "info",
      after: JSON.stringify({ returnInvoiceId, originalInvoiceId, returnedTotal })
    }, { transaction: t });

    // Recalculate customer net purchases
    const { recalculateCustomerNetPurchases } = require("../services/customer-purchases.service");
    await recalculateCustomerNetPurchases(models, req.companyId, originalInvoice.customerId, { transaction: t });

    // Commit Transaction
    await t.commit();

    // 13. Emit Notifications & SSE Events
    const notificationCurrency = settings.currency || "AED";
    await notificationService.createNotification(req.companyId, {
      title: "عملية مرتجع مبيعات جديدة",
      message: `تم تسجيل مرتجع للفاتورة ${originalInvoice.id} بقيمة ${returnedTotal} ${notificationCurrency}.`,
      type: "warning",
      entityType: "Invoice",
      entityId: returnInvoiceId
    });
    emitEntityChanged(req.companyId, {
      entity: "Invoice",
      action: "cancel",
      id: returnInvoiceId,
      branchId,
      related: {
        invoiceId: originalInvoiceId,
        customerId: originalInvoice.customerId,
        assetIds: returnedAssetIds
      }
    });

    const responseData = returnInvoice.toJSON();
    responseData.items = returnItems;
    responseData.journalEntry = journalEntry;

    return res.status(201).json({ success: true, ...responseData, data: responseData });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

// ─── Custom Sales Exchanges Endpoint ─────────────────────────────────────────
router.post("/sales/exchanges", authMiddleware, requirePermission("sales.create"), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const body = req.body || {};
    const { originalInvoiceId, returnedAssetId, newAssetIds = [], paymentMethod = "Exchange", notes = "" } = body;

    if (req.headers["idempotency-key"] || body.idempotencyKey) {
      const idempotencyKey = req.headers["idempotency-key"] || body.idempotencyKey;
      const existing = await models.Invoice.findOne({
        where: { idempotencyKey, companyId: req.companyId },
        include: [{ model: models.InvoiceItem, as: "items" }],
        transaction: t
      });
      if (existing) {
        await t.rollback();
        return res.status(200).json({ success: true, ...existing.toJSON(), data: existing.toJSON() });
      }
    }

    if (!originalInvoiceId) {
      throw new ValidationError("رقم الفاتورة الأصلية مطلوب");
    }
    if (!returnedAssetId) {
      throw new ValidationError("رقم القطعة المرتجعة مطلوب للاستبدال");
    }
    if (newAssetIds.length === 0) {
      throw new ValidationError("يجب اختيار قطعة واحدة جديدة على الأقل للشراء");
    }

    // 1. Validate original invoice
    const originalInvoice = await models.Invoice.findOne({
      where: { id: originalInvoiceId, companyId: req.companyId },
      include: [{ model: models.InvoiceItem, as: "items" }],
      lock: true,
      transaction: t
    });
    if (!originalInvoice) {
      throw new ValidationError("لم يتم العثور على الفاتورة الأصلية");
    }

    // 2. Validate returned asset
    const returnedAsset = await models.Asset.findOne({
      where: { id: returnedAssetId, companyId: req.companyId },
      lock: true,
      transaction: t
    });
    if (!returnedAsset) {
      throw new ValidationError("الأصل المراد إرجاعه غير موجود");
    }
    if (returnedAsset.status !== "sold") {
      throw new ValidationError(`الأصل المراد إرجاعه غير مباع حالياً، حالته: ${returnedAsset.status}`);
    }
    const originalItem = originalInvoice.items.find(i => i.assetId === returnedAssetId);
    if (!originalItem) {
      throw new ValidationError("الأصل المرتجع ليس جزءاً من الفاتورة الأصلية المحددة");
    }

    // 4. Extract active branch & settings (extracted early for validation)
    const branchId = req.headers["x-branch-id"] || req.body.branchId || originalInvoice.branchId;
    if (!branchId) {
      throw new ValidationError("الفرع النشط مطلوب لتسجيل الاستبدال");
    }
    const branchRecord = await models.Branch.findOne({
      where: { id: branchId, companyId: req.companyId, isActive: true },
      transaction: t
    });
    if (!branchRecord) {
      throw new ValidationError("الفرع المحدد غير موجود أو غير نشط");
    }

    // 3. Validate new assets (checking branch scoping too)
    const newAssets = await models.Asset.findAll({
      where: { id: newAssetIds, companyId: req.companyId },
      lock: true,
      transaction: t
    });
    if (newAssets.length !== newAssetIds.length) {
      throw new ValidationError("بعض الأصول البديلة الجديدة غير موجودة في النظام");
    }
    for (const asset of newAssets) {
      if (asset.status !== "available") {
        throw new ValidationError(`المنتج البديل ${asset.name} (${asset.id}) غير متاح للبيع حالياً، حالته: ${asset.status}`);
      }
      if (asset.branchId !== branchId) {
        throw new ValidationError(`المنتج البديل ${asset.name} (${asset.id}) تابع لفرع آخر وليس للفرع النشط`);
      }
    }

    const settings = await settingsService.getCompanySettings(req.companyId, { transaction: t });
    const vatRatePercent = Number(settings.vatRate ?? 0);

    // 5. Calculate values and differences
    const roundVal = (n) => Math.round((Number(n) || 0) * 100) / 100;
    const returnedValue = Number(originalItem.price || 0);
    const returnedCost = Number(originalItem.cost || 0);

    const newAssetsValue = newAssets.reduce((sum, a) => sum + Number(a.price || 0), 0);
    const newAssetsCost = newAssets.reduce((sum, a) => sum + Number(a.cost || 0), 0);

    const diffBase = roundVal(newAssetsValue - returnedValue);
    const diffTax = roundVal(diffBase * (vatRatePercent / 100));
    const diffTotal = roundVal(diffBase + diffTax);

    // 6. Generate Exchange Invoice ID
    const exchangeInvoiceId = `EX-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`;

    // 7. Create Exchange Invoice record
    const nowStr = new Date().toISOString().slice(0, 16).replace("T", " ");
    const exchangeInvoice = await models.Invoice.create({
      id: exchangeInvoiceId,
      companyId: req.companyId,
      branchId,
      branch: branchRecord.name,
      customerId: originalInvoice.customerId,
      customerName: originalInvoice.customerName,
      type: "exchange",
      date: nowStr.slice(0, 10),
      subtotal: diffBase,
      tax: diffTax,
      vatRate: vatRatePercent,
      total: diffTotal,
      status: "paid",
      paymentMethod: diffTotal > 0 ? paymentMethod : "Exchange",
      relatedInvoiceId: originalInvoice.id,
      notes: notes || "استبدال أصول بموجب الفاتورة",
      idempotencyKey: req.headers["idempotency-key"] || body.idempotencyKey || null,
      postingStatus: "posted", // immediate-post path (exchange)
      invoiceNumber: exchangeInvoiceId,
      postedAt: nowStr
    }, { transaction: t });

    // 8. Create exchange invoice item lines
    // Negative return line
    const returnItem = await models.InvoiceItem.create({
      invoiceId: exchangeInvoiceId,
      assetId: returnedAssetId,
      name: `مرتجع استبدال: ${returnedAsset.name}`,
      quantity: 1,
      price: -returnedValue,
      cost: returnedCost,
      weight: Number(originalItem.weight || 0),
      karat: originalItem.karat,
      discount: 0,
      makingCharge: 0,
      stoneValue: 0
    }, { transaction: t });

    // Positive new asset lines
    const exchangeItems = [returnItem];
    for (const asset of newAssets) {
      const item = await models.InvoiceItem.create({
        invoiceId: exchangeInvoiceId,
        assetId: asset.id,
        name: asset.name,
        quantity: 1,
        price: Number(asset.price || 0),
        cost: Number(asset.cost || 0),
        weight: Number(asset.grossWeight || asset.weight || 0),
        karat: asset.karat,
        discount: 0,
        makingCharge: Number(asset.makingCharge || 0),
        stoneValue: Number(asset.stoneValue || 0)
      }, { transaction: t });
      exchangeItems.push(item);
    }

    // 9. Update asset statuses
    await returnedAsset.update({ status: "returned" }, { transaction: t });
    for (const asset of newAssets) {
      await asset.update({ status: "sold" }, { transaction: t });
    }

    // 10. Record Asset Events
    await models.AssetEvent.create({
      id: `ASE-${Date.now()}-EX-OUT`,
      assetId: returnedAsset.id,
      action: "EXCHANGED_OUT",
      date: nowStr.slice(0, 10),
      user: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System",
      branch: branchRecord.name,
      note: `تم إرجاعه بالاستبدال للفاتورة: ${originalInvoice.id} بموجب سند الاستبدال ${exchangeInvoiceId}`,
      sourceDocument: originalInvoice.id,
      beforeState: "status:sold",
      afterState: "status:returned",
      severity: "info"
    }, { transaction: t });

    for (const asset of newAssets) {
      await models.AssetEvent.create({
        id: `ASE-${Date.now()}-EX-IN-${asset.id}`,
        assetId: asset.id,
        action: "EXCHANGED_IN",
        date: nowStr.slice(0, 10),
        user: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System",
        branch: branchRecord.name,
        note: `تم شراؤه بالاستبدال بموجب سند الاستبدال ${exchangeInvoiceId}`,
        sourceDocument: exchangeInvoiceId,
        beforeState: "status:available",
        afterState: "status:sold",
        severity: "info"
      }, { transaction: t });
    }

    // 11. Create balanced Accounting Entry
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    const payAcc = paymentMethod.toLowerCase();
    const isBank = payAcc.includes("card") || payAcc.includes("bank") || payAcc.includes("transfer") || payAcc.includes("شبكة") || payAcc.includes("تحويل");
    const accountCode = isBank ? "1120" : "1110";

    const lines = [];
    if (diffTotal > 0) {
      lines.push({ accountCode, debit: diffTotal, credit: 0, description: "دفع فارق استبدال" });
    } else if (diffTotal < 0) {
      lines.push({ accountCode, debit: 0, credit: Math.abs(diffTotal), description: "إرجاع فارق استبدال" });
    }

    if (returnedValue > 0) {
      lines.push({ accountCode: "4100", debit: returnedValue, credit: 0, description: "عكس إيراد مبيعات أصل قديم" });
    }
    if (newAssetsValue > 0) {
      lines.push({ accountCode: "4100", debit: 0, credit: newAssetsValue, description: "إيراد بيع أصل بديل" });
    }

    if (diffTax > 0) {
      lines.push({ accountCode: "2200", debit: 0, credit: diffTax, description: "ضريبة فارق استبدال" });
    } else if (diffTax < 0) {
      lines.push({ accountCode: "2200", debit: Math.abs(diffTax), credit: 0, description: "عكس ضريبة أصل قديم" });
    }

    if (newAssetsCost > 0) {
      lines.push({ accountCode: "5000", debit: newAssetsCost, credit: 0, description: "تكلفة مبيعات بديلة" });
      lines.push({ accountCode: "1200", debit: 0, credit: newAssetsCost, description: "تخفيض مخزون بديل" });
    }
    if (returnedCost > 0) {
      lines.push({ accountCode: "1200", debit: returnedCost, credit: 0, description: "إرجاع أصل قديم للمخزن" });
      lines.push({ accountCode: "5000", debit: 0, credit: returnedCost, description: "عكس تكلفة أصل قديم" });
    }

    let journalEntry = null;
    try {
      journalEntry = await postingService.postEntry(req.companyId, {
        description: `قيد استبدال أصول — فاتورة ${exchangeInvoiceId}`,
        date: nowStr.slice(0, 10),
        sourceType: "exchange",
        sourceId: exchangeInvoiceId,
        postedBy: actor,
        transaction: t,
        branchId
      }, lines);
    } catch (postErr) {
      logger.error(`[Posting] Failed to post exchange journal entry: ${postErr.message}`);
      throw new Error(`خطأ في إنشاء القيد المحاسبي للاستبدال: ${postErr.message}`);
    }

    // 12. Record Treasury Cash Transaction if cash/bank changed
    if (diffTotal !== 0) {
      await models.CashTransaction.create({
        id: `TX-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        companyId: req.companyId,
        branchId,
        branch: branchRecord.name,
        type: diffTotal > 0 ? "cash_in" : "cash_out",
        account: isBank ? "bank" : "cash",
        amount: Math.abs(diffTotal),
        category: "استبدال أصول",
        description: `فارق استبدال أصول - فاتورة استبدال رقم ${exchangeInvoiceId}`,
        reference: exchangeInvoiceId,
        date: nowStr.slice(0, 10),
        status: "posted",
        createdBy: req.user ? req.user.id : "System",
        journalEntryId: journalEntry ? journalEntry.id : null
      }, { transaction: t });
    }

    // 13. Adjust Customer Outstanding Balance if credit payment method is chosen
    const customer = await models.Customer.findOne({
      where: { id: originalInvoice.customerId, companyId: req.companyId },
      transaction: t
    });
    if (customer && paymentMethod === "credit") {
      await customer.update({
        balance: roundVal(Number(customer.balance || 0) + diffTotal)
      }, { transaction: t });
    }

    // 14. Write Audit Log
    await auditService.record(req.companyId, {
      action: "sales.exchange",
      description: `تم إتمام عملية استبدال للفاتورة رقم ${originalInvoice.id}. فارق الاستبدال: ${diffTotal} - فاتورة جديدة ${exchangeInvoiceId}`,
      user: actor,
      userId: req.user ? req.user.id : null,
      place: branchRecord.name,
      sourceDocument: "invoice",
      severity: "info",
      after: JSON.stringify({ exchangeInvoiceId, originalInvoiceId, diffTotal })
    }, { transaction: t });

    // Recalculate customer net purchases
    const { recalculateCustomerNetPurchases } = require("../services/customer-purchases.service");
    await recalculateCustomerNetPurchases(models, req.companyId, originalInvoice.customerId, { transaction: t });

    // Commit Transaction
    await t.commit();

    // 15. Create Notifications & SSE
    await notificationService.createNotification(req.companyId, {
      title: "عملية استبدال أصول",
      message: `تم استبدال قطع للفاتورة ${originalInvoice.id} بفارق بقيمة ${diffTotal} ${settings.currency || "AED"}.`,
      type: "info",
      entityType: "Invoice",
      entityId: exchangeInvoiceId
    });
    emitEntityChanged(req.companyId, {
      entity: "Invoice",
      action: "cancel",
      id: exchangeInvoiceId,
      branchId,
      related: {
        invoiceId: originalInvoiceId,
        customerId: originalInvoice.customerId,
        assetIds: [returnedAssetId, ...newAssetIds].filter(Boolean)
      }
    });

    const responseData = exchangeInvoice.toJSON();
    responseData.items = exchangeItems;
    responseData.journalEntry = journalEntry;

    return res.status(201).json({ success: true, ...responseData, data: responseData });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

// ─── Customer Gold Deposit Endpoint ──────────────────────────────────────────
router.post("/customers/:id/gold/deposit", authMiddleware, async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const customerId = req.params.id;
    const { description = "", karat = 21, weight, ratePerGram, payout = false, payMethod = "cash" } = req.body || {};

    const weightNum = Number(weight) || 0;
    const rateNum = Number(ratePerGram) || 0;
    const roundVal = (n) => Math.round((Number(n) || 0) * 100) / 100;
    const calculatedValue = roundVal(weightNum * rateNum);

    if (weightNum <= 0 || rateNum <= 0) {
      throw new ValidationError("الوزن وسعر الغرام يجب أن يكونا أكبر من الصفر");
    }

    const customer = await models.Customer.findOne({
      where: { id: customerId, companyId: req.companyId },
      transaction: t
    });
    if (!customer) {
      throw new NotFoundError("العميل غير موجود");
    }

    const settings = await settingsService.getCompanySettings(req.companyId, { transaction: t });

    const branchId = req.headers["x-branch-id"] || req.body.branchId;
    if (!branchId) {
      throw new ValidationError("الفرع النشط مطلوب");
    }
    const branchRecord = await models.Branch.findOne({
      where: { id: branchId, companyId: req.companyId, isActive: true },
      transaction: t
    });
    if (!branchRecord) {
      throw new ValidationError("الفرع المحدد غير موجود أو غير نشط");
    }

    const nowStr = new Date().toISOString().slice(0, 16).replace("T", " ");
    const timestamp = Date.now();
    const cgpId = `CGP-${timestamp.toString().slice(-6)}`;

    // 1. Create CustomerGoldPool entry
    const purity = getPurityFromKarat(karat) || 0.875;
    const cgp = await models.CustomerGoldPool.create({
      id: cgpId,
      companyId: req.companyId,
      customerId,
      customerName: customer.name,
      status: "approved",
      grossWeight: weightNum,
      purity,
      fineWeight: roundVal(weightNum * purity),
      notes: description,
      receivedAt: nowStr.slice(0, 16),
      approvedAt: nowStr.slice(0, 16),
      approvedBy: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System"
    }, { transaction: t });

    // 2. Create scrap gold asset in inventory
    const assetId = `AST-SCRAP-${timestamp.toString().slice(-6)}`;
    const scrapAsset = await models.Asset.create({
      id: assetId,
      companyId: req.companyId,
      name: `ذهب كسر عميل - ${description}`,
      type: "gold-weight",
      category: "ذهب مستعمل كسر",
      karat: Number(karat),
      purity,
      grossWeight: weightNum,
      netWeight: weightNum,
      cost: calculatedValue,
      price: calculatedValue,
      branch: branchRecord.name,
      branchId,
      location: "Melt Room",
      status: "available",
      barcode: String(timestamp).slice(-13).padStart(13, "6"),
      source: `شراء مستعمل من العميل ${customer.name}`
    }, { transaction: t });

    // 3. Asset event
    await models.AssetEvent.create({
      id: `ASE-${timestamp}-${Math.random().toString(36).slice(2, 6)}`,
      assetId,
      action: "SCRAP_PURCHASED",
      date: nowStr.slice(0, 10),
      user: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System",
      branch: branchRecord.name,
      note: `شراء ذهب مستعمل بمعدل سعر ${rateNum} /g بموجب المستند ${cgpId}`
    }, { transaction: t });

    // 4. Deposit Journal Entry: Dr Inventory (1200) / Cr Customer Deposits (2300)
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    const depositJournal = await postingService.postEntry(req.companyId, {
      description: `إيداع ذهب كسر عميل — ${customer.name} (أصل ${assetId})`,
      date: nowStr.slice(0, 10),
      sourceType: "customer_gold_pool",
      sourceId: cgpId,
      postedBy: actor,
      transaction: t,
      branchId
    }, [
      { accountCode: "1200", debit: calculatedValue, credit: 0, description: "استلام ذهب كسر عميل" },
      { accountCode: "2300", debit: 0, credit: calculatedValue, description: "رصيد أمانات ذهب عملاء" }
    ]);

    // 5. Generate payout receipt if payout requested (immediate scrap gold purchase/cashout)
    let payoutInvoice = null;
    let payoutJournal = null;
    if (payout) {
      const payoutId = `PAY-${10000 + Math.floor(Math.random() * 9000)}`;
      payoutInvoice = await models.Invoice.create({
        id: payoutId,
        companyId: req.companyId,
        branchId,
        branch: branchRecord.name,
        customerId,
        customerName: customer.name,
        type: "return", // negative total acts as payout
        date: nowStr.slice(0, 10),
        subtotal: -calculatedValue,
        tax: 0,
        vatRate: 0,
        total: -calculatedValue,
        status: "paid",
        paymentMethod: payMethod.toUpperCase(),
        notes: `صرف قيمة ذهب مستعمل - ${description}`,
        postingStatus: "posted", // immediate-post path (customer gold settlement)
        invoiceNumber: payoutId,
        postedAt: nowStr
      }, { transaction: t });

      await models.InvoiceItem.create({
        invoiceId: payoutId,
        assetId: scrapAsset.id,
        name: scrapAsset.name,
        quantity: 1,
        price: -calculatedValue,
        cost: calculatedValue,
        weight: weightNum,
        karat: Number(karat)
      }, { transaction: t });

      // Payout Journal: Dr Customer Deposits (2300) / Cr Cash/Bank (1110/1120)
      const payMethodLower = payMethod.toLowerCase();
      const cashAccountCode = (payMethodLower.includes("bank") || payMethodLower.includes("transfer")) ? "1120" : "1110";

      payoutJournal = await postingService.postEntry(req.companyId, {
        description: `صرف نقدي مقابل ذهب مستعمل — ${customer.name} (${payoutId})`,
        date: nowStr.slice(0, 10),
        sourceType: "invoice",
        sourceId: payoutId,
        postedBy: actor,
        transaction: t,
        branchId
      }, [
        { accountCode: "2300", debit: calculatedValue, credit: 0, description: "تسوية التزام ذهب عميل" },
        { accountCode: cashAccountCode, debit: 0, credit: calculatedValue, description: "صرف نقدي للعميل" }
      ]);

      // Create Treasury Cash Transaction
      await models.CashTransaction.create({
        id: `TX-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        companyId: req.companyId,
        branchId,
        branch: branchRecord.name,
        type: "cash_out",
        account: cashAccountCode === "1120" ? "bank" : "cash",
        amount: calculatedValue,
        category: "شراء ذهب مستعمل",
        description: `صرف نقدي مقابل شراء ذهب مستعمل رقم ${payoutId}`,
        reference: payoutId,
        date: nowStr.slice(0, 10),
        status: "posted",
        createdBy: req.user ? req.user.id : "System",
        journalEntryId: payoutJournal ? payoutJournal.id : null
      }, { transaction: t });
    }

    // 6. Write Audit Log
    await auditService.record(req.companyId, {
      action: "customers.gold.deposit",
      description: `تم إيداع ذهب كسر للعميل ${customer.name} بوزن ${weightNum} جم وقيمة ${calculatedValue}`,
      user: actor,
      userId: req.user ? req.user.id : null,
      place: branchRecord.name,
      sourceDocument: "customer_gold_pool",
      severity: "info",
      after: JSON.stringify({ cgpId, assetId, calculatedValue })
    }, { transaction: t });

    // Commit Transaction
    await t.commit();

    // 7. Notification & SSE
    await notificationService.createNotification(req.companyId, {
      title: "إيداع ذهب كسر عميل",
      message: `تم تسجيل إيداع ذهب كسر للعميل ${customer.name} بوزن ${weightNum} جم بقيمة ${calculatedValue} ${settings.currency || "AED"}.`,
      type: "success",
      entityType: "CustomerGoldPool",
      entityId: cgpId
    });
    emitEntityChanged(req.companyId, {
      entity: "Invoice",
      action: "create",
      id: payoutInvoice ? payoutInvoice.id : cgpId,
      branchId,
      related: {
        customerId: customer.id,
        assetIds: scrapAsset ? [scrapAsset.id] : []
      }
    });

    return res.status(201).json({
      success: true,
      cgp,
      scrapAsset,
      payoutInvoice,
      depositJournal,
      payoutJournal
    });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

// ─── Customer Gold Payout Endpoint ───────────────────────────────────────────
router.post("/customers/:id/gold/payout", authMiddleware, async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const customerId = req.params.id;
    const { weight, ratePerGram, payMethod = "cash" } = req.body || {};

    const weightNum = Number(weight) || 0;
    const rateNum = Number(ratePerGram) || 0;
    const roundVal = (n) => Math.round((Number(n) || 0) * 100) / 100;
    const calculatedValue = roundVal(weightNum * rateNum);

    if (weightNum <= 0) {
      throw new ValidationError("الوزن المطلوب صرفه غير صحيح");
    }

    const customer = await models.Customer.findOne({
      where: { id: customerId, companyId: req.companyId },
      transaction: t
    });
    if (!customer) {
      throw new NotFoundError("العميل غير موجود");
    }

    // Verify customer has enough gold balance
    const activePools = await models.CustomerGoldPool.findAll({
      where: { customerId, companyId: req.companyId, status: "approved" },
      transaction: t
    });
    const totalGoldBalance = activePools.reduce((sum, p) => sum + Number(p.grossWeight || 0), 0);
    if (weightNum > totalGoldBalance) {
      throw new ValidationError(`الوزن المطلوب صرفه (${weightNum} جم) يتجاوز رصيد العميل المتوفر (${totalGoldBalance} جم)`);
    }

    // Deduct from pool
    const nowStr = new Date().toISOString().slice(0, 16).replace("T", " ");
    const timestamp = Date.now();
    const cgpId = `CGP-OUT-${timestamp.toString().slice(-6)}`;

    const cgp = await models.CustomerGoldPool.create({
      id: cgpId,
      companyId: req.companyId,
      customerId,
      customerName: customer.name,
      status: "approved",
      grossWeight: -weightNum,
      purity: 1.0,
      fineWeight: -weightNum,
      notes: "صرف رصيد ذهب عميل",
      receivedAt: nowStr.slice(0, 16),
      approvedAt: nowStr.slice(0, 16),
      approvedBy: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System"
    }, { transaction: t });

    // Dr Customer Deposits (2300) / Cr Cash/Bank (1110/1120)
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    const payMethodLower = payMethod.toLowerCase();
    const cashAccountCode = (payMethodLower.includes("bank") || payMethodLower.includes("transfer")) ? "1120" : "1110";

    const journalEntry = await postingService.postEntry(req.companyId, {
      description: `صرف رصيد ذهب عميل — ${customer.name} (سند ${cgpId})`,
      date: nowStr.slice(0, 10),
      sourceType: "customer_gold_pool",
      sourceId: cgpId,
      postedBy: actor,
      transaction: t
    }, [
      { accountCode: "2300", debit: calculatedValue, credit: 0, description: "سحب أمانات عملاء" },
      { accountCode: cashAccountCode, debit: 0, credit: calculatedValue, description: "صرف نقدي للعميل" }
    ]);

    await t.commit();

    return res.status(200).json({ success: true, cgp, journalEntry });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

// ─── Customer Gold Use in Sale Endpoint ──────────────────────────────────────
router.post("/customers/:id/gold/use-in-sale", authMiddleware, async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const customerId = req.params.id;
    const { invoiceId, weightUsed, ratePerGram } = req.body || {};

    const weightNum = Number(weightUsed) || 0;
    const rateNum = Number(ratePerGram) || 0;
    const roundVal = (n) => Math.round((Number(n) || 0) * 100) / 100;
    const calculatedValue = roundVal(weightNum * rateNum);

    if (weightNum <= 0 || rateNum <= 0) {
      throw new ValidationError("الوزن وسعر الغرام يجب أن يكونا أكبر من الصفر");
    }

    const customer = await models.Customer.findOne({
      where: { id: customerId, companyId: req.companyId },
      transaction: t
    });
    if (!customer) {
      throw new NotFoundError("العميل غير موجود");
    }

    const invoice = await models.Invoice.findOne({
      where: { id: invoiceId, companyId: req.companyId },
      transaction: t
    });
    if (!invoice) {
      throw new NotFoundError("الفاتورة غير موجودة");
    }

    if (Number(invoice.remainingAmount || 0) <= 0.01) {
      throw new ValidationError("الفاتورة مدفوعة بالكامل بالفعل");
    }

    // Verify customer has enough gold balance
    const activePools = await models.CustomerGoldPool.findAll({
      where: { customerId, companyId: req.companyId, status: "approved" },
      transaction: t
    });
    const totalGoldBalance = activePools.reduce((sum, p) => sum + Number(p.grossWeight || 0), 0);
    if (weightNum > totalGoldBalance) {
      throw new ValidationError(`الوزن المطلوب استخدامه (${weightNum} جم) يتجاوز رصيد العميل المتوفر (${totalGoldBalance} جم)`);
    }

    const remainingToPay = Number(invoice.remainingAmount) || 0;
    if (calculatedValue > remainingToPay + 0.01) {
      throw new ValidationError(`القيمة المحتسبة للذهب (${calculatedValue}) تتجاوز المبلغ المتبقي في الفاتورة (${remainingToPay})`);
    }

    // Update invoice state
    const newPaidAmount = roundVal(Number(invoice.paidAmount || 0) + calculatedValue);
    const newRemainingAmount = roundVal(Math.max(0, Number(invoice.remainingAmount || 0) - calculatedValue));
    const newStatus = newRemainingAmount <= 0.01 ? "paid" : "partial";

    await invoice.update({
      paidAmount: newPaidAmount,
      remainingAmount: newRemainingAmount,
      status: newStatus
    }, { transaction: t });

    // Decrement customer outstanding receivable balance
    await customer.update({
      balance: roundVal(Math.max(0, Number(customer.balance || 0) - calculatedValue))
    }, { transaction: t });

    const cgpId = `CGP-USE-${Date.now().toString().slice(-6)}`;
    const cgp = await models.CustomerGoldPool.create({
      id: cgpId,
      companyId: req.companyId,
      customerId,
      customerName: invoice.customerName,
      status: "approved",
      grossWeight: -weightNum,
      purity: 1.0,
      fineWeight: -weightNum,
      notes: `استخدام رصيد الذهب لتسوية الفاتورة رقم ${invoiceId}`,
      receivedAt: new Date().toISOString().slice(0, 16),
      approvedAt: new Date().toISOString().slice(0, 16),
      approvedBy: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System"
    }, { transaction: t });

    // Dr Customer Deposits (2300) / Cr Accounts Receivable (1300)
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    const journalEntry = await postingService.postEntry(req.companyId, {
      description: `استخدام رصيد ذهب عميل للفاتورة ${invoiceId}`,
      date: new Date().toISOString().slice(0, 10),
      sourceType: "customer_gold_pool",
      sourceId: cgpId,
      postedBy: actor,
      transaction: t
    }, [
      { accountCode: "2300", debit: calculatedValue, credit: 0, description: "تخفيض التزام ذهب عميل" },
      { accountCode: "1300", debit: 0, credit: calculatedValue, description: "تسوية ذمم فاتورة العميل" }
    ]);

    // Record Audit Log
    await auditService.record(req.companyId, {
      action: "customers.gold.use-in-sale",
      description: `تم استخدام رصيد ذهب للعميل ${customer.name} بوزن ${weightNum} جم بقيمة ${calculatedValue} لتسوية الفاتورة ${invoiceId}`,
      user: actor,
      userId: req.user ? req.user.id : null,
      place: invoice.branch || "Showroom",
      sourceDocument: "customer_gold_pool",
      severity: "info",
      after: JSON.stringify({ cgpId, invoiceId, calculatedValue })
    }, { transaction: t });

    await t.commit();

    const settings = await settingsService.getCompanySettings(req.companyId);

    // Create Notification
    await notificationService.createNotification(req.companyId, {
      title: "استخدام رصيد ذهب",
      message: `تم استخدام رصيد ذهب للعميل ${customer.name} بوزن ${weightNum} جم بقيمة ${calculatedValue} ${settings.currency || "AED"} لتسوية الفاتورة ${invoiceId}.`,
      type: "success",
      entityType: "CustomerGoldPool",
      entityId: cgpId
    });

    emitEntityChanged(req.companyId, {
      entity: "Invoice",
      action: "update",
      id: invoiceId,
      related: {
        customerId: customer.id
      }
    });

    return res.status(200).json({ success: true, cgp, journalEntry });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

// ─── Custom Manufacturing Process Endpoint ──────────────────────────────────
router.post("/manufacturing-orders/process", authMiddleware, requirePermission("inventory.adjust"), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const {
      inputAssetId,
      inputWeight,
      outputName,
      outputType = "gold-piece",
      outputKarat = "21",
      outputWeight,
      laborCost = 0,
      notes = ""
    } = req.body || {};

    const inW = Number(inputWeight) || 0;
    const outW = Number(outputWeight) || 0;
    const labor = Number(laborCost) || 0;

    if (!inputAssetId) {
      throw new ValidationError("أصل الذهب الخام مدخل مطلوب");
    }
    if (inW <= 0 || outW <= 0) {
      throw new ValidationError("الوزن المدخل والوزن الناتج يجب أن يكونا أكبر من الصفر");
    }

    // 1. Validate raw asset input
    const parentAsset = await models.Asset.findOne({
      where: { id: inputAssetId, companyId: req.companyId },
      lock: true,
      transaction: t
    });
    if (!parentAsset) {
      throw new ValidationError("لم يتم العثور على أصل الذهب الخام المدخل");
    }
    if (parentAsset.status !== "available") {
      throw new ValidationError(`أصل الذهب الخام غير متاح حالياً، حالته: ${parentAsset.status}`);
    }
    if (inW > Number(parentAsset.grossWeight)) {
      throw new ValidationError(`الوزن المطلوب تصنيعه (${inW} جم) أكبر من الوزن المتوفر في الأصل (${parentAsset.grossWeight} جم)`);
    }

    // 2. Validate branch scoping
    const branchId = req.headers["x-branch-id"] || req.body.branchId || parentAsset.branchId;
    if (!branchId) {
      throw new ValidationError("الفرع النشط مطلوب");
    }
    const branchRecord = await models.Branch.findOne({
      where: { id: branchId, companyId: req.companyId, isActive: true },
      transaction: t
    });
    if (!branchRecord) {
      throw new ValidationError("الفرع المحدد غير موجود أو غير نشط");
    }

    const nowStr = new Date().toISOString().slice(0, 16).replace("T", " ");
    const timestamp = Date.now();
    const moId = `MO-${timestamp.toString().slice(-6)}`;

    // 3. Consume raw input asset
    const remainingWeight = Math.round((Number(parentAsset.grossWeight) - inW) * 100) / 100;
    const isMelted = remainingWeight <= 0.01;
    const newParentStatus = isMelted ? "melted" : parentAsset.status;

    await parentAsset.update({
      grossWeight: remainingWeight,
      netWeight: remainingWeight,
      status: newParentStatus
    }, { transaction: t });

    // Create parent asset event
    await models.AssetEvent.create({
      id: `ASE-${timestamp}-MFG-OUT`,
      assetId: parentAsset.id,
      action: "MELTED_WEIGHT_DEDUCTION",
      date: nowStr.slice(0, 10),
      user: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System",
      branch: branchRecord.name,
      note: `سحب وزن للتصنيع: ${inW}g بموجب أمر تصنيع رقم ${moId}`,
      sourceDocument: moId,
      beforeState: `grossWeight:${parentAsset.grossWeight}`,
      afterState: `grossWeight:${remainingWeight}`,
      severity: isMelted ? "warning" : "info"
    }, { transaction: t });

    // 4. Calculate finished asset cost and price
    const rawGoldCost = Math.round(inW * (Number(parentAsset.cost) / Number(parentAsset.grossWeight || 1 || parentAsset.cost)) * 100) / 100;
    const manufacturingCost = Math.round((rawGoldCost + labor) * 100) / 100;
    const retailPrice = Math.round(manufacturingCost * 1.35 * 100) / 100;

    // 5. Create produced asset
    const finishedAssetId = `AST-MFG-${timestamp.toString().slice(-6)}`;
    const finishedAsset = await models.Asset.create({
      id: finishedAssetId,
      companyId: req.companyId,
      name: outputName.trim(),
      type: outputType,
      category: "تصنيع محلي",
      karat: Number(outputKarat) || null,
      purity: getPurityFromKarat(Number(outputKarat)) || 0.875,
      grossWeight: outW,
      netWeight: outW,
      cost: manufacturingCost,
      price: retailPrice,
      branch: branchRecord.name,
      branchId,
      location: "Showroom",
      status: "available",
      barcode: String(timestamp).slice(-13).padStart(13, "6"),
      source: `تصنيع محلي من أصل ${parentAsset.id}`,
      parentAssetId: parentAsset.id
    }, { transaction: t });

    // Create produced asset event
    const lossWeight = Math.round((inW - outW) * 100) / 100;
    const processLossPct = Math.round(((inW - outW) / inW) * 10000) / 100;

    await models.AssetEvent.create({
      id: `ASE-${timestamp}-MFG-IN`,
      assetId: finishedAsset.id,
      action: "MANUFACTURED",
      date: nowStr.slice(0, 10),
      user: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System",
      branch: branchRecord.name,
      note: `إنتاج قطعة مصنعة من أصل أب ${parentAsset.id}. فاقد الوزن: ${processLossPct}% (${lossWeight} جم)`,
      sourceDocument: moId,
      beforeState: "status:none",
      afterState: "status:available",
      severity: "info"
    }, { transaction: t });

    // 6. Create manufacturing order in database
    const mo = await models.ManufacturingOrder.create({
      id: moId,
      companyId: req.companyId,
      status: "completed",
      type: "manufacturing",
      inputAssets: [{ id: parentAsset.id, name: parentAsset.name, weight: inW, karat: parentAsset.karat }],
      outputAssets: [{ id: finishedAsset.id, name: finishedAsset.name, weight: outW, karat: finishedAsset.karat }],
      expectedOutputWeight: inW,
      actualOutputWeight: outW,
      processLoss: lossWeight,
      wastage: lossWeight > 0 ? lossWeight : 0,
      branch: branchRecord.name,
      notes: notes || `تصنيع محلي لأصل ${finishedAsset.name}`,
      startedAt: nowStr.slice(0, 16),
      completedAt: nowStr.slice(0, 16),
      createdBy: actor,
      approvedBy: actor
    }, { transaction: t });

    // 7. Create accounting journal entry
    const glLines = [
      { accountCode: "1200", debit: manufacturingCost, credit: 0, description: `إدخال منتج مصنع ${finishedAssetId}` },
      { accountCode: "1200", debit: 0, credit: rawGoldCost, description: `استهلاك خام ذهب ${parentAsset.id}` }
    ];
    if (labor > 0) {
      glLines.push({ accountCode: "1110", debit: 0, credit: labor, description: `أجور صياغة مدفوعة نقداً` });
    }

    let journalEntry = null;
    try {
      journalEntry = await postingService.postEntry(req.companyId, {
        description: `أمر تصنيع محلي رقم ${moId} — أصل ${finishedAssetId}`,
        date: nowStr.slice(0, 10),
        sourceType: "manufacturing_order",
        sourceId: moId,
        postedBy: actor,
        transaction: t,
        branchId
      }, glLines);
    } catch (postErr) {
      logger.error(`[Posting] Failed to post manufacturing journal entry: ${postErr.message}`);
      throw new Error(`خطأ في إنشاء القيد المحاسبي للتصنيع: ${postErr.message}`);
    }

    // 8. Record audit log
    await auditService.record(req.companyId, {
      action: "inventory.manufacturing",
      description: `تم إتمام أمر تصنيع رقم ${moId} وإنتاج أصل ${finishedAssetId} بفاقد ${lossWeight} جم وبأجور صياغة ${labor}`,
      user: actor,
      userId: req.user ? req.user.id : null,
      place: branchRecord.name,
      sourceDocument: "manufacturing_order",
      severity: "info",
      after: JSON.stringify({ moId, finishedAssetId, lossWeight, labor })
    }, { transaction: t });

    // Commit transaction
    await t.commit();

    // 9. Emit notifications and SSE
    await notificationService.createNotification(req.companyId, {
      title: "أمر تصنيع مكتمل",
      message: `تم إنتاج أصل جديد ${finishedAsset.name} بفرع ${branchRecord.name} فاقد الوزن ${processLossPct}%`,
      type: "success",
      entityType: "ManufacturingOrder",
      entityId: moId
    });
    emitEntityChanged(req.companyId, {
      entity: "Asset",
      action: "update",
      id: finishedAssetId,
      branchId,
      related: {
        assetIds: [finishedAssetId, parentAssetId].filter(Boolean)
      }
    });

    return res.status(201).json({
      success: true,
      mo,
      finishedAsset,
      parentAsset,
      journalEntry
    });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

// ─── Custom Stock Audit Endpoints ───────────────────────────────────────────

// 1. List stock audits
router.get("/stock-audits", authMiddleware, requirePermission("inventory.view"), async (req, res, next) => {
  try {
    const where = { companyId: req.companyId };
    if (req.query.branchId) where.branchId = req.query.branchId;
    if (req.query.status) where.status = req.query.status;

    const rows = await models.StockAudit.findAll({
      where,
      order: [["createdAt", "DESC"]],
      limit: parseInt(req.query.pageSize) || 100
    });
    return res.status(200).json({ success: true, items: rows, data: { items: rows } });
  } catch (error) {
    next(error);
  }
});

// 2. Create stock audit session
router.post("/stock-audits", authMiddleware, requirePermission("inventory.adjust"), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const branchId = req.headers["x-branch-id"] || req.body.branchId;
    if (!branchId) {
      throw new ValidationError("الفرع النشط مطلوب لبدء الجرد");
    }

    const branchRecord = await models.Branch.findOne({
      where: { id: branchId, companyId: req.companyId, isActive: true },
      transaction: t
    });
    if (!branchRecord) {
      throw new ValidationError("الفرع المحدد غير موجود أو غير نشط");
    }

    // Check if there is already an in-progress audit for this branch
    const existing = await models.StockAudit.findOne({
      where: { companyId: req.companyId, branchId, status: "in-progress" },
      transaction: t
    });
    if (existing) {
      await t.rollback();
      return res.status(200).json({ success: true, ...existing.toJSON(), data: existing.toJSON() });
    }

    const nowStr = new Date().toISOString().slice(0, 16).replace("T", " ");
    const auditId = `AUD-RFID-${Date.now()}`;
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";

    // Create stock audit session
    const audit = await models.StockAudit.create({
      id: auditId,
      companyId: req.companyId,
      branchId,
      status: "in-progress",
      createdBy: actor,
      notes: req.body.notes || `جرد RFID لفرع ${branchRecord.name}`
    }, { transaction: t });

    // Fetch all available assets in this branch
    const expectedAssets = await models.Asset.findAll({
      where: {
        companyId: req.companyId,
        branchId,
        status: { [Op.notIn]: ["sold", "archived"] }
      },
      transaction: t
    });

    // Bulk create stock audit items
    const itemsToCreate = expectedAssets.map(asset => ({
      id: `AUD-ITEM-${asset.id}-${Date.now()}`,
      stockAuditId: auditId,
      assetId: asset.id,
      expectedBranchId: branchId,
      status: "missing"
    }));

    if (itemsToCreate.length > 0) {
      await models.StockAuditItem.bulkCreate(itemsToCreate, { transaction: t });
    }

    await t.commit();

    const result = audit.toJSON();
    result.itemsCount = itemsToCreate.length;

    return res.status(201).json({ success: true, ...result, data: result });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

// 3. Get stock audit session details
router.get("/stock-audits/:id", authMiddleware, requirePermission("inventory.view"), async (req, res, next) => {
  try {
    const audit = await models.StockAudit.findOne({
      where: { id: req.params.id, companyId: req.companyId },
      include: [
        {
          model: models.StockAuditItem,
          as: "items",
          include: [{ model: models.Asset, as: "asset" }]
        }
      ]
    });
    if (!audit) {
      throw new NotFoundError("جلسة الجرد غير موجودة");
    }
    return res.status(200).json({ success: true, ...audit.toJSON(), data: audit.toJSON() });
  } catch (error) {
    next(error);
  }
});

// 4. Store scanned items in the session (update statuses)
router.post("/stock-audits/:id/items", authMiddleware, requirePermission("inventory.adjust"), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const { scannedAssetIds = [] } = req.body || {};
    const audit = await models.StockAudit.findOne({
      where: { id: req.params.id, companyId: req.companyId },
      transaction: t
    });
    if (!audit) {
      throw new NotFoundError("جلسة الجرد غير موجودة");
    }
    if (audit.status !== "in-progress") {
      throw new ValidationError("جلسة الجرد هذه ليست قيد العمل");
    }

    const branchId = audit.branchId;

    // Fetch existing expected audit items
    const expectedItems = await models.StockAuditItem.findAll({
      where: { stockAuditId: audit.id },
      transaction: t
    });

    const expectedAssetIds = new Set(expectedItems.map(i => i.assetId));
    const scannedSet = new Set(scannedAssetIds);

    // 1. Process expected items (matched vs missing)
    for (const item of expectedItems) {
      const isScanned = scannedSet.has(item.assetId);
      await item.update({
        status: isScanned ? "matched" : "missing",
        scannedBranchId: isScanned ? branchId : null
      }, { transaction: t });
    }

    // 2. Process unexpected items (scanned but expected in another branch or not expected)
    const unexpectedAssetIds = scannedAssetIds.filter(id => !expectedAssetIds.has(id));
    if (unexpectedAssetIds.length > 0) {
      const unexpectedAssets = await models.Asset.findAll({
        where: { id: unexpectedAssetIds, companyId: req.companyId },
        transaction: t
      });

      for (const asset of unexpectedAssets) {
        // Check if there is already an unexpected record in this audit
        const existingUnexpected = await models.StockAuditItem.findOne({
          where: { stockAuditId: audit.id, assetId: asset.id },
          transaction: t
        });

        if (!existingUnexpected) {
          await models.StockAuditItem.create({
            id: `AUD-ITEM-UNEXP-${asset.id}-${Date.now()}`,
            stockAuditId: audit.id,
            assetId: asset.id,
            expectedBranchId: asset.branchId || branchId,
            scannedBranchId: branchId,
            status: "unexpected"
          }, { transaction: t });
        }
      }
    }

    await t.commit();

    const updated = await models.StockAudit.findOne({
      where: { id: audit.id },
      include: [
        {
          model: models.StockAuditItem,
          as: "items",
          include: [{ model: models.Asset, as: "asset" }]
        }
      ]
    });

    return res.status(200).json({ success: true, ...updated.toJSON(), data: updated.toJSON() });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

// 5. Complete stock audit session (apply inventory adjustments)
router.post("/stock-audits/:id/complete", authMiddleware, requirePermission("inventory.adjust"), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const audit = await models.StockAudit.findOne({
      where: { id: req.params.id, companyId: req.companyId },
      include: [{ model: models.StockAuditItem, as: "items", include: [{ model: models.Asset, as: "asset" }] }],
      transaction: t
    });

    if (!audit) {
      throw new NotFoundError("جلسة الجرد غير موجودة");
    }
    if (audit.status !== "in-progress") {
      throw new ValidationError("جلسة الجرد مغلقة بالفعل أو ملغاة");
    }

    const branchRecord = await models.Branch.findOne({
      where: { id: audit.branchId, companyId: req.companyId },
      transaction: t
    });

    const nowStr = new Date().toISOString().slice(0, 16).replace("T", " ");
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";

    // Update audit status to completed
    await audit.update({
      status: "completed",
      completedAt: nowStr
    }, { transaction: t });

    let missingCount = 0;
    let unexpectedCount = 0;

    // Apply adjustments
    for (const item of audit.items) {
      const asset = item.asset;
      if (!asset) continue;

      if (item.status === "missing") {
        missingCount++;
        // Archive missing asset
        const beforeState = `status:${asset.status}`;
        await asset.update({ status: "archived" }, { transaction: t });

        // Create Asset Event
        await models.AssetEvent.create({
          id: `ASE-${Date.now()}-LOST-${asset.id}`,
          assetId: asset.id,
          action: "LOST_RFID_AUDIT",
          date: nowStr.slice(0, 10),
          user: actor,
          branch: branchRecord.name,
          note: `تم اعتبار الأصل مفقوداً وضائعاً بناءً على تقرير جرد RFID رقم ${audit.id}`,
          sourceDocument: audit.id,
          beforeState,
          afterState: "status:archived",
          severity: "critical"
        }, { transaction: t });

        // Record Audit Log
        await auditService.record(req.companyId, {
          action: "adjustment",
          description: `تم تحديث حالة الأصل المفقود في جرد RFID رقم ${audit.id} للأصل ${asset.id}`,
          user: actor,
          userId: req.user ? req.user.id : null,
          place: branchRecord.name,
          sourceDocument: "stock_audit",
          severity: "critical",
          before: beforeState,
          after: "status:archived"
        }, { transaction: t });

      } else if (item.status === "unexpected") {
        unexpectedCount++;
        // Re-assign branch
        const beforeState = `branch:${asset.branch || "unknown"} (branchId:${asset.branchId || "unknown"})`;
        await asset.update({
          branchId: audit.branchId,
          branch: branchRecord.name
        }, { transaction: t });

        // Create Asset Event
        await models.AssetEvent.create({
          id: `ASE-${Date.now()}-LOC-${asset.id}`,
          assetId: asset.id,
          action: "LOCATION_RFID_AUDIT",
          date: nowStr.slice(0, 10),
          user: actor,
          branch: branchRecord.name,
          note: `تحديث موقع الفرع بعد فحص جرد RFID رقم ${audit.id}`,
          sourceDocument: audit.id,
          beforeState,
          afterState: `branch:${branchRecord.name} (branchId:${audit.branchId})`,
          severity: "warning"
        }, { transaction: t });

        // Record Audit Log
        await auditService.record(req.companyId, {
          action: "adjustment",
          description: `تم تحديث فرع الأصل بعد فحص جرد RFID رقم ${audit.id} للأصل ${asset.id}`,
          user: actor,
          userId: req.user ? req.user.id : null,
          place: branchRecord.name,
          sourceDocument: "stock_audit",
          severity: "warning",
          before: beforeState,
          after: `branch:${branchRecord.name}`
        }, { transaction: t });
      }
    }

    await t.commit();

    // Emit notification and SSE event
    await notificationService.createNotification(req.companyId, {
      title: "اكتمل جرد RFID للفرع",
      message: `تم إنهاء جلسة الجرد رقم ${audit.id} بنجاح. المفقودات: ${missingCount}، القطع غير المتوقعة المسواة: ${unexpectedCount}`,
      type: "warning",
      entityType: "StockAudit",
      entityId: audit.id
    });
    emitEntityChanged(req.companyId, {
      entity: "Asset",
      action: "update",
      id: audit.id,
      branchId: audit.branchId
    });

    return res.status(200).json({
      success: true,
      audit,
      missingCount,
      unexpectedCount
    });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

// ─── Custom Asset Attachments Endpoints ─────────────────────────────────────

const fs = require("fs");
const path = require("path");

const CUSTOMER_ATTACHMENT_TYPES = new Map([
  [".pdf", { mime: "application/pdf", category: "pdf" }],
  [".jpg", { mime: "image/jpeg", category: "image" }],
  [".jpeg", { mime: "image/jpeg", category: "image" }],
  [".png", { mime: "image/png", category: "image" }],
  [".webp", { mime: "image/webp", category: "image" }],
  [".xlsx", { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", category: "spreadsheet" }],
  [".csv", { mime: "text/csv", category: "spreadsheet" }],
  [".doc", { mime: "application/msword", category: "document" }],
  [".docx", { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", category: "document" }]
]);

function validateCustomerAttachmentFile(file) {
  if (!file) throw new ValidationError("الملف مطلوب");
  const ext = path.extname(file.originalname || "").toLowerCase();
  const rule = CUSTOMER_ATTACHMENT_TYPES.get(ext);
  if (!rule || rule.mime !== file.mimetype) {
    throw new ValidationError("نوع الملف غير مدعوم. المسموح به: PDF, JPG, JPEG, PNG, WEBP, XLSX, CSV, DOC, DOCX");
  }
  return { ext, category: rule.category };
}

function safeUploadFileName(ext) {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`;
}

function serializeAssetAttachment(attachment) {
  const raw = attachment?.toJSON ? attachment.toJSON() : attachment;
  if (!raw) return null;
  return {
    id: raw.id,
    name: raw.name || raw.originalFileName || raw.fileName || "Attachment",
    type: raw.type || raw.mimeType || "application/octet-stream",
    url: raw.url || raw.fileUrl || "",
    uploadedAt: raw.uploadedAt,
    uploadedBy: raw.uploadedBy || "System"
  };
}

// ─── Custom Customer Attachments & KYC Endpoints ────────────────────────────

router.get("/customers/:id/attachments", authMiddleware, requirePermission("customers.view"), async (req, res, next) => {
  try {
    const customer = await models.Customer.findOne({
      where: { id: req.params.id, companyId: req.companyId }
    });
    if (!customer) throw new NotFoundError("Customer record not found.");

    const attachments = await models.CustomerAttachment.findAll({
      where: { customerId: customer.id, companyId: req.companyId },
      order: [["uploadedAt", "DESC"], ["createdAt", "DESC"]]
    });
    const serialized = attachments.map(serializeAssetAttachment).filter(Boolean);
    return res.status(200).json({ success: true, items: serialized, data: { items: serialized } });
  } catch (error) {
    next(error);
  }
});

router.post("/customers/:id/attachments", authMiddleware, requireAnyPermission(["customers.update", "customers.attachments.manage"]), uploadMiddleware.single("file"), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  let targetPath = "";
  try {
    const { ext, category } = validateCustomerAttachmentFile(req.file);
    const customer = await models.Customer.findOne({
      where: { id: req.params.id, companyId: req.companyId },
      transaction: t
    });
    if (!customer) throw new NotFoundError("Customer record not found.");

    const baseUploadDir = process.env.UPLOAD_DIR
      ? path.resolve(process.env.UPLOAD_DIR)
      : path.join(__dirname, "../../../uploads");
    const uploadDir = path.join(baseUploadDir, "customer-attachments");
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    const fileName = safeUploadFileName(ext);
    targetPath = path.join(uploadDir, fileName);
    moveUploadedFileSafe(req.file.path, targetPath);

    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    const attachmentId = `CATT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const attachment = await models.CustomerAttachment.create({
      id: attachmentId,
      companyId: req.companyId,
      customerId: customer.id,
      fileName,
      originalFileName: req.file.originalname,
      mimeType: req.file.mimetype,
      fileSize: req.file.size,
      fileUrl: `/uploads/customer-attachments/${fileName}`,
      category,
      uploadedBy: actor,
      uploadedAt: new Date()
    }, { transaction: t });

    await auditService.record(req.companyId, {
      action: "customer.attachment.upload",
      description: `Uploaded customer attachment ${req.file.originalname} for ${customer.name}`,
      user: actor,
      userId: req.user?.id,
      place: req.branchId || "Customer Profile",
      sourceDocument: customer.id,
      severity: "info",
      after: JSON.stringify({ attachmentId, originalFileName: req.file.originalname, mimeType: req.file.mimetype })
    }, { transaction: t });

    await t.commit();
    emitEntityChanged(req.companyId, {
      entity: "Attachment",
      action: "upload",
      id: attachmentId,
      related: { customerId: customer.id }
    });
    return res.status(201).json({ success: true, data: attachment.toJSON() });
  } catch (error) {
    await t.rollback();
    if (req.file && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (_) { }
    }
    if (targetPath && fs.existsSync(targetPath)) {
      try { fs.unlinkSync(targetPath); } catch (_) { }
    }
    next(error);
  }
});

router.delete("/customers/:id/attachments/:attachmentId", authMiddleware, requireAnyPermission(["customers.update", "customers.attachments.manage"]), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const customer = await models.Customer.findOne({
      where: { id: req.params.id, companyId: req.companyId },
      transaction: t
    });
    if (!customer) throw new NotFoundError("Customer record not found.");

    const attachment = await models.CustomerAttachment.findOne({
      where: { id: req.params.attachmentId, customerId: customer.id, companyId: req.companyId },
      transaction: t
    });
    if (!attachment) throw new NotFoundError("Attachment not found.");

    const baseUploadDir = process.env.UPLOAD_DIR
      ? path.resolve(process.env.UPLOAD_DIR)
      : path.join(__dirname, "../../../uploads");
    const relativePath = attachment.fileUrl.replace(/^\/uploads\//, "");
    const filePath = path.join(baseUploadDir, relativePath);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    await attachment.destroy({ transaction: t });
    await auditService.record(req.companyId, {
      action: "customer.attachment.delete",
      description: `Deleted customer attachment ${attachment.originalFileName} for ${customer.name}`,
      user: actor,
      userId: req.user?.id,
      place: req.branchId || "Customer Profile",
      sourceDocument: customer.id,
      severity: "info",
      before: JSON.stringify(attachment.toJSON())
    }, { transaction: t });

    await t.commit();
    emitEntityChanged(req.companyId, {
      entity: "Attachment",
      action: "delete",
      id: req.params.attachmentId,
      related: { customerId: customer.id }
    });
    return res.status(200).json({ success: true, data: { message: "Attachment deleted." } });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

router.patch("/customers/:id/kyc", authMiddleware, requireAnyPermission(["customers.update", "customers.kyc.manage"]), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const customer = await models.Customer.findOne({
      where: { id: req.params.id, companyId: req.companyId },
      transaction: t
    });
    if (!customer) throw new NotFoundError("Customer record not found.");

    const allowedIdentityTypes = new Set(["national_id", "passport", "driving_license", "residency_id", "other", ""]);
    const allowedKyc = new Set(["not-started", "pending", "verified", "flagged"]);
    const allowedAml = new Set(["clear", "review", "flagged"]);
    const body = req.body || {};

    const identityType = String(body.identityType ?? body.idType ?? "").trim();
    const identityNumber = String(body.identityNumber ?? body.idNumber ?? "").trim();
    const identityExpiryDate = String(body.identityExpiryDate ?? body.idExpiry ?? "").trim();
    const kycStatus = String(body.kycStatus ?? body.status ?? customer.kycStatus ?? "not-started");
    const amlStatus = String(body.amlStatus ?? customer.amlStatus ?? "clear");

    if (!allowedIdentityTypes.has(identityType)) throw new ValidationError("نوع الهوية غير صحيح");
    if (!allowedKyc.has(kycStatus)) throw new ValidationError("حالة KYC غير صحيحة");
    if (!allowedAml.has(amlStatus)) throw new ValidationError("حالة AML غير صحيحة");
    if (identityExpiryDate && !/^\d{4}-\d{2}-\d{2}$/.test(identityExpiryDate)) {
      throw new ValidationError("تاريخ انتهاء الهوية يجب أن يكون بصيغة YYYY-MM-DD");
    }

    const before = customer.toJSON();
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    const meaningfulStatusChange = before.kycStatus !== kycStatus || before.amlStatus !== amlStatus;
    const now = new Date();
    const kycDetails = {
      ...(customer.kycDetails || {}),
      identityType,
      identityNumber,
      identityExpiryDate,
      idType: identityType,
      idNumber: identityNumber,
      idExpiry: identityExpiryDate,
      status: kycStatus,
      amlStatus,
      lastCheckedAt: now.toISOString().slice(0, 10)
    };

    await customer.update({
      idType: identityType || null,
      idNumber: identityNumber || null,
      idExpiry: identityExpiryDate || null,
      kycStatus,
      amlStatus,
      kycDetails
    }, { transaction: t });

    await auditService.record(req.companyId, {
      action: "customer.kyc.update",
      description: `Updated KYC data for customer ${customer.name}`,
      user: actor,
      userId: req.user?.id,
      place: req.branchId || "Customer Profile",
      sourceDocument: customer.id,
      severity: meaningfulStatusChange ? "warning" : "info",
      before: JSON.stringify({
        idType: before.idType,
        idNumber: before.idNumber,
        idExpiry: before.idExpiry,
        kycStatus: before.kycStatus,
        amlStatus: before.amlStatus
      }),
      after: JSON.stringify({ identityType, identityNumber, identityExpiryDate, kycStatus, amlStatus })
    }, { transaction: t });

    let notification = null;
    if (meaningfulStatusChange) {
      notification = await notificationService.createNotification(req.companyId, {
        title: "Customer KYC updated",
        message: `KYC/AML status changed for customer ${customer.name}.`,
        type: amlStatus === "flagged" || kycStatus === "flagged" ? "warning" : "info",
        entityType: "Customer",
        entityId: customer.id
      }, { transaction: t });
    }

    await t.commit();
    emitEntityChanged(req.companyId, {
      entity: "KYC",
      action: "update",
      id: customer.id,
      related: { customerId: customer.id }
    });
    return res.status(200).json({
      success: true,
      data: customer.toJSON(),
      notification: notification ? notification.toJSON() : null
    });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

// 1. Get attachments list for an asset
router.get("/assets/:id/attachments", authMiddleware, requirePermission("inventory.view"), async (req, res, next) => {
  try {
    const asset = await models.Asset.findOne({
      where: { id: req.params.id, companyId: req.companyId }
    });
    if (!asset) {
      throw new NotFoundError("الأصل غير موجود أو لا ينتمي لشركتك");
    }

    const attachments = await models.AssetAttachment.findAll({
      where: { assetId: req.params.id },
      order: [["createdAt", "DESC"]]
    });
    return res.status(200).json({ success: true, items: attachments, data: { items: attachments } });
  } catch (error) {
    next(error);
  }
});

// 2. Upload an attachment for an asset
router.post("/assets/:id/attachments", authMiddleware, requireAnyPermission(["inventory.attachments.manage", "inventory.adjust"]), uploadMiddleware.single("file"), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    if (!req.file) {
      throw new ValidationError("الملف مطلوب");
    }

    const asset = await models.Asset.findOne({
      where: { id: req.params.id, companyId: req.companyId },
      transaction: t
    });
    if (!asset) {
      throw new NotFoundError("الأصل غير موجود أو لا ينتمي لشركتك");
    }

    // Save file to backend/uploads/attachments (respecting UPLOAD_DIR)
    const baseUploadDir = process.env.UPLOAD_DIR
      ? path.resolve(process.env.UPLOAD_DIR)
      : path.join(__dirname, "../../../uploads");
    const uploadDir = path.join(baseUploadDir, "attachments");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const fileExt = path.extname(req.file.originalname);
    const fileName = `${Date.now()}-${Math.floor(Math.random() * 1000)}${fileExt}`;
    const targetPath = path.join(uploadDir, fileName);

    moveUploadedFileSafe(req.file.path, targetPath);

    const fileUrl = `/uploads/attachments/${fileName}`;
    const attachmentId = `ATT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const nowStr = new Date().toISOString().slice(0, 16).replace("T", " ");

    const attachment = await models.AssetAttachment.create({
      id: attachmentId,
      assetId: asset.id,
      name: req.file.originalname,
      type: req.file.mimetype,
      url: fileUrl,
      uploadedAt: nowStr,
      uploadedBy: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System"
    }, { transaction: t });

    // Record Audit Log
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    await auditService.record(req.companyId, {
      action: "adjustment",
      description: `تم رفع مرفق جديد للأصل ${asset.id}: ${req.file.originalname}`,
      user: actor,
      userId: req.user ? req.user.id : null,
      place: asset.branch || "Showroom",
      sourceDocument: "asset",
      severity: "info",
      after: JSON.stringify({ attachmentId, name: req.file.originalname })
    }, { transaction: t });

    await t.commit();
    emitEntityChanged(req.companyId, {
      entity: "Attachment",
      action: "upload",
      id: attachmentId,
      branchId: asset.branchId,
      related: {
        assetIds: [asset.id]
      }
    });
    const serialized = serializeAssetAttachment(attachment);
    return res.status(201).json({ success: true, ...serialized, data: serialized });
  } catch (error) {
    await t.rollback();
    if (req.file && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (_) { }
    }
    next(error);
  }
});

// 3. Delete an attachment for an asset
router.delete("/assets/:id/attachments/:attachmentId", authMiddleware, requireAnyPermission(["inventory.attachments.manage", "inventory.adjust"]), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const asset = await models.Asset.findOne({
      where: { id: req.params.id, companyId: req.companyId },
      transaction: t
    });
    if (!asset) {
      throw new NotFoundError("الأصل غير موجود أو لا ينتمي لشركتك");
    }

    const attachment = await models.AssetAttachment.findOne({
      where: { id: req.params.attachmentId, assetId: req.params.id },
      transaction: t
    });
    if (!attachment) {
      throw new NotFoundError("المرفق غير موجود");
    }

    // Delete the file from the disk (respecting UPLOAD_DIR)
    const relativePath = attachment.url.replace(/^\/uploads\//, "");
    const baseUploadDir = process.env.UPLOAD_DIR
      ? path.resolve(process.env.UPLOAD_DIR)
      : path.join(__dirname, "../../../uploads");
    const filePath = path.join(baseUploadDir, relativePath);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await attachment.destroy({ transaction: t });

    // Record Audit Log
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    await auditService.record(req.companyId, {
      action: "adjustment",
      description: `تم حذف مرفق للأصل ${req.params.id}: ${attachment.name}`,
      user: actor,
      userId: req.user ? req.user.id : null,
      place: "Showroom",
      sourceDocument: "asset",
      severity: "info",
      after: JSON.stringify({ id: attachment.id, name: attachment.name })
    }, { transaction: t });

    await t.commit();
    emitEntityChanged(req.companyId, {
      entity: "Attachment",
      action: "delete",
      id: req.params.attachmentId,
      branchId: asset.branchId,
      related: {
        assetIds: [asset.id]
      }
    });
    return res.status(200).json({ success: true, message: "تم حذف المرفق بنجاح" });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

// ─── Custom Transfers Logic ──────────────────────────────────────────────────
router.post("/transfers", authMiddleware, requirePermission("inventory.transfer"), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const { assetIds = [], fromBranchId, toBranchId, notes = "" } = req.body || {};

    if (fromBranchId === toBranchId) {
      throw new ValidationError("لا يمكن التحويل من وإلى نفس الفرع");
    }

    const fromBranchRecord = await models.Branch.findOne({ where: { id: fromBranchId, companyId: req.companyId, isActive: true }, transaction: t });
    const toBranchRecord = await models.Branch.findOne({ where: { id: toBranchId, companyId: req.companyId, isActive: true }, transaction: t });

    if (!fromBranchRecord || !toBranchRecord) {
      throw new ValidationError("الفرع المرسل أو المستقبل غير موجود أو غير نشط");
    }

    if (assetIds.length === 0) {
      throw new ValidationError("يجب اختيار أصل واحد على الأقل للتحويل");
    }

    const assets = await models.Asset.findAll({
      where: { id: assetIds, companyId: req.companyId },
      lock: true,
      transaction: t
    });

    if (assets.length !== assetIds.length) {
      throw new ValidationError("بعض الأصول المحددة غير موجودة");
    }

    for (const asset of assets) {
      if (asset.branchId !== fromBranchId) {
        throw new ValidationError(`الأصل ${asset.name} (${asset.id}) ليس موجوداً في فرع المصدر`);
      }
      if (asset.status !== "available") {
        const canBypass = req.user && (req.user.isAdmin || (req.user.permissions && req.user.permissions.includes("transfers.bypassStatus")));
        if (!canBypass) {
          throw new ValidationError(`الأصل ${asset.name} (${asset.id}) حالته ليست متاحة للتحويل: ${asset.status}`);
        }
      }
    }

    const transferId = `TR-${Date.now()}`;
    const transfer = await models.Transfer.create({
      id: transferId,
      companyId: req.companyId,
      assetIds,
      fromBranch: fromBranchRecord.name,
      fromBranchId,
      toBranch: toBranchRecord.name,
      toBranchId,
      requestedBy: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System",
      requestedAt: new Date().toISOString(),
      status: "pending",
      notes
    }, { transaction: t });

    // Mark assets as reserved during the transfer request
    for (const asset of assets) {
      await asset.update({ status: "reserved" }, { transaction: t });
      await models.AssetEvent.create({
        id: `ASE-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        assetId: asset.id,
        companyId: req.companyId,
        type: "transfer_request",
        description: `طلب تحويل إلى ${toBranchRecord.name} بموجب مستند رقم ${transferId}`,
        date: new Date().toISOString().slice(0, 10),
        user: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System"
      }, { transaction: t });
    }

    await t.commit();

    emitEntityChanged(req.companyId, {
      entity: "Transfer",
      action: "create",
      id: transferId,
      branchId: fromBranchId,
      related: { transferId, assetIds }
    });
    await notificationService.createNotification(req.companyId, {
      title: "طلب تحويل مخزني جديد",
      message: `تم إنشاء طلب تحويل ${assetIds.length} أصول من ${fromBranchRecord.name} إلى ${toBranchRecord.name}.`,
      type: "info",
      entityType: "Transfer",
      entityId: transferId
    });

    return res.status(201).json({ success: true, ...transfer.toJSON(), data: transfer.toJSON() });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

router.patch("/transfers/:id", authMiddleware, requirePermission("inventory.transfer"), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const { id } = req.params;
    const { status, cancelReason } = req.body;

    const transfer = await models.Transfer.findOne({
      where: { id, companyId: req.companyId },
      transaction: t
    });

    if (!transfer) {
      throw new NotFoundError("طلب التحويل غير موجود");
    }

    const assets = await models.Asset.findAll({
      where: { id: transfer.assetIds, companyId: req.companyId },
      lock: true,
      transaction: t
    });

    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    const nowStr = new Date().toISOString();

    if (status === "in-transit" || status === "approved") {
      if (transfer.status !== "pending") {
        throw new ValidationError("يمكن فقط قبول الطلبات المعلقة");
      }
      await transfer.update({
        status: "in-transit",
        approvedBy: actor,
        approvedAt: nowStr
      }, { transaction: t });

      for (const asset of assets) {
        await models.AssetEvent.create({
          id: `ASE-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          assetId: asset.id,
          companyId: req.companyId,
          type: "transfer_approved",
          description: `تمت الموافقة على التحويل إلى ${transfer.toBranch} (شحنة قيد النقل)`,
          date: nowStr.slice(0, 10),
          user: actor
        }, { transaction: t });
      }
    } else if (status === "received") {
      if (transfer.status !== "in-transit" && transfer.status !== "approved" && transfer.status !== "pending") {
        throw new ValidationError("لا يمكن استلام شحنة ليست قيد النقل أو معلقة");
      }
      await transfer.update({
        status: "received",
        receivedBy: actor,
        receivedAt: nowStr
      }, { transaction: t });

      for (const asset of assets) {
        await asset.update({
          branchId: transfer.toBranchId,
          branch: transfer.toBranch,
          status: "available"
        }, { transaction: t });

        await models.AssetEvent.create({
          id: `ASE-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          assetId: asset.id,
          companyId: req.companyId,
          type: "transfer_received",
          description: `تم استلام الأصل في فرع ${transfer.toBranch}`,
          date: nowStr.slice(0, 10),
          user: actor
        }, { transaction: t });
      }
    } else if (status === "cancelled") {
      if (transfer.status === "received" || transfer.status === "cancelled") {
        throw new ValidationError("لا يمكن إلغاء شحنة تم استلامها أو إلغاؤها بالفعل");
      }
      await transfer.update({
        status: "cancelled",
        cancelReason: cancelReason || "إلغاء من قبل المستخدم"
      }, { transaction: t });

      for (const asset of assets) {
        await asset.update({ status: "available" }, { transaction: t });

        await models.AssetEvent.create({
          id: `ASE-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          assetId: asset.id,
          companyId: req.companyId,
          type: "transfer_cancelled",
          description: `تم إلغاء التحويل: ${cancelReason || "إلغاء"}`,
          date: nowStr.slice(0, 10),
          user: actor
        }, { transaction: t });
      }
    } else {
      await transfer.update(req.body, { transaction: t });
    }

    await t.commit();

    emitEntityChanged(req.companyId, {
      entity: "Transfer",
      action: status || "update",
      id,
      branchId: transfer.fromBranchId,
      related: { transferId: id, assetIds: transfer.assetIds || [] }
    });
    await notificationService.createNotification(req.companyId, {
      title: `تحديث حالة التحويل رقم ${id}`,
      message: `تم تغيير حالة التحويل المخزني إلى: ${status}`,
      type: "info",
      entityType: "Transfer",
      entityId: id
    });

    return res.status(200).json({ success: true, ...transfer.toJSON(), data: transfer.toJSON() });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

// ─── Safe Customer/Supplier/Branch Delete & Activation Actions ──────────────

router.post("/customers/:id/deactivate", authMiddleware, requirePermission("customers.deactivate"), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const customer = await models.Customer.findOne({ where: { id: req.params.id, companyId: req.companyId }, transaction: t });
    if (!customer) throw new NotFoundError("Customer record not found.");
    const before = customer.toJSON();
    await customer.update({ status: "inactive" }, { transaction: t });
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    await auditService.record(req.companyId, {
      action: "customer.deactivate",
      description: `Customer ${customer.name} deactivated.`,
      user: actor,
      userId: req.user?.id,
      place: req.branchId || "Customers",
      sourceDocument: customer.id,
      severity: "warning",
      before: JSON.stringify(before),
      after: JSON.stringify(customer.toJSON())
    }, { transaction: t });
    await t.commit();
    emitEntityChanged(req.companyId, { entity: "Customer", action: "deactivate", id: customer.id, related: { customerId: customer.id } });
    return res.status(200).json({ success: true, data: customer });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

router.post("/customers/:id/reactivate", authMiddleware, requirePermission("customers.reactivate"), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const customer = await models.Customer.findOne({ where: { id: req.params.id, companyId: req.companyId }, transaction: t });
    if (!customer) throw new NotFoundError("Customer record not found.");
    const before = customer.toJSON();
    await customer.update({ status: "active" }, { transaction: t });
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    await auditService.record(req.companyId, {
      action: "customer.reactivate",
      description: `Customer ${customer.name} reactivated.`,
      user: actor,
      userId: req.user?.id,
      place: req.branchId || "Customers",
      sourceDocument: customer.id,
      severity: "info",
      before: JSON.stringify(before),
      after: JSON.stringify(customer.toJSON())
    }, { transaction: t });
    await t.commit();
    emitEntityChanged(req.companyId, { entity: "Customer", action: "reactivate", id: customer.id, related: { customerId: customer.id } });
    return res.status(200).json({ success: true, data: customer });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

router.delete("/customers/:id", authMiddleware, requirePermission("customers.delete"), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const customer = await models.Customer.findOne({ where: { id: req.params.id, companyId: req.companyId }, transaction: t });
    if (!customer) throw new NotFoundError("Customer record not found.");
    const linked = await countLinkedRecords([
      ["invoices", () => models.Invoice.count({ where: postedInvoiceWhere({ customerId: customer.id, companyId: req.companyId }), transaction: t })],
      ["reservations", () => models.Reservation.count({ where: { customerId: customer.id, companyId: req.companyId }, transaction: t })],
      ["installments", () => models.Installment.count({ where: { customerId: customer.id, companyId: req.companyId }, transaction: t })],
      ["customerGoldPools", () => models.CustomerGoldPool.count({ where: { customerId: customer.id, companyId: req.companyId }, transaction: t })],
      ["attachments", () => models.CustomerAttachment.count({ where: { customerId: customer.id, companyId: req.companyId }, transaction: t })],
      ["giftVouchers", () => models.GiftVoucher.count({ where: { customerId: customer.id, companyId: req.companyId }, transaction: t })],
      ["goldFixings", () => models.GoldFixing.count({ where: { customerId: customer.id, companyId: req.companyId }, transaction: t })],
      ["loyaltyTransactions", () => models.LoyaltyTransaction.count({ where: { customerId: customer.id, companyId: req.companyId }, transaction: t })]
    ]);
    if (Object.keys(linked).length) throw linkedRecordsError(req, "CUSTOMER_HAS_LINKED_RECORDS", linked);

    const before = customer.toJSON();
    await customer.destroy({ force: true, transaction: t });
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    await auditService.record(req.companyId, {
      action: "customer.delete",
      description: `Customer ${customer.name} permanently deleted.`,
      user: actor,
      userId: req.user?.id,
      place: req.branchId || "Customers",
      sourceDocument: customer.id,
      severity: "critical",
      before: JSON.stringify(before)
    }, { transaction: t });
    await t.commit();
    emitEntityChanged(req.companyId, { entity: "Customer", action: "delete", id: customer.id, related: { customerId: customer.id } });
    return res.status(200).json({ success: true, data: { id: customer.id, action: "deleted" } });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

router.post("/suppliers/:id/deactivate", authMiddleware, requirePermission("suppliers.deactivate"), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const supplier = await models.Supplier.findOne({ where: { id: req.params.id, companyId: req.companyId }, transaction: t });
    if (!supplier) throw new NotFoundError("Supplier record not found.");
    const before = supplier.toJSON();
    await supplier.update({ status: "inactive" }, { transaction: t });
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    await auditService.record(req.companyId, {
      action: "supplier.deactivate",
      description: `Supplier ${supplier.name} deactivated.`,
      user: actor,
      userId: req.user?.id,
      place: req.branchId || "Suppliers",
      sourceDocument: supplier.id,
      severity: "warning",
      before: JSON.stringify(before),
      after: JSON.stringify(supplier.toJSON())
    }, { transaction: t });
    await t.commit();
    emitEntityChanged(req.companyId, { entity: "Supplier", action: "deactivate", id: supplier.id, related: { supplierId: supplier.id } });
    return res.status(200).json({ success: true, data: supplier });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

router.post("/suppliers/:id/reactivate", authMiddleware, requirePermission("suppliers.reactivate"), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const supplier = await models.Supplier.findOne({ where: { id: req.params.id, companyId: req.companyId }, transaction: t });
    if (!supplier) throw new NotFoundError("Supplier record not found.");
    const before = supplier.toJSON();
    await supplier.update({ status: "active" }, { transaction: t });
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    await auditService.record(req.companyId, {
      action: "supplier.reactivate",
      description: `Supplier ${supplier.name} reactivated.`,
      user: actor,
      userId: req.user?.id,
      place: req.branchId || "Suppliers",
      sourceDocument: supplier.id,
      severity: "info",
      before: JSON.stringify(before),
      after: JSON.stringify(supplier.toJSON())
    }, { transaction: t });
    await t.commit();
    emitEntityChanged(req.companyId, { entity: "Supplier", action: "reactivate", id: supplier.id, related: { supplierId: supplier.id } });
    return res.status(200).json({ success: true, data: supplier });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

router.delete("/suppliers/:id", authMiddleware, requirePermission("suppliers.delete"), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const supplier = await models.Supplier.findOne({ where: { id: req.params.id, companyId: req.companyId }, transaction: t });
    if (!supplier) throw new NotFoundError("Supplier record not found.");
    const linked = await countLinkedRecords([
      ["purchaseOrders", () => models.PurchaseOrder.count({ where: { supplierId: supplier.id, companyId: req.companyId }, transaction: t })],
      ["documents", () => models.SupplierDocument.count({ where: { supplierId: supplier.id }, transaction: t })],
      ["consignments", () => models.SupplierConsignment.count({ where: { supplierId: supplier.id }, transaction: t })],
      ["assets", () => models.Asset.count({ where: { companyId: req.companyId, source: { [Op.iLike]: `%${supplier.id}%` } }, transaction: t })]
    ]);
    if (Object.keys(linked).length) throw linkedRecordsError(req, "SUPPLIER_HAS_LINKED_RECORDS", linked);

    const before = supplier.toJSON();
    await supplier.destroy({ force: true, transaction: t });
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    await auditService.record(req.companyId, {
      action: "supplier.delete",
      description: `Supplier ${supplier.name} permanently deleted.`,
      user: actor,
      userId: req.user?.id,
      place: req.branchId || "Suppliers",
      sourceDocument: supplier.id,
      severity: "critical",
      before: JSON.stringify(before)
    }, { transaction: t });
    await t.commit();
    emitEntityChanged(req.companyId, { entity: "Supplier", action: "delete", id: supplier.id, related: { supplierId: supplier.id } });
    return res.status(200).json({ success: true, data: { id: supplier.id, action: "deleted" } });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

// 1. Initialize Standard CRUD Endpoints
setupCrud("customers", models.Customer, ["name", "phone", "email"]);
setupCrud("suppliers", models.Supplier, ["name", "phone", "email", "category"]);
setupCrud("employees", models.Employee, ["name", "phone", "email", "role"]);
setupCrud("assets", models.Asset, ["name", "barcode", "rfid", "category", "location"]);
setupCrud("companies", models.Company, ["businessName", "workspace"]);
setupCrud("products", models.Product, ["productName", "productCode", "description"]);
setupCrud("stock-movements", models.StockMovement, ["productCode", "type", "referenceId"]);

router.post("/branches/:id/deactivate", authMiddleware, requirePermission("branches.deactivate"), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const branch = await models.Branch.findOne({ where: { id: req.params.id, companyId: req.companyId }, transaction: t });
    if (!branch) throw new NotFoundError("Branch record not found.");
    if (branch.isActive) {
      const activeCount = await models.Branch.count({ where: { companyId: req.companyId, isActive: true }, transaction: t });
      if (activeCount <= 1) throw new ValidationError(lastActiveBranchDeactivateMessage(req));
    }
    const before = branch.toJSON();
    await branch.update({ isActive: false }, { transaction: t });
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    await auditService.record(req.companyId, {
      action: "branch.deactivate",
      description: `Branch ${branch.name} deactivated.`,
      user: actor,
      userId: req.user?.id,
      place: branch.name,
      sourceDocument: branch.id,
      severity: "warning",
      before: JSON.stringify(before),
      after: JSON.stringify(branch.toJSON())
    }, { transaction: t });
    await t.commit();
    emitEntityChanged(req.companyId, { entity: "Branch", action: "deactivate", id: branch.id, related: { branchId: branch.id } });
    return res.status(200).json({ success: true, data: branch });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

router.post("/branches/:id/reactivate", authMiddleware, requirePermission("branches.reactivate"), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const branch = await models.Branch.findOne({ where: { id: req.params.id, companyId: req.companyId }, transaction: t });
    if (!branch) throw new NotFoundError("Branch record not found.");
    const before = branch.toJSON();
    await branch.update({ isActive: true }, { transaction: t });
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    await auditService.record(req.companyId, {
      action: "branch.reactivate",
      description: `Branch ${branch.name} reactivated.`,
      user: actor,
      userId: req.user?.id,
      place: branch.name,
      sourceDocument: branch.id,
      severity: "info",
      before: JSON.stringify(before),
      after: JSON.stringify(branch.toJSON())
    }, { transaction: t });
    await t.commit();
    emitEntityChanged(req.companyId, { entity: "Branch", action: "reactivate", id: branch.id, related: { branchId: branch.id } });
    return res.status(200).json({ success: true, data: branch });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

router.delete("/branches/:id", authMiddleware, requirePermission("branches.delete"), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const branch = await models.Branch.findOne({
      where: { id: req.params.id, companyId: req.companyId },
      transaction: t
    });
    if (!branch) throw new NotFoundError("Branch record not found.");

    if (branch.isActive) {
      const activeCount = await models.Branch.count({ where: { companyId: req.companyId, isActive: true }, transaction: t });
      if (activeCount <= 1) throw new ValidationError(lastActiveBranchDeleteMessage(req));
    }

    const linked = await countLinkedRecords([
      ["assets", () => models.Asset.count({ where: { branchId: branch.id, companyId: req.companyId }, transaction: t })],
      ["invoices", () => models.Invoice.count({ where: postedInvoiceWhere({ branchId: branch.id, companyId: req.companyId }), transaction: t })],
      ["transfers", () => models.Transfer.count({ where: { companyId: req.companyId, [Op.or]: [{ fromBranchId: branch.id }, { toBranchId: branch.id }] }, transaction: t })],
      ["payments", () => models.Payment.count({ where: { branchId: branch.id, companyId: req.companyId }, transaction: t })],
      ["treasuryTransactions", () => models.CashTransaction.count({ where: { branchId: branch.id, companyId: req.companyId }, transaction: t })],
      ["journalEntries", () => models.JournalEntry.count({ where: { branchId: branch.id, companyId: req.companyId }, transaction: t })],
      ["employees", () => models.Employee.count({ where: { companyId: req.companyId, [Op.or]: [{ branchId: branch.id }, { branch: branch.name }] }, transaction: t })],
      ["purchaseOrders", () => models.PurchaseOrder.count({ where: { companyId: req.companyId, branch: branch.name }, transaction: t })]
    ]);
    if (Object.keys(linked).length) throw linkedRecordsError(req, "BRANCH_HAS_LINKED_RECORDS", linked);

    const before = branch.toJSON();
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";

    await branch.destroy({ force: true, transaction: t });
    await auditService.record(req.companyId, {
      action: "branch.delete",
      description: `Branch ${branch.name} was deleted.`,
      user: actor,
      userId: req.user?.id,
      place: branch.name,
      sourceDocument: branch.id,
      severity: "critical",
      before: JSON.stringify(before)
    }, { transaction: t });

    await t.commit();
    emitEntityChanged(req.companyId, {
      entity: "Branch",
      action: "delete",
      id: branch.id,
      related: { branchId: branch.id }
    });
    return res.status(200).json({
      success: true,
      data: {
        id: branch.id,
        action: "deleted"
      }
    });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

setupCrud("branches", models.Branch, ["name", "code", "type"]);
setupCrud("transfers", models.Transfer, ["fromBranch", "toBranch", "status"]);
setupCrud("manufacturing-orders", models.ManufacturingOrder, ["status", "type", "branch"]);
setupCrud("customer-gold-pools", models.CustomerGoldPool, ["customerName", "status"]);
setupCrud("inventory-gold-pools", models.InventoryGoldPool, ["source", "status"]);
setupCrud("purchase-orders", models.PurchaseOrder, ["supplierName", "status", "branch"]);
// Search fields must be text columns — `status` is an ENUM and ILIKE cannot be
// applied to it (Postgres: "operator does not exist: enum_invoices_status ~~*"),
// which silently broke invoice search. Search by id / invoiceNumber / customer.
setupCrud("invoices", models.Invoice, ["customerName", "paymentMethod", "invoiceNumber", "id"]);
setupCrud("reservations", models.Reservation, ["customerName", "assetName", "status"]);
setupCrud("approval-requests", models.ApprovalRequest, ["description", "status", "requestedBy"]);

// ─── Manual Balanced Journal Draft (Phase 8D3) ──────────────────────────────
// Safe replacement for the rejected generic POST /journal-entries (Phase 8D1).
// Creates a manual journal entry as a DRAFT ONLY, with balanced debit/credit
// lines. It NEVER posts, NEVER stamps postedAt/postedBy, and NEVER touches
// Account.balance — posting/approval/reversal are separate future phases. The
// validation + creation core lives in journal.service (transaction-driven) and
// does NOT use postingService.postEntry (which posts + moves balances).
// Registered BEFORE setupCrud("journal-entries") so the generic create stays
// rejected and this dedicated path is the only way to create an entry.
router.post(
  "/journal-entries/manual-draft",
  authMiddleware,
  requirePermission("accounting.post"),
  async (req, res, next) => {
    try {
      // companyId ALWAYS from the authenticated request — never the body. Only a
      // real BR-* scope from the validated request context is attached.
      const companyId = req.companyId;
      const branchId =
        typeof req.branchId === "string" && req.branchId.startsWith("BR-") ? req.branchId : null;

      const result = await models.sequelize.transaction((t) =>
        journalService.createManualDraft({
          companyId,
          actor: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System",
          actorId: req.user ? req.user.id : null,
          branchId,
          input: req.body || {},
          transaction: t,
        })
      );

      emitEntityChanged(companyId, { entity: "JournalEntry", action: "create", id: result.id });
      return res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

// ─── Post a Manual Journal Draft (Phase 8D5) ────────────────────────────────
// Transition an EXISTING manual draft (Phase 8D3) to posted, updating
// Account.balance atomically. Delegates to journal.service.postManualDraft,
// which locks the entry row, re-validates, applies the double-entry deltas, and
// flips the same entry to posted — it NEVER creates a new entry and NEVER calls
// postingService.postEntry. Registered before setupCrud so the generic route
// (and its rejected create) never shadows it.
router.post(
  "/journal-entries/:id/post",
  authMiddleware,
  requirePermission("accounting.post"),
  async (req, res, next) => {
    try {
      const result = await models.sequelize.transaction((t) =>
        journalService.postManualDraft({
          id: req.params.id,
          companyId: req.companyId, // always from auth — never the body
          actor: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System",
          actorId: req.user ? req.user.id : null,
          transaction: t,
        })
      );

      emitEntityChanged(req.companyId, { entity: "JournalEntry", action: "update", id: result.id });
      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

// ─── Reverse a Posted Manual Journal Entry (Phase 8D7) ──────────────────────
// Create an accounting-correct reversal: a NEW posted entry with swapped
// debit/credit lines that undoes the original's balance effect, and flip the
// original to "reversed". Delegates to journal.service.reverseManualEntry, which
// locks the original row, validates, never deletes/edits the original lines, and
// never calls postingService.postEntry. Registered before setupCrud.
router.post(
  "/journal-entries/:id/reverse",
  authMiddleware,
  requirePermission("accounting.post"),
  async (req, res, next) => {
    try {
      const result = await models.sequelize.transaction((t) =>
        journalService.reverseManualEntry({
          id: req.params.id,
          companyId: req.companyId, // always from auth — never the body
          actor: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System",
          actorId: req.user ? req.user.id : null,
          transaction: t,
        })
      );

      // Both the new reversal entry and the now-reversed original changed.
      emitEntityChanged(req.companyId, { entity: "JournalEntry", action: "create", id: result.id });
      emitEntityChanged(req.companyId, { entity: "JournalEntry", action: "update", id: result.originalId });
      return res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

// ─── Cancel a Manual Journal Draft (Phase 8D9) ──────────────────────────────
// Hard-delete an UNPOSTED manual draft (status draft, sourceType manual). Safe
// because a draft never moved any Account.balance. Delegates to
// journal.service.cancelManualDraft (locks the row, validates, deletes lines +
// entry, audits) — no balance change, no posting/reversal. Registered before
// setupCrud so it is the only deletion path for journal entries.
router.post(
  "/journal-entries/:id/cancel",
  authMiddleware,
  requirePermission("accounting.post"),
  async (req, res, next) => {
    try {
      const result = await models.sequelize.transaction((t) =>
        journalService.cancelManualDraft({
          id: req.params.id,
          companyId: req.companyId, // always from auth — never the body
          actor: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System",
          actorId: req.user ? req.user.id : null,
          transaction: t,
        })
      );

      emitEntityChanged(req.companyId, { entity: "JournalEntry", action: "delete", id: result.id });
      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

setupCrud("journal-entries", models.JournalEntry, ["id", "description", "date"]);
setupCrud("accounts", models.Account, ["name", "nameAr", "code"]);
// NOTE: audit-logs is intentionally NOT a full CRUD resource — it is
// append-only and immutable. Its read/append/verify routes are defined in the
// "IMMUTABLE AUDIT" custom section below.

// 2. Custom Sub-Resource Route Handlers

router.get("/inventory/products", authMiddleware, requirePermission("inventory.view"), async (req, res, next) => {
  try {
    req.query.pageSize = req.query.pageSize || 10000;
    const controller = new ErpController(models.Product, ["productName", "productCode", "description"]);
    return controller.list(req, res, next);
  } catch (error) {
    next(error);
  }
});

router.get("/pos/products", authMiddleware, requirePermission("pos.sell"), async (req, res, next) => {
  try {
    req.query.pageSize = req.query.pageSize || 10000;
    req.query.filters = JSON.stringify({ isActive: true });
    const controller = new ErpController(models.Product, ["productName", "productCode", "description"]);
    return controller.list(req, res, next);
  } catch (error) {
    next(error);
  }
});

router.get("/products/:id/movements", authMiddleware, requirePermission("inventory.view"), async (req, res, next) => {
  try {
    const movements = await models.StockMovement.findAll({
      where: { productId: req.params.id, companyId: req.companyId },
      order: [["createdAt", "DESC"]]
    });
    return res.status(200).json({ success: true, items: movements, data: { items: movements } });
  } catch (error) {
    next(error);
  }
});

router.get("/products/:id/sales", authMiddleware, requirePermission("inventory.view"), async (req, res, next) => {
  try {
    const sales = await models.InvoiceItem.findAll({
      where: { assetId: req.params.id },
      include: [{
        model: models.Invoice,
        as: "invoice",
        where: { companyId: req.companyId }
      }],
      order: [[{ model: models.Invoice, as: "invoice" }, "createdAt", "DESC"]]
    });
    return res.status(200).json({ success: true, items: sales, data: { items: sales } });
  } catch (error) {
    next(error);
  }
});

router.get("/products/:id/purchases", authMiddleware, requirePermission("inventory.view"), async (req, res, next) => {
  try {
    const purchases = await models.PurchaseOrderItem.findAll({
      where: { assetId: req.params.id },
      include: [{
        model: models.PurchaseOrder,
        as: "purchaseOrder",
        where: { companyId: req.companyId }
      }],
      order: [[{ model: models.PurchaseOrder, as: "purchaseOrder" }, "createdAt", "DESC"]]
    });
    return res.status(200).json({ success: true, items: purchases, data: { items: purchases } });
  } catch (error) {
    next(error);
  }
});

// ─── Supplier Purchase Receiving ───────────────────────────────────────────

router.post(["/purchase-orders/receive", "/supplier-purchases/receive"], authMiddleware, requirePermission("suppliers.create"), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const body = req.body || {};
    const supplierId = body.supplierId;
    const branchId = body.warehouseId || body.branchId || req.headers["x-branch-id"] || req.branchId;
    const items = Array.isArray(body.items) && body.items.length ? body.items : [{
      name: body.itemName || body.assetName,
      description: body.description,
      type: body.stockType || body.assetType,
      category: body.category,
      karat: body.karat,
      quantity: body.quantity,
      weightPerUnit: body.weightPerUnit,
      unitCost: body.unitCost,
      grossWeight: body.grossWeight,
      cost: body.cost,
      price: body.price,
      notes: body.notes
    }];
    const paymentMethod = body.paymentMethod || "credit";
    const paidAmount = Number(body.paidAmount) || 0;
    const now = new Date();
    const dateStr = (body.purchaseDate || body.date || now.toISOString().slice(0, 10));
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";

    // Idempotency: a retried/double-clicked receive returns the original PO
    // (and its stock) instead of receiving the goods twice.
    const idempotencyKey = req.headers["idempotency-key"] || body.idempotencyKey;
    if (idempotencyKey) {
      const existingByKey = await models.PurchaseOrder.findOne({
        where: { idempotencyKey, companyId: req.companyId },
        paranoid: false,
        transaction: t
      });
      if (existingByKey) {
        await t.rollback();
        return res.status(200).json({ success: true, ...existingByKey.toJSON(), data: existingByKey.toJSON() });
      }
    }

    if (!supplierId) throw new ValidationError("المورد مطلوب لاستلام أمر الشراء");
    if (!branchId) throw new ValidationError("الفرع أو المستودع مطلوب لاستلام المشتريات");
    if (!items.length) throw new ValidationError("يجب إضافة بند واحد على الأقل للاستلام");
    if (paidAmount < 0) throw new ValidationError("المبلغ المدفوع لا يمكن أن يكون أقل من صفر");

    const supplier = await models.Supplier.findOne({
      where: { id: supplierId, companyId: req.companyId },
      transaction: t
    });
    if (!supplier) throw new NotFoundError("Supplier record not found.");

    const branch = await models.Branch.findOne({
      where: { id: branchId, companyId: req.companyId, isActive: true },
      transaction: t
    });
    if (!branch) throw new ValidationError("الفرع المحدد غير موجود أو غير نشط");

    const normalizedItems = items.map((item, index) => {
      const quantity = Number(item.quantity);
      const weightPerUnit = Number(item.weightPerUnit ?? item.grossWeight ?? item.weight);
      const unitCost = Number(item.unitCost ?? item.cost ?? item.unitPrice);
      const karat = item.karat == null || item.karat === "" ? null : Number(item.karat);
      const validKarats = new Set([18, 21, 22, 24]);

      if (!item.name) throw new ValidationError(`اسم البند رقم ${index + 1} مطلوب`);
      if (!Number.isFinite(quantity) || quantity <= 0) throw new ValidationError(`كمية البند رقم ${index + 1} غير صحيحة`);
      if (!Number.isInteger(quantity)) throw new ValidationError(`كمية البند رقم ${index + 1} يجب أن تكون رقمًا صحيحًا`);
      if (!Number.isFinite(weightPerUnit) || weightPerUnit <= 0) throw new ValidationError(`وزن الوحدة للبند رقم ${index + 1} غير صحيح`);
      if (!Number.isFinite(unitCost) || unitCost < 0) throw new ValidationError(`سعر التكلفة للبند رقم ${index + 1} غير صحيح`);
      if (karat !== null && !validKarats.has(karat)) throw new ValidationError(`عيار البند رقم ${index + 1} غير صحيح`);
      if (unitCost === 0) {
        throw new ValidationError(`بيانات البند رقم ${index + 1} غير صحيحة`);
      }

      const totalWeight = Math.round(quantity * weightPerUnit * 10000) / 10000;
      const totalCost = Math.round(quantity * unitCost * 100) / 100;
      const purity = item.purity ?? getPurityFromKarat(karat);

      return {
        ...item,
        quantity,
        weightPerUnit,
        totalWeight,
        unitCost,
        totalCost,
        cost: unitCost,
        grossWeight: weightPerUnit,
        netWeight: Number(item.netWeight) || weightPerUnit,
        goldWeight: Number(item.goldWeight) || Number(item.netWeight) || weightPerUnit,
        price: Number(item.price) || Math.round(unitCost * 1.32),
        type: item.type || "gold-piece",
        category: item.category || "Received purchase",
        location: item.location || "Showroom",
        karat,
        purity
      };
    });

    const goodsTotal = Math.round(normalizedItems.reduce((sum, item) => sum + item.totalCost, 0) * 100) / 100;
    const totalWeight = Math.round(normalizedItems.reduce((sum, item) => sum + item.totalWeight, 0) * 10000) / 10000;

    // Phase 12I — compute the purchase VAT / RCM snapshot in the BACKEND at
    // receive time. VAT applies ONLY when explicitly requested (applyVat flag or
    // a DRC/RCM flag) AND vatEnabled in settings; otherwise the default path is
    // byte-identical to before (no VAT, Case A). Settings supply the defaults for
    // the requested values. `goodsTotal` (sum of item costs) is the pre-VAT base.
    const settings = await settingsService.getCompanySettings(req.companyId, { transaction: t });
    const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
    const rcmRequested = Boolean(body.isRcm || body.isDRC || body.reverseVat || body.useReverseCharge);
    const vatRequested = (rcmRequested || body.applyVat === true) && settings.vatEnabled !== false;

    let taxBaseSnap = 0, vatRateSnap = 0, inputVatSnap = 0, taxIncludedSnap = false;
    let isRecoverableSnap = true, isRcmSnap = false, rcmVatSnap = 0, rcmRateSnap = 0;
    let total = goodsTotal; // amount payable to the supplier (gross for normal VAT; taxBase for RCM/no-VAT)

    if (vatRequested && rcmRequested) {
      // Case D — RCM/DRC: supplier price carries NO VAT; buyer self-accounts (net-zero).
      const rcmRate = Number(body.rcmRate ?? body.vatRate ?? settings.purchaseVatRate ?? settings.vatRate ?? 0);
      if (!Number.isFinite(rcmRate) || rcmRate <= 0 || rcmRate > 100) throw new ValidationError("RCM purchase requires a valid rcmRate between 0 and 100");
      if (body.isRecoverable === false) throw new ValidationError("RCM purchase cannot be non-recoverable");
      if (Number(body.inputVatAmount) > 0) throw new ValidationError("RCM purchase must not carry ordinary input VAT");
      isRcmSnap = true;
      isRecoverableSnap = true;
      taxBaseSnap = goodsTotal;
      rcmRateSnap = rcmRate;
      vatRateSnap = rcmRate;
      rcmVatSnap = r2(taxBaseSnap * rcmRate / 100);
      inputVatSnap = 0;
      total = taxBaseSnap; // PO.total = taxBase (no VAT paid to supplier under RCM)
    } else if (vatRequested) {
      // Case B/C — ordinary purchase VAT.
      const vatRate = Number(body.vatRate ?? settings.purchaseVatRate ?? settings.vatRate ?? 0);
      if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) throw new ValidationError("Purchase vatRate must be a finite number between 0 and 100");
      if (vatRate > 0) {
        vatRateSnap = vatRate;
        taxIncludedSnap = Boolean(body.taxIncluded ?? settings.purchaseTaxIncludedDefault ?? false);
        isRecoverableSnap = Boolean(body.isRecoverable ?? settings.purchaseVatRecoverableDefault ?? true);
        if (taxIncludedSnap) {
          // inclusive: goodsTotal is the GROSS; back out the base.
          taxBaseSnap = r2(goodsTotal / (1 + vatRate / 100));
          inputVatSnap = r2(goodsTotal - taxBaseSnap);
          total = goodsTotal;
        } else {
          // exclusive: goodsTotal is the genuine pre-VAT base; VAT added on top.
          taxBaseSnap = goodsTotal;
          inputVatSnap = r2(taxBaseSnap * vatRate / 100);
          total = r2(taxBaseSnap + inputVatSnap);
        }
      }
      // vatRate == 0 → leave defaults (Case A); total stays goodsTotal.
    }
    // else: no VAT requested → defaults; total = goodsTotal (Case A unchanged).

    const remainingAmount = Math.round((total - paidAmount) * 100) / 100;
    const paymentStatus = remainingAmount <= 0 ? "paid" : paidAmount > 0 ? "partial" : "unpaid";

    if (total <= 0) throw new ValidationError("إجمالي أمر الشراء يجب أن يكون أكبر من صفر");
    if (paidAmount > total) throw new ValidationError("المبلغ المدفوع لا يمكن أن يتجاوز إجمالي الشراء");

    const purchaseOrderId = body.id || `PO-${Date.now()}`;
    const existingPurchaseOrder = await models.PurchaseOrder.findOne({
      where: { id: purchaseOrderId, companyId: req.companyId },
      paranoid: false,
      transaction: t
    });
    if (existingPurchaseOrder?.status === "received") {
      throw new ValidationError("Purchase already received.");
    }
    if (existingPurchaseOrder) {
      throw new ValidationError("Purchase order already exists.");
    }

    const drcNote = body.isDRC || body.reverseVat || body.useReverseCharge
      ? "DRC reverse VAT applied."
      : "DRC reverse VAT not applied.";
    const purchaseOrder = await models.PurchaseOrder.create({
      id: purchaseOrderId,
      companyId: req.companyId,
      supplierId: supplier.id,
      supplierName: supplier.name,
      status: "received",
      date: dateStr,
      expectedDate: body.expectedDate || null,
      receivedDate: body.receivedDate || dateStr,
      total,
      // Phase 12I — purchase VAT / RCM snapshot (source of truth for posting +
      // VAT report). Defaults when no VAT was requested → Case A.
      taxBase: taxBaseSnap,
      vatRate: vatRateSnap,
      inputVatAmount: inputVatSnap,
      taxIncluded: taxIncludedSnap,
      isRecoverable: isRecoverableSnap,
      isRcm: isRcmSnap,
      rcmVatAmount: rcmVatSnap,
      rcmRate: rcmRateSnap,
      branch: branch.name,
      notes: [body.notes, drcNote, `Payment: ${paymentStatus}`, `Total weight: ${totalWeight}g`].filter(Boolean).join(" | "),
      isConsignment: Boolean(body.isConsignment ?? supplier.isConsignment),
      idempotencyKey: idempotencyKey || null
    }, { transaction: t });

    const createdAssets = [];
    const createdItems = [];
    let hasProducts = false;

    // Phase 15E — gold cost snapshot wiring. Records a Gold-Center snapshot +
    // metadata alongside the UNCHANGED legacy cost (book cost / posting are not
    // touched here). `manual` mode never needs a price; hybrid/gold_center try to
    // compute and degrade gracefully when price/karat/weight are missing
    // (strict enforcement is deferred). Prices are cached per karat.
    const goldCostSource = settings.goldCostSource || "hybrid";
    const goldWeightBasis = settings.goldCostWeightBasis || "net";
    const karatPriceCache = new Map();
    const perGramFor = async (karat) => {
      if (goldCostSource === "manual" || karat == null || karat === "") return null;
      const key = String(karat);
      if (karatPriceCache.has(key)) return karatPriceCache.get(key);
      let val = null;
      try {
        const p = await effectiveKaratPrice(req.companyId, settings.currency, karat);
        if (p != null && Number.isFinite(Number(p)) && Number(p) > 0) val = Number(p);
      } catch { val = null; }
      karatPriceCache.set(key, val);
      return val;
    };

    // Phase 15F — controlled override governance. An override is an EXPLICIT
    // request action (body/item.goldCostOverride). Without it the 15E snapshot is
    // recorded as-is (no governance). A genuine divergence from the computed
    // reference requires: allowGoldCostOverride + the override permission + a
    // reason, and is audited (gold_cost.override). Adopting the computed value is
    // NOT an override. NOTHING legacy (Asset.cost/averageCost/posting) changes.
    const permissionService = require("../services/permission.service");
    const overridePermName = settings.goldCostOverridePermission || "goldCost.override";
    let _permChecked = false, _permVal = false;
    const hasOverridePerm = async () => {
      if (!_permChecked) { _permVal = await permissionService.userHasPermission(req.user, overridePermName); _permChecked = true; }
      return _permVal;
    };
    const overrideAudited = new Set();
    const governSnapshot = async (builtSnap, item, itemIndex) => {
      if (goldCostSource === "manual") return builtSnap;
      const overrideInput = item.goldCostOverride ?? (normalizedItems.length === 1 ? body.goldCostOverride : undefined);
      const cls = goldCostService.classifyOverride({ overrideInput, computedGoldCost: builtSnap.computedGoldCost });
      if (!cls.provided) return builtSnap;
      if (cls.invalid) throw new ValidationError("Gold cost override must be a non-negative number");
      if (!cls.isOverride) return goldCostService.applyOverride(builtSnap, { value: cls.value, isOverride: false });
      // genuine override → governance
      if (settings.allowGoldCostOverride === false) throw new ForbiddenError("Gold cost override is disabled for this company");
      if (!(await hasOverridePerm())) throw new ForbiddenError("You do not have permission to override gold cost");
      const reason = item.overrideReason ?? body.goldCostOverrideReason;
      if (!reason || !String(reason).trim()) throw new ValidationError("Override reason is required to change the gold cost");
      if (!overrideAudited.has(itemIndex)) {
        overrideAudited.add(itemIndex);
        await auditService.record(req.companyId, {
          action: "gold_cost.override",
          description: `Gold cost override on PO ${purchaseOrderId} item ${itemIndex + 1}`,
          user: actor,
          userId: req.user ? req.user.id : null,
          place: branch.name,
          branch: branch.name,
          sourceDocument: purchaseOrderId,
          severity: "warning",
          before: JSON.stringify({ computedGoldCost: builtSnap.computedGoldCost, finalBefore: builtSnap.finalPurchaseCost }),
          after: JSON.stringify({ finalPurchaseCost: cls.value, reason: String(reason).trim() }),
        }, { transaction: t });
      }
      return goldCostService.applyOverride(builtSnap, { value: cls.value, isOverride: true, reason: String(reason).trim(), by: req.user ? req.user.id : "System" });
    };

    // Phase 15G — non-recoverable VAT capitalisation (forward-only). When VAT is
    // non-recoverable & exclusive, the legacy unit cost is net while GL inventory
    // is gross — so we add the allocated VAT into the BOOK cost (Asset.cost /
    // Product.averageCost input / StockMovement cost) to reconcile with GL.
    // Inclusive VAT is already gross in the entered cost (no change). Recoverable
    // / RCM / no-VAT keep the legacy cost. computedGoldCost stays reference-only.
    const capitalizeNrVat = vatRequested && !isRcmSnap && isRecoverableSnap === false
      && !taxIncludedSnap && Number(inputVatSnap) > 0 && settings.nonRecoverableVatCapitalization !== false;
    const nrVatPerLine = capitalizeNrVat
      ? goldCostService.allocateNonRecoverableVat({ lineNetCosts: normalizedItems.map((it) => it.totalCost), inputVatAmount: inputVatSnap })
      : normalizedItems.map(() => 0);

    for (let itemIndex = 0; itemIndex < normalizedItems.length; itemIndex++) {
      const item = normalizedItems[itemIndex];
      // Phase 15G — capitalised cost (= legacy + allocated non-recoverable VAT;
      // equals legacy when capitalisation does not apply).
      const allocVatLine = nrVatPerLine[itemIndex] || 0;
      const allocVatPerUnit = item.quantity > 0 ? allocVatLine / item.quantity : 0;
      const capUnitCost = goldCostService.round4(item.unitCost + allocVatPerUnit);
      const capLineCost = goldCostService.round4(item.totalCost + allocVatLine);
      // Per-unit gold weight by the configured basis (net default).
      const perUnitGoldWeight = goldWeightBasis === "gross"
        ? (Number(item.weightPerUnit ?? item.netWeight) || 0)
        : (Number(item.goldWeight ?? item.netWeight ?? item.weightPerUnit) || 0);
      const itemKarat = item.karat == null || item.karat === "" ? null : item.karat;
      const itemPerGram = await perGramFor(itemKarat);
      if (item.productCode) {
        hasProducts = true;
        const productCode = String(item.productCode).trim();
        let product = await models.Product.findOne({
          where: { companyId: req.companyId, productCode },
          lock: true,
          transaction: t
        });

        const currentQty = product ? Number(product.quantityOnHand) : 0;
        const currentAvgCost = product ? Number(product.averageCost) : 0;
        const newQty = currentQty + item.quantity;
        // Phase 15G — weighted-average input uses the capitalised unit cost
        // (= legacy unit cost unless non-recoverable VAT capitalisation applies).
        const newAvgCost = newQty > 0 ? ((currentAvgCost * currentQty) + (capUnitCost * item.quantity)) / newQty : capUnitCost;
        const totalWeight = product ? Number(product.totalWeight) : 0;
        const newWeight = totalWeight + item.totalWeight;

        if (product) {
          await product.update({
            quantityOnHand: Number(product.quantityOnHand) + item.quantity,
            quantityAvailable: Number(product.quantityAvailable) + item.quantity,
            totalWeight: newWeight,
            averageCost: newAvgCost,
            averageUnitWeight: newQty > 0 ? (newWeight / newQty) : item.weightPerUnit,
            unitCost: capUnitCost,
            salePrice: item.price || product.salePrice
          }, { transaction: t, skipAdjustmentHook: true });
        } else {
          const productId = `PRD-ID-${Date.now()}-${itemIndex}-${Math.random().toString(36).slice(2, 6)}`;
          product = await models.Product.create({
            id: productId,
            companyId: req.companyId,
            productCode,
            productName: item.name,
            description: item.description || `Created via PO ${purchaseOrderId}`,
            karat: item.karat,
            stockType: item.type,
            branchId: branch.id,
            branchName: branch.name,
            quantityOnHand: item.quantity,
            quantityAvailable: item.quantity,
            quantitySold: 0,
            quantityReserved: 0,
            totalWeight: item.totalWeight,
            averageUnitWeight: item.weightPerUnit,
            unitCost: capUnitCost,
            averageCost: capUnitCost,
            salePrice: item.price,
            isActive: true
          }, { transaction: t });
        }

        // Create Stock Movement
        await models.StockMovement.create({
          id: `SM-${Date.now()}-${itemIndex}-${Math.random().toString(36).slice(2, 6)}`,
          companyId: req.companyId,
          productId: product.id,
          productCode: product.productCode,
          type: "purchase_receive",
          quantityIn: item.quantity,
          quantityOut: 0,
          weightIn: item.totalWeight,
          weightOut: 0,
          // Phase 15G — capitalised cost (legacy unless non-recoverable VAT).
          unitCost: capUnitCost,
          totalCost: capLineCost,
          referenceType: "PurchaseOrder",
          referenceId: purchaseOrderId,
          supplierId,
          branchId: branch.id,
          createdBy: actor
        }, { transaction: t });

        // Create PurchaseOrderItem — link to the PRODUCT (not assets). Putting a
        // product id into asset_id violated purchase_order_items_asset_id_fkey.
        const poItem = await models.PurchaseOrderItem.create({
          id: `POI-${Date.now()}-${itemIndex + 1}-1`,
          purchaseOrderId,
          assetId: null,
          productId: product.id,
          description: item.name,
          quantity: item.quantity,
          unit: item.unit || "قطعة",
          unitPrice: item.unitCost,
          total: item.totalCost,
          receivedQuantity: item.quantity,
          // Phase 15E snapshot + 15F governed override + 15G capitalised book cost
          // (legacy unitPrice/total unchanged; finalPurchaseCost = capitalised).
          ...(await governSnapshot(goldCostService.buildGoldCostSnapshot({
            goldCostSource, weight: perUnitGoldWeight * item.quantity, karat: itemKarat,
            perGram: itemPerGram, currentCost: capLineCost,
          }), item, itemIndex))
        }, { transaction: t });

        createdAssets.push(product.toJSON());
        createdItems.push(poItem.toJSON());
      } else {
        // Phase 15F — one governed snapshot per item (item.cost === item.unitCost
        // for the asset path, so it applies to both the Asset and its poItem).
        // Phase 15G — currentCost = capitalised per-piece cost (legacy unless
        // non-recoverable VAT capitalisation applies).
        const assetSnap = await governSnapshot(goldCostService.buildGoldCostSnapshot({
          goldCostSource, weight: perUnitGoldWeight, karat: itemKarat,
          perGram: itemPerGram, currentCost: capUnitCost,
        }), item, itemIndex);
        for (let qtyIndex = 0; qtyIndex < item.quantity; qtyIndex++) {
          const sequence = item.quantity > 1 ? `-${qtyIndex + 1}` : "";
          const assetId = item.quantity === 1 && item.assetId
            ? item.assetId
            : `AST-PUR-${Date.now()}-${itemIndex + 1}-${qtyIndex + 1}-${Math.random().toString(36).slice(2, 6)}`;
          const barcode = item.barcode || String(Date.now() + itemIndex + qtyIndex).slice(-13).padStart(13, "6");
          const asset = await models.Asset.create({
            id: assetId,
            companyId: req.companyId,
            name: item.quantity > 1 ? `${item.name} ${qtyIndex + 1}` : item.name,
            type: item.type,
            category: item.category,
            karat: item.karat || null,
            purity: item.purity || null,
            grossWeight: item.weightPerUnit,
            netWeight: item.netWeight,
            goldWeight: item.goldWeight || item.netWeight,
            price: item.price,
            // Phase 15G — capitalised book cost (legacy unless non-recoverable VAT).
            cost: capUnitCost,
            branch: branch.name,
            branchId: branch.id,
            location: item.location,
            status: "available",
            barcode,
            source: "supplier_purchase",
            notes: [item.notes, body.notes, `Supplier: ${supplier.name}`, `Purchase: ${purchaseOrderId}`, drcNote].filter(Boolean).join(" | "),
            // Phase 15E snapshot + Phase 15F governed override (legacy Asset.cost
            // unchanged).
            ...assetSnap
          }, { transaction: t });
          createdAssets.push(asset.toJSON());

          await models.AssetEvent.create({
            id: `ASE-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            assetId,
            action: "PURCHASE_RECEIVED",
            date: dateStr,
            user: actor,
            branch: branch.name,
            note: `تم استلام الأصل من المورد ${supplier.name} بموجب أمر الشراء ${purchaseOrderId}`,
            sourceDocument: purchaseOrderId,
            severity: "info"
          }, { transaction: t });

          const poItem = await models.PurchaseOrderItem.create({
            id: `POI-${Date.now()}-${itemIndex + 1}-${qtyIndex + 1}`,
            purchaseOrderId,
            assetId, // a real assets.id created just above
            productId: null,
            description: item.name,
            quantity: 1,
            unit: item.unit || "قطعة",
            unitPrice: item.unitCost,
            total: item.unitCost,
            receivedQuantity: 1,
            // Phase 15E snapshot + Phase 15F governed override (same governed
            // snapshot as the asset; item.cost === item.unitCost here).
            ...assetSnap
          }, { transaction: t });
          createdItems.push(poItem.toJSON());
        }
      }
    }

    // Phase 10M: Supplier.due is FROZEN. It is no longer incremented on receive —
    // it was an unreliable running figure (increment-only, never reduced). The
    // supplier sub-ledger statement (received POs minus supplier_purchase
    // payments) is now the source of truth for the payable balance, so we leave
    // `due` untouched here as a legacy/reference field. `remainingAmount` and the
    // accounting posting below are unchanged.
    await supplier.update({ lastOrder: dateStr }, { transaction: t });

    const journalEntry = await postingService.postPurchaseEntry(
      purchaseOrder.toJSON(),
      paidAmount,
      paymentMethod,
      actor,
      // Pass the normalized items (karat + totalCost) so the inventory debit can
      // split by karat when accountingByKarat is on (no-op when off). Phase 12I:
      // pass the settings account codes so Input VAT / RCM post to the configured
      // accounts (defaults 1400/2210 when settings are absent).
      {
        transaction: t,
        branchId: branch.id,
        items: normalizedItems,
        inputVatAccountCode: settings.inputVatAccountCode,
        rcmOutputAccountCode: settings.rcmOutputAccountCode,
      }
    );

    let treasuryTransaction = null;
    if (paidAmount > 0) {
      const account = String(paymentMethod).toLowerCase().includes("card") ||
        String(paymentMethod).toLowerCase().includes("bank") ||
        String(paymentMethod).toLowerCase().includes("transfer") ||
        String(paymentMethod).toLowerCase().includes("تحويل")
        ? "bank"
        : "cash";
      const tx = await models.CashTransaction.create({
        id: `TX-PO-${Date.now()}`,
        companyId: req.companyId,
        type: "cash_out",
        account,
        amount: paidAmount,
        category: "supplier_purchase",
        counterAccountCode: "1200",
        description: `دفع للمورد ${supplier.name} عن أمر الشراء ${purchaseOrderId}`,
        reference: purchaseOrderId,
        branch: branch.name,
        branchId: branch.id,
        date: dateStr,
        createdBy: actor,
        status: "posted",
        journalEntryId: journalEntry.id
      }, { transaction: t });
      treasuryTransaction = tx.toJSON();
    }

    await auditService.record(req.companyId, {
      action: "purchase.receive",
      description: `Received purchase order ${purchaseOrderId} from supplier ${supplier.name}`,
      user: actor,
      userId: req.user?.id,
      place: branch.name,
      branch: branch.name,
      sourceDocument: purchaseOrderId,
      severity: "info",
      after: JSON.stringify({
        purchaseOrderId,
        assetIds: createdAssets.map((asset) => asset.id),
        total,
        paidAmount,
        remainingAmount,
        paymentStatus,
        totalWeight,
        isDRC: Boolean(body.isDRC || body.reverseVat || body.useReverseCharge),
        // Phase 12I — tax snapshot persisted on the PO (source of truth).
        tax: { taxBase: taxBaseSnap, vatRate: vatRateSnap, inputVatAmount: inputVatSnap, taxIncluded: taxIncludedSnap, isRecoverable: isRecoverableSnap, isRcm: isRcmSnap, rcmVatAmount: rcmVatSnap, rcmRate: rcmRateSnap }
      })
    }, { transaction: t });

    const notification = await notificationService.createNotification(req.companyId, {
      title: "Supplier purchase received",
      message: `Purchase order ${purchaseOrderId} was received from ${supplier.name}.`,
      type: "success",
      entityType: "PurchaseOrder",
      entityId: purchaseOrderId
    }, { transaction: t });

    const updatedSupplier = await models.Supplier.findByPk(supplier.id, { transaction: t });

    await t.commit();

    emitEntityChanged(req.companyId, {
      entity: "PurchaseOrder",
      action: "receive",
      id: purchaseOrderId,
      branchId: branch.id,
      related: {
        supplierId: supplier.id,
        purchaseOrderId,
        assetIds: hasProducts ? [] : createdAssets.map((asset) => asset.id),
        productIds: hasProducts ? createdAssets.map((asset) => asset.id) : [],
        warehouseId: body.warehouseId || null
      }
    });
    emitEntityChanged(req.companyId, {
      entity: "Supplier",
      action: "update",
      id: supplier.id,
      branchId: branch.id,
      related: { supplierId: supplier.id, purchaseOrderId }
    });
    if (hasProducts) {
      emitEntityChanged(req.companyId, {
        entity: "Product",
        action: "create",
        id: createdAssets[0]?.id || null,
        branchId: branch.id,
        related: {
          supplierId: supplier.id,
          purchaseOrderId,
          productIds: createdAssets.map((asset) => asset.id)
        }
      });
      emitEntityChanged(req.companyId, {
        entity: "StockMovement",
        action: "create",
        id: purchaseOrderId,
        branchId: branch.id,
        related: { supplierId: supplier.id, purchaseOrderId }
      });
    } else {
      emitEntityChanged(req.companyId, {
        entity: "Asset",
        action: "create",
        id: createdAssets[0]?.id || null,
        branchId: branch.id,
        related: {
          supplierId: supplier.id,
          purchaseOrderId,
          assetIds: createdAssets.map((asset) => asset.id)
        }
      });
    }
    emitEntityChanged(req.companyId, {
      entity: "Accounting",
      action: "create",
      id: journalEntry.id,
      branchId: branch.id,
      related: { supplierId: supplier.id, purchaseOrderId }
    });
    if (treasuryTransaction) {
      emitEntityChanged(req.companyId, {
        entity: "Treasury",
        action: "create",
        id: treasuryTransaction.id,
        branchId: branch.id,
        related: { supplierId: supplier.id, purchaseOrderId }
      });
    }
    emitEntityChanged(req.companyId, {
      entity: "Notification",
      action: "create",
      id: notification.id,
      related: { supplierId: supplier.id, purchaseOrderId }
    });
    emitEntityChanged(req.companyId, {
      entity: "AuditLog",
      action: "create",
      id: purchaseOrderId,
      related: { supplierId: supplier.id, purchaseOrderId }
    });

    const output = {
      purchaseOrder: {
        ...purchaseOrder.toJSON(),
        items: createdItems,
        totalWeight,
        paidAmount,
        remainingAmount,
        paymentStatus
      },
      supplier: updatedSupplier?.toJSON(),
      assets: createdAssets,
      journalEntry,
      treasuryTransaction,
      notification: notification.toJSON()
    };
    return res.status(201).json({ success: true, ...output, data: output });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SUPPLIER PURCHASE PAYMENT (سداد مورد ضد أمر شراء) — Phase 10J.
// Pay a received purchase order: records a cash_out CashTransaction
// (category "supplier_purchase", reference = PO id, counterAccountCode "2100")
// and posts the journal Dr Accounts Payable (2100) / Cr Cash|Bank via the
// posting engine — all in ONE transaction with a full rollback on any error.
// paidSoFar is computed from existing supplier_purchase cash-outs for the PO to
// block overpayment; Idempotency-Key blocks double payment. Supplier.due is
// NEVER touched (it stays reference-only; the supplier statement / closing
// balance is the source of truth and picks up this payment automatically).
// ─────────────────────────────────────────────────────────────────────────────
router.post("/purchase-orders/:id/pay", authMiddleware, requirePermission("treasury.update"), async (req, res, next) => {
  const b = req.body || {};
  const idempotencyKey = req.headers["idempotency-key"] || b.idempotencyKey;
  if (!idempotencyKey || !String(idempotencyKey).trim()) {
    return next(new ValidationError("Idempotency-Key header is required for supplier payments."));
  }

  // Idempotency replay/conflict check BEFORE opening the write transaction.
  const existing = await models.CashTransaction.findOne({
    where: { companyId: req.companyId, idempotencyKey: String(idempotencyKey) },
  });
  if (existing) {
    const sameOperation =
      existing.type === "cash_out" &&
      existing.category === "supplier_purchase" &&
      existing.reference === req.params.id &&
      Math.abs(Number(existing.amount) - Number(b.amount)) <= 0.01;
    if (sameOperation) {
      const out = existing.toJSON();
      return res.status(200).json({ success: true, data: out, meta: { idempotentReplay: true } });
    }
    return next(new ConflictError("Idempotency-Key already used for a different operation."));
  }

  const t = await models.sequelize.transaction();
  try {
    // 1. Lock the PO row inside the transaction (serializes concurrent payments).
    const po = await models.PurchaseOrder.findOne({
      where: { id: req.params.id, companyId: req.companyId },
      lock: t.LOCK.UPDATE,
      transaction: t,
    });
    if (!po) throw new NotFoundError("Purchase order not found.");

    // 2. Eligibility — only a fully received, non-consignment PO can be paid.
    if (po.status !== "received") {
      throw new ValidationError(`Only received purchase orders can be paid; PO ${po.id} is "${po.status}".`);
    }
    if (po.isConsignment === true) {
      throw new ValidationError("Consignment purchase orders cannot be paid here.");
    }

    // 3. Amount + account validation.
    const amount = round4(b.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new ValidationError("Payment amount must be a finite number greater than zero.");
    }
    const account = b.account === "bank" ? "bank" : "cash";
    const date = b.date && isValidYmd(String(b.date)) ? String(b.date) : new Date().toISOString().slice(0, 10);
    if (b.date && !isValidYmd(String(b.date))) {
      throw new ValidationError("Invalid 'date' (expected YYYY-MM-DD).");
    }

    // 4. paidSoFar from existing supplier-payment cash-outs for THIS PO.
    const paidAgg = await models.CashTransaction.findOne({
      attributes: [[models.sequelize.fn("COALESCE", models.sequelize.fn("SUM", models.sequelize.col("amount")), 0), "paid"]],
      where: { companyId: req.companyId, type: "cash_out", category: "supplier_purchase", reference: po.id },
      transaction: t,
      raw: true,
    });
    const paidSoFarBefore = round4(paidAgg ? paidAgg.paid : 0);
    const total = round4(po.total);
    const remainingBefore = round4(total - paidSoFarBefore);

    // 5. Overpayment / nothing-due guards.
    if (remainingBefore <= 0.01) {
      throw new ValidationError(`Purchase order ${po.id} is already fully paid (paid ${paidSoFarBefore} of ${total}).`);
    }
    if (amount > remainingBefore + 0.01) {
      throw new ValidationError(`Overpayment rejected: amount ${amount} exceeds remaining ${remainingBefore} for PO ${po.id}.`);
    }

    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";

    // 6. Create the cash-out (AP counter) and post Dr 2100 / Cr cash|bank.
    const cashTxId = `TX-PAY-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const cashTx = await models.CashTransaction.create({
      id: cashTxId,
      companyId: req.companyId,
      type: "cash_out",
      account,
      amount,
      category: "supplier_purchase",
      counterAccountCode: "2100", // Accounts Payable — Dr AP / Cr cash|bank
      description: b.note ? String(b.note) : `سداد للمورّد عن أمر الشراء ${po.id}`,
      reference: po.id,
      branch: po.branch || req.branchId || "Main Branch",
      branchId: req.branchId && String(req.branchId).startsWith("BR-") ? req.branchId : null,
      date,
      createdBy: actor,
      status: "posted",
      idempotencyKey: String(idempotencyKey),
    }, { transaction: t });

    const journalEntry = await postingService.postCashEntry(cashTx.toJSON(), actor, { transaction: t });
    await cashTx.update({ journalEntryId: journalEntry.id }, { transaction: t });

    const paidSoFarAfter = round4(paidSoFarBefore + amount);
    const remainingAfter = round4(total - paidSoFarAfter);

    // 7. Audit inside the same transaction. Supplier.due is NOT modified.
    await auditService.record(req.companyId, {
      action: "supplier.payment",
      description: `Supplier payment ${amount} for PO ${po.id} (${po.supplierName || po.supplierId})`,
      user: actor,
      userId: req.user ? req.user.id : null,
      place: po.branch,
      branch: po.branch,
      sourceDocument: po.id,
      severity: "info",
      before: JSON.stringify({ purchaseOrderId: po.id, supplierId: po.supplierId, total, paidSoFarBefore, remainingBefore }),
      after: JSON.stringify({ purchaseOrderId: po.id, supplierId: po.supplierId, amount, paidSoFarAfter, remainingAfter, cashTransactionId: cashTx.id, journalEntryId: journalEntry.id }),
    }, { transaction: t });

    await t.commit();

    emitEntityChanged(req.companyId, { entity: "Treasury", action: "create", id: cashTx.id, related: { supplierId: po.supplierId, purchaseOrderId: po.id } });
    emitEntityChanged(req.companyId, { entity: "Accounting", action: "create", id: journalEntry.id, related: { supplierId: po.supplierId, purchaseOrderId: po.id } });

    // Reference-only supplier due (never used for the computation, never written).
    const supplierRow = await models.Supplier.findByPk(po.supplierId);

    const output = {
      purchaseOrder: { id: po.id, supplierId: po.supplierId, total },
      payment: {
        id: cashTx.id,
        amount,
        account,
        category: "supplier_purchase",
        reference: po.id,
        journalEntryId: journalEntry.id,
        idempotencyKey: String(idempotencyKey),
      },
      paidSoFarBefore,
      paidSoFarAfter,
      remainingAfter,
      supplierDueReference: supplierRow ? round4(supplierRow.due) : null,
    };
    return res.status(201).json({
      success: true,
      data: output,
      meta: { readBySupplierStatement: true, supplierDueUpdated: false },
    });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

// ─── Company Settings ───────────────────────────────────────────────────────

router.get("/settings", authMiddleware, requirePermission("settings.view"), async (req, res, next) => {
  try {
    const normalized = await settingsService.getCompanySettings(req.companyId);
    return res.status(200).json({
      success: true,
      data: {
        company: normalized.company,
        settings: normalized._raw, // raw key/value map (frontend parses this)
        currency: normalized.currency,
        receipt: normalized.receipt,
        vatRate: normalized.vatRate,
        // Phase 12E foundation — purchase VAT / RCM config (read-only; no posting
        // consumes these yet).
        vatEnabled: normalized.vatEnabled,
        purchaseVatRate: normalized.purchaseVatRate,
        purchaseTaxIncludedDefault: normalized.purchaseTaxIncludedDefault,
        purchaseVatRecoverableDefault: normalized.purchaseVatRecoverableDefault,
        inputVatAccountCode: normalized.inputVatAccountCode,
        rcmOutputAccountCode: normalized.rcmOutputAccountCode,
        // Phase 15C foundation — gold cost config (read-only; no consumer yet).
        goldCostSource: normalized.goldCostSource,
        goldCostWeightBasis: normalized.goldCostWeightBasis,
        allowGoldCostOverride: normalized.allowGoldCostOverride,
        goldCostOverridePermission: normalized.goldCostOverridePermission,
        nonRecoverableVatCapitalization: normalized.nonRecoverableVatCapitalization,
        lowStockThreshold: normalized.lowStockThreshold,
        decimalPrecision: normalized.decimalPrecision,
        installment: normalized.installment
      }
    });
  } catch (error) {
    next(error);
  }
});

router.patch("/settings", authMiddleware, requirePermission("settings.update"), async (req, res, next) => {
  try {
    const body = req.body || {};

    // Phase 12E: validate the purchase-VAT / RCM foundation keys when present.
    // Scoped to these keys only — no general settings refactor. These are a
    // read-only foundation (no posting consumes them yet), but we still reject
    // obviously bad values so 12F can trust them.
    const isBoolVal = (v) => typeof v === "boolean";
    const isNonEmptyStr = (v) => typeof v === "string" && v.trim() !== "";
    const reject = (msg) => res.status(422).json({ success: false, message: msg });
    for (const k of ["vatEnabled", "purchaseTaxIncludedDefault", "purchaseVatRecoverableDefault"]) {
      if (body[k] !== undefined && !isBoolVal(body[k])) return reject(`${k} must be a boolean`);
    }
    if (body.purchaseVatRate !== undefined) {
      const n = Number(body.purchaseVatRate);
      if (body.purchaseVatRate === "" || body.purchaseVatRate === null || !Number.isFinite(n) || n < 0 || n > 100) {
        return reject("purchaseVatRate must be a finite number between 0 and 100");
      }
    }
    for (const k of ["inputVatAccountCode", "rcmOutputAccountCode"]) {
      if (body[k] !== undefined && !isNonEmptyStr(body[k])) return reject(`${k} must be a non-empty string`);
    }

    // Phase 15C: validate the gold-cost foundation keys when present (scoped;
    // read-only foundation — no calculation consumes them yet).
    if (body.goldCostSource !== undefined && !["manual", "gold_center", "hybrid"].includes(body.goldCostSource)) {
      return reject("goldCostSource must be one of: manual, gold_center, hybrid");
    }
    if (body.goldCostWeightBasis !== undefined && !["net", "gross"].includes(body.goldCostWeightBasis)) {
      return reject("goldCostWeightBasis must be one of: net, gross");
    }
    for (const k of ["allowGoldCostOverride", "nonRecoverableVatCapitalization"]) {
      if (body[k] !== undefined && !isBoolVal(body[k])) return reject(`${k} must be a boolean`);
    }
    if (body.goldCostOverridePermission !== undefined && !isNonEmptyStr(body.goldCostOverridePermission)) {
      return reject("goldCostOverridePermission must be a non-empty string");
    }

    const companyUpdates = {};
    for (const key of ["businessName", "logo", "currency", "branchName", "taxNumber"]) {
      if (body[key] !== undefined) companyUpdates[key] = body[key];
    }
    if (companyUpdates.currency !== undefined) {
      const { normalizeCurrencyCode } = require("../utils/currency");
      companyUpdates.currency = normalizeCurrencyCode(companyUpdates.currency);
    }
    if (Object.keys(companyUpdates).length) {
      await models.Company.update(companyUpdates, { where: { id: req.companyId } });
    }

    const settingKeys = ["language", "theme", "vatRate", "goldKaratDefaults", "goldPricingMode", "accountingByKarat", "invoicePrefix", "invoiceNumbering", "dateFormat", "decimalPrecision", "print", "notifications", "lowStockThreshold", "receipt", "allowZeroDownPayment", "paymentMethods", "installmentEnabled", "installmentDefaultFrequency", "installmentMaxCount", "installmentMinDownPaymentPercent", "barcode", "vatEnabled", "purchaseVatRate", "purchaseTaxIncludedDefault", "purchaseVatRecoverableDefault", "inputVatAccountCode", "rcmOutputAccountCode", "goldCostSource", "goldCostWeightBasis", "allowGoldCostOverride", "goldCostOverridePermission", "nonRecoverableVatCapitalization"];
    for (const key of settingKeys) {
      if (body[key] === undefined) continue;
      const [row, created] = await models.Setting.findOrCreate({
        where: { companyId: req.companyId, key },
        defaults: { companyId: req.companyId, key, value: body[key] }
      });
      if (!created) await row.update({ value: body[key] });
    }

    await auditService.record(req.companyId, {
      action: "settings.update",
      description: "Settings updated",
      user: `${req.user.firstName} ${req.user.lastName}`,
      userId: req.user.id,
      place: req.branchId || "System",
      sourceDocument: "settings",
      severity: "info",
      before: null,
      after: JSON.stringify(body)
    });

    emitEntityChanged(req.companyId, { entity: "Settings", action: "update", id: "settings" });
    return res.status(200).json({ success: true, data: { message: "Settings updated." } });
  } catch (error) {
    next(error);
  }
});

// ─── Notifications ──────────────────────────────────────────────────────────

router.get("/notifications", authMiddleware, requirePermission("notifications.view"), async (req, res, next) => {
  try {
    const notifications = await models.Notification.findAll({
      where: { companyId: req.companyId },
      order: [["createdAt", "DESC"]],
      limit: Math.min(Number(req.query.limit) || 30, 100)
    });
    return res.status(200).json({ success: true, items: notifications, data: notifications });
  } catch (error) {
    next(error);
  }
});

router.get("/notifications/unread-count", authMiddleware, requirePermission("notifications.view"), async (req, res, next) => {
  try {
    const count = await models.Notification.count({ where: { companyId: req.companyId, isRead: false } });
    return res.status(200).json({ success: true, count, data: { count } });
  } catch (error) {
    next(error);
  }
});

router.post("/notifications/:id/read", authMiddleware, requirePermission("notifications.view"), async (req, res, next) => {
  try {
    const notification = await models.Notification.findOne({ where: { id: req.params.id, companyId: req.companyId } });
    if (!notification) throw new NotFoundError("Notification not found.");
    await notification.update({ isRead: true, readAt: new Date() });
    emitEntityChanged(req.companyId, { entity: "Notification", action: "update", id: req.params.id });
    return res.status(200).json({ success: true, data: notification });
  } catch (error) {
    next(error);
  }
});

router.post("/notifications/read-all", authMiddleware, requirePermission("notifications.view"), async (req, res, next) => {
  try {
    await models.Notification.update({ isRead: true, readAt: new Date() }, { where: { companyId: req.companyId, isRead: false } });
    emitEntityChanged(req.companyId, { entity: "Notification", action: "update", id: "all" });
    return res.status(200).json({ success: true, data: { message: "Notifications marked as read." } });
  } catch (error) {
    next(error);
  }
});

router.delete("/notifications/:id", authMiddleware, requirePermission("notifications.view"), async (req, res, next) => {
  try {
    const notification = await models.Notification.findOne({ where: { id: req.params.id, companyId: req.companyId } });
    if (!notification) throw new NotFoundError("Notification not found.");
    await notification.destroy();
    emitEntityChanged(req.companyId, { entity: "Notification", action: "delete", id: req.params.id });
    return res.status(200).json({ success: true, data: { message: "Notification deleted." } });
  } catch (error) {
    next(error);
  }
});

// ─── Users / Roles / Permissions Administration ─────────────────────────────

router.get("/permissions", authMiddleware, requireAnyPermission(["roles.manage", "permissions.manage", "users.view"]), async (req, res, next) => {
  try {
    const permissions = await models.Permission.findAll({ order: [["module", "ASC"], ["action", "ASC"]] });
    return res.status(200).json({ success: true, items: permissions, data: permissions });
  } catch (error) {
    next(error);
  }
});

router.get("/roles", authMiddleware, requireAnyPermission(["roles.manage", "users.view"]), async (req, res, next) => {
  try {
    const roles = await models.Role.findAll({
      where: { companyId: req.companyId },
      include: [{ model: models.Permission, as: "permissions", through: { attributes: [] } }],
      order: [["name", "ASC"]]
    });
    return res.status(200).json({ success: true, items: roles, data: roles });
  } catch (error) {
    next(error);
  }
});

router.post("/roles", authMiddleware, requirePermission("roles.manage"), async (req, res, next) => {
  try {
    const slug = String(req.body.slug || req.body.name || "").trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, "-");
    if (!slug || !req.body.name) throw new ValidationError("Role name is required.");
    const role = await models.Role.create({
      id: `ROLE-${req.companyId}-${slug}-${Date.now()}`,
      companyId: req.companyId,
      name: String(req.body.name).trim(),
      slug,
      description: req.body.description || "",
      isSystem: false,
      isAdmin: false
    });
    emitEntityChanged(req.companyId, { entity: "Role", action: "create", id: role.id });
    return res.status(201).json({ success: true, data: role });
  } catch (error) {
    next(error);
  }
});

router.put("/roles/:id/permissions", authMiddleware, requirePermission("roles.manage"), async (req, res, next) => {
  try {
    const role = await models.Role.findOne({ where: { id: req.params.id, companyId: req.companyId } });
    if (!role) throw new NotFoundError("Role not found.");
    const permissionNames = Array.isArray(req.body.permissions) ? req.body.permissions : [];
    const permissions = await models.Permission.findAll({ where: { name: permissionNames } });
    await models.RolePermission.destroy({ where: { roleId: role.id } });
    await models.RolePermission.bulkCreate(permissions.map((permission) => ({
      roleId: role.id,
      permissionId: permission.id
    })));
    emitEntityChanged(req.companyId, { entity: "Permission", action: "update", id: role.id });
    return res.status(200).json({ success: true, data: { roleId: role.id, permissions: permissions.map((p) => p.name) } });
  } catch (error) {
    next(error);
  }
});

router.get("/users", authMiddleware, requirePermission("users.view"), async (req, res, next) => {
  try {
    const users = await models.User.findAll({
      where: { companyId: req.companyId },
      attributes: { exclude: ["password"] },
      include: [{ model: models.Role, as: "roles", through: { attributes: [] }, include: [{ model: models.Permission, as: "permissions", through: { attributes: [] } }] }],
      order: [["createdAt", "DESC"]]
    });
    return res.status(200).json({ success: true, items: users, data: users });
  } catch (error) {
    next(error);
  }
});

router.post("/users", authMiddleware, requirePermission("users.create"), async (req, res, next) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!email || !req.body.password || !req.body.firstName || !req.body.lastName) {
      throw new ValidationError("firstName, lastName, email and password are required.");
    }
    const existing = await models.User.findOne({ where: { email } });
    if (existing) throw new ValidationError("Email is already registered.", { email: ["Email is already registered."] });
    const user = await models.User.create({
      id: `USR-${Date.now()}`,
      companyId: req.companyId,
      firstName: String(req.body.firstName).trim(),
      lastName: String(req.body.lastName).trim(),
      email,
      phone: req.body.phone || "",
      jobTitle: req.body.jobTitle || "",
      role: req.body.legacyRole || "sales",
      password: bcrypt.hashSync(String(req.body.password), 10)
    });
    const roleIds = Array.isArray(req.body.roleIds) ? req.body.roleIds : [];
    const roles = await models.Role.findAll({ where: { id: roleIds, companyId: req.companyId } });
    if (!roles.length) {
      const fallback = await models.Role.findOne({ where: { companyId: req.companyId, slug: user.role } });
      if (fallback) roles.push(fallback);
    }
    await models.UserRole.bulkCreate(roles.map((role) => ({ userId: user.id, roleId: role.id })));
    emitEntityChanged(req.companyId, { entity: "User", action: "create", id: user.id });
    await notificationService.createNotification(req.companyId, {
      title: "User created",
      message: `${user.firstName} ${user.lastName} was added to the system.`,
      type: "system",
      entityType: "User",
      entityId: user.id
    });
    const plain = user.toJSON();
    delete plain.password;
    return res.status(201).json({ success: true, data: { ...plain, roles } });
  } catch (error) {
    next(error);
  }
});

router.put("/users/:id", authMiddleware, requirePermission("users.update"), async (req, res, next) => {
  try {
    const user = await models.User.findOne({ where: { id: req.params.id, companyId: req.companyId } });
    if (!user) throw new NotFoundError("User not found.");
    const updates = {};
    for (const key of ["firstName", "lastName", "phone", "jobTitle", "role"]) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (req.body.email) updates.email = String(req.body.email).trim().toLowerCase();
    if (req.body.password) updates.password = bcrypt.hashSync(String(req.body.password), 10);
    await user.update(updates);
    if (Array.isArray(req.body.roleIds)) {
      const roles = await models.Role.findAll({ where: { id: req.body.roleIds, companyId: req.companyId } });
      await models.UserRole.destroy({ where: { userId: user.id } });
      await models.UserRole.bulkCreate(roles.map((role) => ({ userId: user.id, roleId: role.id })));
    }
    emitEntityChanged(req.companyId, { entity: "User", action: "update", id: user.id });
    const plain = user.toJSON();
    delete plain.password;
    return res.status(200).json({ success: true, data: plain });
  } catch (error) {
    next(error);
  }
});

router.delete("/users/:id", authMiddleware, requirePermission("users.delete"), async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) throw new ValidationError("You cannot delete your own account.");
    const user = await models.User.findOne({ where: { id: req.params.id, companyId: req.companyId } });
    if (!user) throw new NotFoundError("User not found.");
    await user.destroy();
    emitEntityChanged(req.companyId, { entity: "User", action: "delete", id: req.params.id });
    return res.status(200).json({ success: true, data: { message: "User deleted." } });
  } catch (error) {
    next(error);
  }
});

// Customer Invoices
router.get("/customers/:id/invoices", authMiddleware, async (req, res, next) => {
  try {
    const customerId = req.params.id;
    const customer = await models.Customer.findOne({ where: { id: customerId, companyId: req.companyId } });
    if (!customer) {
      return res.status(404).json({ success: false, message: "العميل غير موجود" });
    }

    const invoices = await models.Invoice.findAll({
      where: postedInvoiceWhere({ customerId, companyId: req.companyId }),
      include: [
        { model: models.InvoiceItem, as: "items" },
        { model: models.Payment, as: "payments" },
        { model: models.Installment, as: "installments" }
      ],
      order: [["date", "DESC"], ["createdAt", "DESC"]]
    });

    return res.status(200).json({
      success: true,
      items: invoices,
      data: invoices
    });
  } catch (error) {
    next(error);
  }
});

// Customer Statement Calculations
router.get("/customers/:id/statement", authMiddleware, async (req, res, next) => {
  try {
    const customerId = req.params.id;
    const customer = await models.Customer.findOne({ where: { id: customerId, companyId: req.companyId } });
    if (!customer) {
      return res.status(404).json({ success: false, message: "العميل غير موجود" });
    }

    const invoices = await models.Invoice.findAll({
      where: postedInvoiceWhere({ customerId, companyId: req.companyId }),
      order: [["date", "DESC"]]
    });

    return res.status(200).json({
      success: true,
      data: {
        openingBalance: 0,
        closingBalance: parseFloat(customer.balance || 0),
        invoices: invoices.map((i) => ({
          id: i.id,
          date: i.date,
          total: parseFloat(i.total || 0),
          amount: parseFloat(i.total || 0),
          status: i.status,
          branch: i.branch,
          paymentMethod: i.paymentMethod
        })),
        receipts: [],
        vatDue: invoices.reduce((acc, curr) => acc + parseFloat(curr.tax || 0), 0)
      }
    });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMER SUB-LEDGER STATEMENT (كشف حساب عميل) — Phase 10B. READ-ONLY.
// A real running-balance statement built from SOURCE DOCUMENTS, not the GL:
// JournalLine has no customerId, so a per-customer ledger cannot come from the
// GL. Sources (confirmed): posted Invoices (debit; type="return" → credit) and
// Payments (credit, linked to the customer via their posted invoices).
// Installments are intentionally EXCLUDED — their collections are stored only as
// a cumulative paidAmount (no per-collection dated record) and post GL entries
// with no customer dimension, so they cannot be turned into accurate dated
// credit rows here; a later phase will add them. customer.balance is shown for
// REFERENCE only (with a non-destructive `difference`); it is never written, and
// opening/closing are computed from a full document scan, never from a page.
// Kept as a NEW route so the legacy GET /customers/:id/statement is untouched.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/customers/:id/statement-v2", authMiddleware, requirePermission("customers.view"), async (req, res, next) => {
  try {
    // 1. Customer must exist within the tenant. Never modified.
    const customer = await models.Customer.findOne({ where: { id: req.params.id, companyId: req.companyId } });
    if (!customer) throw new NotFoundError("Customer not found.");

    // 2. Validate the optional date window.
    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;
    if (from && !isValidYmd(from)) throw new ValidationError("Invalid 'from' date (expected YYYY-MM-DD).");
    if (to && !isValidYmd(to)) throw new ValidationError("Invalid 'to' date (expected YYYY-MM-DD).");
    if (from && to && from > to) throw new ValidationError("'from' must not be after 'to'.");

    // 3. Pagination (rows only; capped).
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 50, 1), 200);

    // 4. Source 1 — posted invoices for this customer (full scan, not paged).
    const invoices = await models.Invoice.findAll({
      where: postedInvoiceWhere({ customerId: customer.id, companyId: req.companyId }),
      attributes: ["id", "invoiceNumber", "type", "total", "date", "createdAt"],
      raw: true,
    });

    // 5. Source 2 — payments, linked to the customer ONLY via their posted
    //    invoices (Payment carries invoiceId, not customerId).
    const invoiceIds = invoices.map((i) => i.id);
    let payments = [];
    if (invoiceIds.length) {
      payments = await models.Payment.findAll({
        where: { companyId: req.companyId, invoiceId: { [Op.in]: invoiceIds } },
        attributes: ["id", "invoiceId", "amount", "reference", "date", "createdAt"],
        raw: true,
      });
    }

    // 6. Unify into ledger rows. Customer-AR convention: a charge raises what the
    //    customer owes (debit); a receipt/return lowers it (credit).
    const rowsAll = [];
    for (const inv of invoices) {
      const amount = round4(inv.total);
      const isReturn = inv.type === "return";
      rowsAll.push({
        id: `INV-${inv.id}`,
        type: isReturn ? "return" : "invoice",
        sourceId: inv.id,
        sourceNumber: inv.invoiceNumber || inv.id,
        date: (inv.date || "").slice(0, 10),
        createdAt: inv.createdAt,
        description: isReturn ? `مرتجع ${inv.invoiceNumber || inv.id}` : `فاتورة ${inv.invoiceNumber || inv.id}`,
        debit: isReturn ? 0 : amount,
        credit: isReturn ? amount : 0,
        sortType: isReturn ? "1_return" : "0_invoice",
      });
    }
    for (const p of payments) {
      const amount = round4(p.amount);
      rowsAll.push({
        id: `PAY-${p.id}`,
        type: "payment",
        sourceId: p.id,
        sourceNumber: p.reference || p.id,
        date: (p.date || "").slice(0, 10),
        createdAt: p.createdAt,
        description: `دفعة ${p.reference || p.id}`,
        debit: 0,
        credit: amount,
        sortType: "2_payment",
      });
    }

    // 7. Deterministic order so the running balance is stable.
    rowsAll.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      const ca = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const cb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (ca !== cb) return ca - cb;
      if (a.sortType !== b.sortType) return a.sortType < b.sortType ? -1 : 1;
      return a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0;
    });

    // 8. Opening = full aggregate of rows BEFORE `from` (0 when no `from`).
    //    Period = rows within [from,to]. Running computed across the WHOLE
    //    period set, then the page is sliced (page 2 continues after page 1).
    let openingBalance = 0;
    const periodRows = [];
    for (const r of rowsAll) {
      const delta = round4(r.debit - r.credit);
      if (from && r.date < from) {
        openingBalance = round4(openingBalance + delta);
        continue;
      }
      if (to && r.date > to) continue;
      periodRows.push({ ...r, delta });
    }

    let running = openingBalance;
    const withRunning = periodRows.map((r) => {
      running = round4(running + r.delta);
      return {
        id: r.id,
        type: r.type,
        sourceId: r.sourceId,
        sourceNumber: r.sourceNumber,
        date: r.date,
        description: r.description,
        debit: r.debit,
        credit: r.credit,
        delta: r.delta,
        runningBalance: running,
      };
    });

    const total = withRunning.length;
    const totalPages = Math.ceil(total / pageSize);
    const closingBalance = total ? withRunning[total - 1].runningBalance : openingBalance;
    const start = (page - 1) * pageSize;
    const items = withRunning.slice(start, start + pageSize);

    // 9. customer.balance is reference-only; difference is reported, never fixed.
    const customerBalanceReference = round4(customer.balance);
    const difference = round4(customerBalanceReference - closingBalance);

    return res.status(200).json({
      success: true,
      data: {
        customer: {
          id: customer.id,
          code: customer.code ?? null,
          name: customer.name,
          phone: customer.phone,
          balance: customerBalanceReference,
        },
        from,
        to,
        openingBalance,
        closingBalance,
        customerBalanceReference,
        difference,
        page,
        pageSize,
        total,
        totalPages,
        items,
        meta: { source: "source_documents", ledgerBased: false, readOnly: true },
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GL ACCOUNT STATEMENT (كشف حساب) — Phase 9B. READ-ONLY.
// Builds a per-GL-account ledger from POSTED journal lines only. It never reads
// Account.balance to derive opening/closing (those are computed from the lines
// themselves), and it performs ZERO writes — no balance/journal mutation.
//
// Opening balance = full server-side aggregate of every posted line for the
// account dated BEFORE `from` (0 when no `from`). Rows in [from,to] are ordered
// deterministically (date, entry.createdAt, entryId, lineId) and a running
// balance is computed across the WHOLE ordered set, then the requested page is
// sliced — so page 2's running balance correctly continues after page 1.
// closingBalance = opening + Σ delta over the entire range (not the page).
// Reversed originals are status="reversed" → excluded; the reversal entry is
// status="posted" → included, which is the correct net financial effect.
// ─────────────────────────────────────────────────────────────────────────────
const round4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;
const isValidYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s).getTime());

router.get("/accounts/:id/statement", authMiddleware, requirePermission("accounting.view"), async (req, res, next) => {
  try {
    // 1. Account must exist within the tenant. Never modified.
    const account = await models.Account.findOne({
      where: { id: req.params.id, companyId: req.companyId },
    });
    if (!account) throw new NotFoundError("Account not found.");

    // 2. Validate the optional date window.
    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;
    if (from && !isValidYmd(from)) throw new ValidationError("Invalid 'from' date (expected YYYY-MM-DD).");
    if (to && !isValidYmd(to)) throw new ValidationError("Invalid 'to' date (expected YYYY-MM-DD).");
    if (from && to && from > to) throw new ValidationError("'from' must not be after 'to'.");

    // 3. Pagination (rows only; capped).
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 50, 1), 200);

    const nature = account.nature; // "debit" | "credit"
    const deltaOf = (debit, credit) =>
      nature === "debit" ? (Number(debit) || 0) - (Number(credit) || 0) : (Number(credit) || 0) - (Number(debit) || 0);

    // 4. Opening balance — full aggregate of posted lines BEFORE `from`.
    let openingBalance = 0;
    if (from) {
      const priorLines = await models.JournalLine.findAll({
        attributes: ["debit", "credit"],
        where: { accountId: account.id },
        include: [{
          model: models.JournalEntry,
          as: "journalEntry",
          attributes: [],
          required: true,
          where: { companyId: req.companyId, status: "posted", date: { [Op.lt]: from } },
        }],
        raw: true,
      });
      openingBalance = round4(priorLines.reduce((s, l) => s + deltaOf(l.debit, l.credit), 0));
    }

    // 5. All posted lines within [from,to], deterministically ordered.
    const entryWhere = { companyId: req.companyId, status: "posted" };
    if (from || to) {
      entryWhere.date = {};
      if (from) entryWhere.date[Op.gte] = from;
      if (to) entryWhere.date[Op.lte] = to;
    }
    const lineRows = await models.JournalLine.findAll({
      where: { accountId: account.id },
      include: [{
        model: models.JournalEntry,
        as: "journalEntry",
        attributes: ["id", "date", "status", "sourceType", "sourceId", "branchId", "createdAt"],
        required: true,
        where: entryWhere,
      }],
      order: [
        [{ model: models.JournalEntry, as: "journalEntry" }, "date", "ASC"],
        [{ model: models.JournalEntry, as: "journalEntry" }, "createdAt", "ASC"],
        [{ model: models.JournalEntry, as: "journalEntry" }, "id", "ASC"],
        ["id", "ASC"],
      ],
    });

    // 6. Running balance across the WHOLE ordered set (so paging stays correct).
    let running = openingBalance;
    const allRows = lineRows.map((r) => {
      const je = r.journalEntry;
      const debit = round4(r.debit);
      const credit = round4(r.credit);
      const delta = round4(deltaOf(debit, credit));
      running = round4(running + delta);
      return {
        journalEntryId: je.id,
        journalLineId: r.id,
        date: je.date,
        description: r.description,
        sourceType: je.sourceType,
        sourceId: je.sourceId,
        branchId: je.branchId,
        debit,
        credit,
        delta,
        runningBalance: running,
      };
    });

    const total = allRows.length;
    const totalPages = Math.ceil(total / pageSize);
    const closingBalance = total ? allRows[total - 1].runningBalance : openingBalance;
    const start = (page - 1) * pageSize;
    const items = allRows.slice(start, start + pageSize);

    return res.status(200).json({
      success: true,
      data: {
        account: {
          id: account.id,
          code: account.code,
          name: account.name,
          nameAr: account.nameAr,
          nature: account.nature,
          balance: round4(account.balance),
        },
        from,
        to,
        openingBalance,
        closingBalance,
        page,
        pageSize,
        total,
        totalPages,
        items,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// TRIAL BALANCE (ميزان المراجعة) — Phase 9D — READ-ONLY.
// Computes debit/credit totals from POSTED journal lines only, never from
// Account.balance. A reversal's ORIGINAL is flipped to status "reversed" (so it
// is excluded), while the reversal entry itself is "posted" (so it is included,
// which is the correct financial effect). Account.balance is surfaced purely as
// a reference, plus a `difference` against the ledger-derived calculated balance.
// No rows are created, updated, or deleted.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/reports/trial-balance", authMiddleware, requirePermission("accounting.view"), async (req, res, next) => {
  try {
    // 1. Validate query. `asOf` optional date, `includeZero` optional bool.
    const asOf = req.query.asOf ? String(req.query.asOf) : null;
    if (asOf && !isValidYmd(asOf)) throw new ValidationError("Invalid 'asOf' date (expected YYYY-MM-DD).");
    const includeZero = String(req.query.includeZero ?? "false").toLowerCase() === "true";

    // 2. All accounts in the tenant — sorted for deterministic output.
    const accounts = await models.Account.findAll({
      where: { companyId: req.companyId },
      order: [["code", "ASC"], ["id", "ASC"]],
      raw: true,
    });

    // 3. Aggregate posted journal lines per account, optionally up to `asOf`.
    //    status="posted" alone excludes drafts/pending/balanced/reversed.
    const entryWhere = { companyId: req.companyId, status: "posted" };
    if (asOf) entryWhere.date = { [Op.lte]: asOf };
    const rows = await models.JournalLine.findAll({
      attributes: [
        "accountId",
        [models.sequelize.fn("COALESCE", models.sequelize.fn("SUM", models.sequelize.col("debit")), 0), "debitTotal"],
        [models.sequelize.fn("COALESCE", models.sequelize.fn("SUM", models.sequelize.col("credit")), 0), "creditTotal"],
      ],
      include: [{
        model: models.JournalEntry,
        as: "journalEntry",
        attributes: [],
        required: true,
        where: entryWhere,
      }],
      group: [models.sequelize.col("accountId")],
      raw: true,
    });
    const totalsByAccount = new Map();
    for (const r of rows) totalsByAccount.set(r.accountId, { debitTotal: round4(r.debitTotal), creditTotal: round4(r.creditTotal) });

    // 4. Build per-account lines.
    const items = [];
    let totalDebit = 0;
    let totalCredit = 0;
    let totalDifference = 0;
    for (const a of accounts) {
      const t = totalsByAccount.get(a.id) || { debitTotal: 0, creditTotal: 0 };
      const debitTotal = t.debitTotal;
      const creditTotal = t.creditTotal;
      // Ledger-derived balance, signed by the account's nature.
      const calculatedBalance = a.nature === "credit" ? round4(creditTotal - debitTotal) : round4(debitTotal - creditTotal);
      // Presentation side: a negative balance flips to the opposite column.
      let netDebit = 0;
      let netCredit = 0;
      if (calculatedBalance >= 0) {
        if (a.nature === "credit") netCredit = calculatedBalance;
        else netDebit = calculatedBalance;
      } else if (a.nature === "credit") {
        netDebit = round4(-calculatedBalance);
      } else {
        netCredit = round4(-calculatedBalance);
      }

      const currentBalance = round4(a.balance);
      const difference = round4(currentBalance - calculatedBalance);

      // includeZero=false → drop accounts with nothing on any metric.
      const isZero = debitTotal === 0 && creditTotal === 0 && calculatedBalance === 0 && currentBalance === 0;
      if (!includeZero && isZero) continue;

      totalDebit = round4(totalDebit + netDebit);
      totalCredit = round4(totalCredit + netCredit);
      totalDifference = round4(totalDifference + Math.abs(difference));

      items.push({
        accountId: a.id,
        code: a.code,
        name: a.name,
        nameAr: a.nameAr,
        type: a.type,
        nature: a.nature,
        currentBalance,
        debitTotal,
        creditTotal,
        calculatedBalance,
        netDebit,
        netCredit,
        difference,
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        asOf,
        includeZero,
        accountCount: items.length,
        totalDebit,
        totalCredit,
        isBalanced: Math.abs(totalDebit - totalCredit) <= 0.01,
        totalDifference,
        items,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// LEDGER RECONCILIATION (تسوية دفتر الأستاذ) — Phase 9F. READ-ONLY.
// Compares each account's STORED Account.balance against the balance CALCULATED
// from posted journal lines, surfacing any drift. It NEVER writes, NEVER fixes,
// and NEVER uses Account.balance to derive the calculated value (that is built
// only from the lines). status="posted" alone excludes drafts/pending/balanced
// and reversed originals; the reversal entry (status posted) is included, which
// is the correct net effect. differenceCount / totalAbsoluteDifference are
// computed over EVERY account with drift in the tenant (the true reconciliation
// signal), independent of the includeZero / onlyDifferences display filters;
// accountCount reflects the rows actually returned after those filters.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/reports/ledger-reconciliation", authMiddleware, requirePermission("accounting.view"), async (req, res, next) => {
  try {
    // 1. Validate query.
    const asOf = req.query.asOf ? String(req.query.asOf) : null;
    if (asOf && !isValidYmd(asOf)) throw new ValidationError("Invalid 'asOf' date (expected YYYY-MM-DD).");
    const includeZero = String(req.query.includeZero ?? "false").toLowerCase() === "true";
    const onlyDifferences = String(req.query.onlyDifferences ?? "true").toLowerCase() === "true";

    // 2. All accounts in the tenant — deterministic order.
    const accounts = await models.Account.findAll({
      where: { companyId: req.companyId },
      order: [["code", "ASC"], ["id", "ASC"]],
      raw: true,
    });

    // 3. Aggregate POSTED journal lines per account, optionally up to `asOf`.
    const entryWhere = { companyId: req.companyId, status: "posted" };
    if (asOf) entryWhere.date = { [Op.lte]: asOf };
    const rows = await models.JournalLine.findAll({
      attributes: [
        "accountId",
        [models.sequelize.fn("COALESCE", models.sequelize.fn("SUM", models.sequelize.col("debit")), 0), "debitTotal"],
        [models.sequelize.fn("COALESCE", models.sequelize.fn("SUM", models.sequelize.col("credit")), 0), "creditTotal"],
      ],
      include: [{
        model: models.JournalEntry,
        as: "journalEntry",
        attributes: [],
        required: true,
        where: entryWhere,
      }],
      group: [models.sequelize.col("accountId")],
      raw: true,
    });
    const totalsByAccount = new Map();
    for (const r of rows) totalsByAccount.set(r.accountId, { debitTotal: round4(r.debitTotal), creditTotal: round4(r.creditTotal) });

    // 4. Per-account comparison.
    const items = [];
    let differenceCount = 0;
    let totalAbsoluteDifference = 0;
    for (const a of accounts) {
      const tot = totalsByAccount.get(a.id) || { debitTotal: 0, creditTotal: 0 };
      const debitTotal = tot.debitTotal;
      const creditTotal = tot.creditTotal;
      // Ledger-derived balance, signed by the account's nature. NEVER uses a.balance.
      const calculatedBalance = a.nature === "credit"
        ? round4(creditTotal - debitTotal)
        : round4(debitTotal - creditTotal);
      const currentBalance = round4(a.balance);
      const difference = round4(currentBalance - calculatedBalance);
      const status = Math.abs(difference) <= 0.01 ? "matched" : "difference";
      const isDifference = status === "difference";

      // Global reconciliation signal — counted over ALL accounts, pre-display-filter.
      if (isDifference) {
        differenceCount += 1;
        totalAbsoluteDifference = round4(totalAbsoluteDifference + Math.abs(difference));
      }

      // Display filters.
      const isZero = debitTotal === 0 && creditTotal === 0 && calculatedBalance === 0 && currentBalance === 0 && difference === 0;
      if (!includeZero && isZero) continue;
      if (onlyDifferences && !isDifference) continue;

      items.push({
        accountId: a.id,
        code: a.code,
        name: a.name,
        nameAr: a.nameAr,
        type: a.type,
        nature: a.nature,
        currentBalance,
        debitTotal,
        creditTotal,
        calculatedBalance,
        difference,
        status,
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        asOf,
        includeZero,
        onlyDifferences,
        accountCount: items.length,
        differenceCount,
        totalAbsoluteDifference,
        hasDifferences: differenceCount > 0,
        items,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// INVENTORY VALUATION REPORT (تقييم المخزون) — READ-ONLY, grouped by karat.
// Cost value (book), market value (current gold price × weight) and the
// unrealized gain/loss — informational only, posts NO journal entry and changes
// NO balances/stock. Current valuation (not a historical snapshot).
// On-hand = assets in non-sold/melted/archived statuses + products by
// quantityOnHand. Gold weight basis = goldWeight ?? netWeight ?? grossWeight.
// ─────────────────────────────────────────────────────────────────────────────
const VALUATION_ASSET_STATUSES = ["available", "reserved", "pending_transfer", "in_workshop", "repair", "pending_tag", "returned"];

router.get("/reports/inventory-valuation", authMiddleware, requirePermission("reports.view"), async (req, res, next) => {
  try {
    const companyId = req.companyId;
    const settings = await settingsService.getCompanySettings(companyId);
    const currency = settings.currency || "AED";
    const branchId = req.query.branchId && req.query.branchId !== "all" ? req.query.branchId : null;
    const karatFilter = req.query.karat && req.query.karat !== "all" ? String(req.query.karat) : null;

    // Current per-gram price per gold karat (manual fixing wins over live).
    const prices = {};
    for (const k of [18, 21, 22, 24]) {
      try { prices[k] = await effectiveKaratPrice(companyId, currency, k); } catch { prices[k] = null; }
    }

    const buckets = new Map(); // key 18/21/22/24/'other'
    const bucketOf = (karat) => {
      const k = parseInt(karat, 10);
      return [18, 21, 22, 24].includes(k) ? String(k) : "other";
    };
    const ensure = (key) => {
      if (!buckets.has(key)) buckets.set(key, { karat: key, itemCount: 0, quantity: 0, totalWeight: 0, costValue: 0, marketValue: 0, unrealizedGainLoss: 0, missingCostCount: 0, missingWeightCount: 0, missingPriceCount: 0 });
      return buckets.get(key);
    };
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

    // ── Serialized assets ──
    const assetWhere = { companyId, status: { [Op.in]: VALUATION_ASSET_STATUSES } };
    if (branchId) assetWhere.branchId = branchId;
    const assets = await models.Asset.findAll({ where: assetWhere });
    for (const a of assets) {
      const key = bucketOf(a.karat);
      if (karatFilter && key !== karatFilter) continue;
      const g = ensure(key);
      const weight = num(a.goldWeight) || num(a.netWeight) || num(a.grossWeight);
      const cost = num(a.cost);
      const perGram = key === "other" ? null : prices[Number(key)];
      g.itemCount += 1;
      g.quantity += 1;
      g.totalWeight = Math.round((g.totalWeight + weight) * 10000) / 10000;
      g.costValue = Math.round((g.costValue + cost) * 100) / 100;
      if (cost <= 0) g.missingCostCount += 1;
      if (weight <= 0) g.missingWeightCount += 1;
      if (!perGram) g.missingPriceCount += weight > 0 ? 1 : 0;
      else g.marketValue = Math.round((g.marketValue + weight * perGram) * 100) / 100;
    }

    // ── Quantity-based products (on-hand) ──
    const prodWhere = { companyId, isActive: true, quantityOnHand: { [Op.gt]: 0 } };
    if (branchId) prodWhere.branchId = branchId;
    const products = await models.Product.findAll({ where: prodWhere });
    for (const p of products) {
      const key = bucketOf(p.karat);
      if (karatFilter && key !== karatFilter) continue;
      const g = ensure(key);
      const qty = num(p.quantityOnHand);
      const unitCost = num(p.averageCost) || num(p.unitCost); // averageCost is the maintained inventory cost
      const cost = Math.round(unitCost * qty * 100) / 100;
      const weight = num(p.totalWeight); // maintained on-hand total weight
      const perGram = key === "other" ? null : prices[Number(key)];
      g.itemCount += 1;
      g.quantity += qty;
      g.totalWeight = Math.round((g.totalWeight + weight) * 10000) / 10000;
      g.costValue = Math.round((g.costValue + cost) * 100) / 100;
      if (unitCost <= 0) g.missingCostCount += 1;
      if (weight <= 0) g.missingWeightCount += 1;
      if (!perGram) g.missingPriceCount += weight > 0 ? 1 : 0;
      else g.marketValue = Math.round((g.marketValue + weight * perGram) * 100) / 100;
    }

    const groups = [...buckets.values()].map((g) => ({
      ...g,
      unrealizedGainLoss: Math.round((g.marketValue - g.costValue) * 100) / 100,
      pricePerGram: g.karat === "other" ? null : (prices[Number(g.karat)] ?? null),
    }));
    // Stable order: 18,21,22,24,other.
    const order = { "18": 1, "21": 2, "22": 3, "24": 4, other: 9 };
    groups.sort((a, b) => (order[a.karat] || 99) - (order[b.karat] || 99));

    const totals = groups.reduce((acc, g) => ({
      itemCount: acc.itemCount + g.itemCount,
      quantity: Math.round((acc.quantity + g.quantity) * 10000) / 10000,
      totalWeight: Math.round((acc.totalWeight + g.totalWeight) * 10000) / 10000,
      costValue: Math.round((acc.costValue + g.costValue) * 100) / 100,
      marketValue: Math.round((acc.marketValue + g.marketValue) * 100) / 100,
      unrealizedGainLoss: Math.round((acc.unrealizedGainLoss + g.unrealizedGainLoss) * 100) / 100,
      missingCostCount: acc.missingCostCount + g.missingCostCount,
      missingWeightCount: acc.missingWeightCount + g.missingWeightCount,
      missingPriceCount: acc.missingPriceCount + g.missingPriceCount,
    }), { itemCount: 0, quantity: 0, totalWeight: 0, costValue: 0, marketValue: 0, unrealizedGainLoss: 0, missingCostCount: 0, missingWeightCount: 0, missingPriceCount: 0 });

    const payload = {
      currency,
      generatedAt: new Date().toISOString(),
      valuationType: "current", // not a historical snapshot
      informational: true, // market value posts NO journal entry
      groups,
      totals,
    };
    return res.status(200).json({ success: true, ...payload, data: payload });
  } catch (error) {
    next(error);
  }
});

// ─── Financial aggregate report endpoints (Phase 5E-a) ───────────────────────
// Read-only, server-side summaries over POSTED invoices (companyId scoped), so
// the previously-truncated frontend financial reports can be re-enabled with
// correct figures. NO writes, NO posting/accounting changes. Returns are stored
// as NEGATIVE invoice totals, so summing posted invoice totals nets returns at
// the invoice level (Tax/Financial). The date filter uses Invoice.date, which
// is verified to be YYYY-MM-DD (sortable as a string); malformed from/to are
// ignored and reported in `filters.dateFilterRejected`.
const REPORT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const reportNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const reportRound2 = (v) => Math.round(v * 100) / 100;

function buildInvoiceReportWhere(req) {
  const where = { companyId: req.companyId, postingStatus: "posted" };
  const filters = {
    companyId: req.companyId,
    postedOnly: true,
    branchId: null,
    from: null,
    to: null,
    dateFilterApplied: false,
    dateFilterRejected: false,
  };
  const branchId = req.query.branchId && req.query.branchId !== "all" ? String(req.query.branchId) : null;
  if (branchId) { where.branchId = branchId; filters.branchId = branchId; }

  const from = req.query.from;
  const to = req.query.to;
  const fromOk = from && REPORT_DATE_RE.test(String(from));
  const toOk = to && REPORT_DATE_RE.test(String(to));
  if (fromOk || toOk) {
    where.date = {};
    if (fromOk) { where.date[Op.gte] = String(from); filters.from = String(from); }
    if (toOk) { where.date[Op.lte] = String(to); filters.to = String(to); }
    filters.dateFilterApplied = true;
  }
  if ((from && !fromOk) || (to && !toOk)) filters.dateFilterRejected = true;
  return { where, filters };
}

// GET /reports/tax-summary — posted invoices; returns net via negative totals.
router.get("/reports/tax-summary", authMiddleware, requirePermission("reports.view"), async (req, res, next) => {
  try {
    const { where, filters } = buildInvoiceReportWhere(req);
    const invoices = await models.Invoice.findAll({ where });
    let salesTotal = 0, vatTotal = 0, netSubtotal = 0;
    for (const inv of invoices) {
      salesTotal += reportNum(inv.total);
      vatTotal += reportNum(inv.tax);
      netSubtotal += reportNum(inv.subtotal);
    }

    // Phase 12H — Input VAT / RCM from RECEIVED, non-consignment purchase orders
    // (snapshot fields from 12F/12G are the source of truth). Same from/to date
    // window as sales. branchId is resolved to the purchase-order branch NAME
    // (purchase_orders has no branch_id column) — see meta limitation. Draft /
    // sent / partial / cancelled / consignment purchases are excluded.
    const poWhere = { companyId: req.companyId, status: "received", isConsignment: false };
    if (filters.from || filters.to) {
      poWhere.date = {};
      if (filters.from) poWhere.date[Op.gte] = filters.from;
      if (filters.to) poWhere.date[Op.lte] = filters.to;
    }
    let purchaseBranchFilter = "not_applied";
    if (filters.branchId) {
      const br = await models.Branch.findOne({ where: { id: filters.branchId, companyId: req.companyId } });
      if (br && br.name) { poWhere.branch = br.name; purchaseBranchFilter = "by_resolved_name"; }
      else { purchaseBranchFilter = "branchId_unresolved_purchases_not_filtered"; }
    }
    const purchases = await models.PurchaseOrder.findAll({ where: poWhere });
    let inputVatTotal = 0, rcmOutputVatTotal = 0, rcmInputVatTotal = 0, purchasesTaxBaseTotal = 0, purchaseGrossTotal = 0;
    for (const po of purchases) {
      const isRcm = po.isRcm === true;
      const isRecoverable = po.isRecoverable !== false;
      const taxBase = reportNum(po.taxBase);
      const inputVat = reportNum(po.inputVatAmount);
      const rcmVat = reportNum(po.rcmVatAmount);
      purchaseGrossTotal += reportNum(po.total);
      purchasesTaxBaseTotal += taxBase;
      if (isRcm) {
        // RCM is net-zero: output and input each = rcmVatAmount. Never counted in
        // the ordinary inputVatTotal (avoids double-count).
        rcmOutputVatTotal += rcmVat;
        rcmInputVatTotal += rcmVat;
      } else if (isRecoverable && inputVat > 0) {
        inputVatTotal += inputVat;
      }
      // non-recoverable VAT stays capitalised in cost → not a VAT-return figure.
    }
    const outputVatTotal = vatTotal; // backward-compatible alias of the old vatTotal
    const netVatPayable = outputVatTotal + rcmOutputVatTotal - inputVatTotal - rcmInputVatTotal;

    const totals = {
      salesTotal: reportRound2(salesTotal),
      vatTotal: reportRound2(vatTotal),
      netSubtotal: reportRound2(netSubtotal),
      records: invoices.length,
      // Phase 12H additive totals (Output VAT figures above are unchanged).
      outputVatTotal: reportRound2(outputVatTotal),
      inputVatTotal: reportRound2(inputVatTotal),
      rcmOutputVatTotal: reportRound2(rcmOutputVatTotal),
      rcmInputVatTotal: reportRound2(rcmInputVatTotal),
      netVatPayable: reportRound2(netVatPayable),
      purchasesTaxBaseTotal: reportRound2(purchasesTaxBaseTotal),
      purchaseGrossTotal: reportRound2(purchaseGrossTotal),
      purchaseRecords: purchases.length,
    };
    const payload = {
      generatedAt: new Date().toISOString(),
      basis: "invoice",
      postedOnly: true,
      returnsNetted: "via_negative_invoice_totals",
      // Phase 12B (UNCHANGED for backward compatibility — verify-vat-output): the
      // legacy `scope`/`meta` keep describing the OUTPUT-VAT view. The expanded
      // Output+Input+RCM view is exposed additively under `vatFull` below.
      scope: "output_vat",
      meta: { scope: "output_vat", includesInputVat: false, includesRcm: false },
      // Phase 12H — full VAT picture (Output + Input + RCM). Additive, does not
      // change any legacy field. netVatPayable = output + rcmOutput - input
      // - rcmInput (RCM nets to zero).
      vatFull: {
        scope: "vat_full",
        includesOutputVat: true,
        includesInputVat: true,
        includesRcm: true,
        outputVatAccountCode: "2200",
        inputVatAccountCode: "1400",
        rcmOutputAccountCode: "2210",
        purchaseBasis: "received_non_consignment_purchase_orders",
        purchaseBranchFilter,
        limitations: purchaseBranchFilter === "branchId_unresolved_purchases_not_filtered"
          ? ["branchId did not resolve to a branch; purchase figures are not branch-filtered"]
          : [],
      },
      filters,
      totals,
    };
    return res.status(200).json({ success: true, ...payload, data: payload });
  } catch (error) { next(error); }
});

// GET /reports/financial-summary — invoice-based (ledger-based is a future variant).
router.get("/reports/financial-summary", authMiddleware, requirePermission("reports.view"), async (req, res, next) => {
  try {
    const { where, filters } = buildInvoiceReportWhere(req);
    const invoices = await models.Invoice.findAll({ where });
    let revenue = 0, vat = 0, receivables = 0;
    for (const inv of invoices) {
      revenue += reportNum(inv.total);
      vat += reportNum(inv.tax);
      receivables += reportNum(inv.remainingAmount);
    }
    const totals = {
      revenue: reportRound2(revenue),
      vat: reportRound2(vat),
      receivables: reportRound2(receivables),
      records: invoices.length,
      // Deferred: requires the inventory-valuation aggregate (cost basis). Left
      // null here so the frontend never presents a fabricated stock value.
      inventoryCostValue: null,
    };
    const payload = {
      generatedAt: new Date().toISOString(),
      basis: "invoice",
      postedOnly: true,
      ledgerBased: false,
      notes: [
        "Invoice-based summary; not derived from the accounting ledger.",
        "inventoryCostValue is deferred to /reports/inventory-valuation.",
      ],
      filters,
      totals,
    };
    return res.status(200).json({ success: true, ...payload, data: payload });
  } catch (error) { next(error); }
});

// GET /reports/profit-summary — realized gross profit from posted SALE items.
router.get("/reports/profit-summary", authMiddleware, requirePermission("reports.view"), async (req, res, next) => {
  try {
    const { where, filters } = buildInvoiceReportWhere(req);
    // Scope to type="sale": return/exchange ITEM-level signing is unverified in
    // the data, so they are EXCLUDED rather than risk mis-signing realized
    // profit. This is surfaced in `returnsExchanges` below.
    where.type = "sale";
    const saleInvoices = await models.Invoice.findAll({ where, attributes: ["id"] });
    const saleIds = saleInvoices.map((i) => i.id);

    let revenue = 0, cogs = 0, lineCount = 0, missingCostCount = 0, zeroCostCount = 0;
    if (saleIds.length) {
      const items = await models.InvoiceItem.findAll({ where: { invoiceId: saleIds } });
      for (const it of items) {
        const qty = reportNum(it.quantity);
        revenue += reportNum(it.price) * qty;
        if (it.cost === null || it.cost === undefined) {
          missingCostCount += 1; // contributes 0 to COGS → profit may be overstated
        } else {
          const c = reportNum(it.cost);
          if (c === 0) zeroCostCount += 1;
          cogs += c * qty;
        }
        lineCount += 1;
      }
    }
    const grossProfit = revenue - cogs;
    const hasCostWarnings = missingCostCount > 0 || zeroCostCount > 0;
    const totals = {
      revenue: reportRound2(revenue),
      cogs: reportRound2(cogs),
      grossProfit: reportRound2(grossProfit),
      marginPct: revenue > 0 ? reportRound2((grossProfit / revenue) * 100) : null,
      saleInvoiceCount: saleIds.length,
      lineCount,
      missingCostCount,
      zeroCostCount,
      hasCostWarnings,
    };
    const payload = {
      generatedAt: new Date().toISOString(),
      basis: "invoice-items",
      postedOnly: true,
      includedTypes: ["sale"],
      returnsExchanges: "excluded_pending_item_signing_review",
      profitReliability: hasCostWarnings ? "cost_warnings_present" : "ok",
      filters,
      totals,
    };
    return res.status(200).json({ success: true, ...payload, data: payload });
  } catch (error) { next(error); }
});

// Employee Session Management
router.get("/employees/:id/sessions", authMiddleware, async (req, res, next) => {
  try {
    const employeeId = req.params.id;
    const employee = await models.Employee.findOne({
      where: { id: employeeId, companyId: req.companyId }
    });
    if (!employee) {
      throw new NotFoundError("الموظف غير موجود أو لا ينتمي لشركتك");
    }
    const sessions = await models.EmployeeSession.findAll({ where: { employeeId } });
    return res.status(200).json({ success: true, data: sessions });
  } catch (error) {
    next(error);
  }
});

router.delete("/employees/:id/sessions/:sessionId", authMiddleware, async (req, res, next) => {
  try {
    const { id, sessionId } = req.params;
    const employee = await models.Employee.findOne({
      where: { id, companyId: req.companyId }
    });
    if (!employee) {
      throw new NotFoundError("الموظف غير موجود أو لا ينتمي لشركتك");
    }
    await models.EmployeeSession.destroy({ where: { id: sessionId, employeeId: id } });
    return res.status(200).json({ success: true, data: { message: "Session revoked successfully" } });
  } catch (error) {
    next(error);
  }
});

// Supplier Purchase Orders, Consignments, and Documents
router.get("/suppliers/:id/purchase-orders", authMiddleware, async (req, res, next) => {
  try {
    const supplierId = req.params.id;
    const pos = await models.PurchaseOrder.findAll({
      where: { supplierId, companyId: req.companyId },
      include: [
        {
          model: models.PurchaseOrderItem,
          as: "items",
          include: [{ model: models.Asset, as: "asset" }],
        },
      ],
      order: [["date", "DESC"], ["createdAt", "DESC"]],
    });
    return res.status(200).json({ success: true, items: pos, data: pos });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SUPPLIER SUB-LEDGER STATEMENT (كشف حساب مورّد) — Phase 10E. READ-ONLY.
// A running-balance payable statement built from SOURCE DOCUMENTS, not the GL
// (JournalLine has no supplierId) and NOT from Supplier.due (which only ever
// increases on receive and is never reduced, so it is unreliable).
// Sources (confirmed): received purchase orders (credit = total; consignment and
// non-"received" statuses excluded) and supplier-payment cash-outs
// (category "supplier_purchase") linked to the supplier ONLY via
// CashTransaction.reference -> PurchaseOrder.id -> supplierId. Supplier.due is
// returned for REFERENCE only (with a non-destructive `difference`, and
// dueReferenceReliable:false); it is never written. opening/closing come from a
// full document scan, never from a page.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/suppliers/:id/statement", authMiddleware, requirePermission("suppliers.view"), async (req, res, next) => {
  try {
    // 1. Supplier must exist within the tenant. Never modified.
    const supplier = await models.Supplier.findOne({ where: { id: req.params.id, companyId: req.companyId } });
    if (!supplier) throw new NotFoundError("Supplier not found.");

    // 2. Validate the optional date window.
    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;
    if (from && !isValidYmd(from)) throw new ValidationError("Invalid 'from' date (expected YYYY-MM-DD).");
    if (to && !isValidYmd(to)) throw new ValidationError("Invalid 'to' date (expected YYYY-MM-DD).");
    if (from && to && from > to) throw new ValidationError("'from' must not be after 'to'.");

    // 3. Pagination (rows only; capped).
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 50, 1), 200);

    // 4. Source 1 — received purchase orders (credit = total). Consignment and
    //    non-received statuses (draft/sent/partial/cancelled) are excluded.
    const pos = await models.PurchaseOrder.findAll({
      where: { supplierId: supplier.id, companyId: req.companyId, status: "received", isConsignment: { [Op.ne]: true } },
      attributes: ["id", "total", "date", "receivedDate", "createdAt"],
      raw: true,
    });

    // 5. Source 2 — supplier-payment cash-outs, linked to THIS supplier via the
    //    free-text reference -> PO id. We resolve POs with paranoid:false so a
    //    soft-deleted order still maps its payment to the supplier.
    const payTx = await models.CashTransaction.findAll({
      where: { companyId: req.companyId, type: "cash_out", category: "supplier_purchase" },
      attributes: ["id", "amount", "reference", "date", "createdAt", "description"],
      raw: true,
    });
    const refIds = [...new Set(payTx.map((tx) => tx.reference).filter(Boolean))];
    const supplierPoIds = new Set();
    if (refIds.length) {
      const refPos = await models.PurchaseOrder.findAll({
        where: { id: { [Op.in]: refIds }, companyId: req.companyId, supplierId: supplier.id },
        attributes: ["id"],
        paranoid: false, // map payments even if the PO was soft-deleted
        raw: true,
      });
      for (const p of refPos) supplierPoIds.add(p.id);
    }

    // 6. Unify into ledger rows. Supplier-payable convention: a receipt raises
    //    what we owe (credit); a payment lowers it (debit).
    const rowsAll = [];
    for (const po of pos) {
      const amount = round4(po.total);
      rowsAll.push({
        id: `PO-${po.id}`,
        type: "purchase_order",
        sourceId: po.id,
        sourceNumber: po.id,
        date: ((po.receivedDate || po.date) || "").slice(0, 10),
        createdAt: po.createdAt,
        description: `استلام أمر شراء ${po.id}`,
        debit: 0,
        credit: amount,
        sortType: "0_po",
      });
    }
    for (const tx of payTx) {
      if (!tx.reference || !supplierPoIds.has(tx.reference)) continue; // only this supplier's payments
      const amount = round4(tx.amount);
      rowsAll.push({
        id: `TX-${tx.id}`,
        type: "supplier_payment",
        sourceId: tx.id,
        sourceNumber: tx.reference || tx.id,
        date: (tx.date || "").slice(0, 10),
        createdAt: tx.createdAt,
        description: tx.description || `سداد للمورّد (${tx.reference})`,
        debit: amount,
        credit: 0,
        sortType: "1_payment",
      });
    }

    // 7. Deterministic order so the running balance is stable.
    rowsAll.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      const ca = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const cb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (ca !== cb) return ca - cb;
      if (a.sortType !== b.sortType) return a.sortType < b.sortType ? -1 : 1;
      return a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0;
    });

    // 8. Opening = full aggregate BEFORE `from` (0 when no `from`); period =
    //    rows within [from,to]; running computed across the WHOLE period set,
    //    then the page is sliced. delta = credit - debit (payable view).
    let openingBalance = 0;
    const periodRows = [];
    for (const r of rowsAll) {
      const delta = round4(r.credit - r.debit);
      if (from && r.date < from) {
        openingBalance = round4(openingBalance + delta);
        continue;
      }
      if (to && r.date > to) continue;
      periodRows.push({ ...r, delta });
    }

    let running = openingBalance;
    const withRunning = periodRows.map((r) => {
      running = round4(running + r.delta);
      return {
        id: r.id,
        type: r.type,
        sourceId: r.sourceId,
        sourceNumber: r.sourceNumber,
        date: r.date,
        description: r.description,
        debit: r.debit,
        credit: r.credit,
        delta: r.delta,
        runningBalance: running,
      };
    });

    const total = withRunning.length;
    const totalPages = Math.ceil(total / pageSize);
    const closingBalance = total ? withRunning[total - 1].runningBalance : openingBalance;
    const start = (page - 1) * pageSize;
    const items = withRunning.slice(start, start + pageSize);

    // 9. Supplier.due is reference-only; difference reported, never fixed.
    const supplierDueReference = round4(supplier.due);
    const difference = round4(supplierDueReference - closingBalance);

    return res.status(200).json({
      success: true,
      data: {
        supplier: {
          id: supplier.id,
          name: supplier.name,
          phone: supplier.phone,
          due: supplierDueReference,
        },
        from,
        to,
        openingBalance,
        closingBalance,
        supplierDueReference,
        difference,
        page,
        pageSize,
        total,
        totalPages,
        items,
        meta: { source: "source_documents", ledgerBased: false, readOnly: true, dueReferenceReliable: false },
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get("/suppliers/:id/consignments", authMiddleware, async (req, res, next) => {
  try {
    const supplierId = req.params.id;
    const consignments = await models.SupplierConsignment.findAll({ where: { supplierId } });
    return res.status(200).json({ success: true, data: consignments });
  } catch (error) {
    next(error);
  }
});

router.get("/suppliers/:id/documents", authMiddleware, async (req, res, next) => {
  try {
    const supplierId = req.params.id;
    const docs = await models.SupplierDocument.findAll({ where: { supplierId } });
    return res.status(200).json({ success: true, data: docs });
  } catch (error) {
    next(error);
  }
});

router.post("/suppliers/:id/documents", authMiddleware, uploadMiddleware.single("file"), async (req, res, next) => {
  try {
    const supplierId = req.params.id;
    const file = req.file;

    // 1. Validate supplier exists and belongs to company
    const supplier = await models.Supplier.findOne({
      where: { id: supplierId, companyId: req.companyId }
    });
    if (!supplier) {
      return res.status(404).json({ success: false, message: "المورد غير موجود" });
    }

    // 2. Validate permission
    const permissionService = require("../services/permission.service");
    const hasPermission = await permissionService.userHasAnyPermission(req.user, ["suppliers.update", "suppliers.documents.manage"]);
    if (!hasPermission) {
      return res.status(403).json({ success: false, message: "تم رفض الدخول. لا تملك الصلاحية اللازمة لإدارة مستندات الموردين." });
    }

    // 3. Validate file exists
    if (!file) {
      return res.status(400).json({ success: false, message: "يرجى اختيار ملف لرفعه." });
    }

    // 4. Save file to backend/uploads/supplier-documents
    const fs = require("fs");
    const path = require("path");
    const baseUploadDir = process.env.UPLOAD_DIR
      ? path.resolve(process.env.UPLOAD_DIR)
      : path.join(__dirname, "../../../uploads");
    const uploadDir = path.join(baseUploadDir, "supplier-documents");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const ext = path.extname(file.originalname).toLowerCase();
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    const fileName = `${supplierId}_${timestamp}_${random}${ext}`;
    const targetPath = path.join(uploadDir, fileName);

    // Copy temporary file to target directory and delete temp file
    fs.copyFileSync(file.path, targetPath);
    fs.unlinkSync(file.path);

    const fileUrl = `/uploads/supplier-documents/${fileName}`;

    // 5. Create SupplierDocument record in database
    const docId = `DOC-${Date.now()}`;
    const newDoc = await models.SupplierDocument.create({
      id: docId,
      supplierId,
      name: req.body.name || file.originalname,
      type: req.body.type || "Other",
      expiryDate: req.body.expiryDate || new Date().toISOString().slice(0, 10),
      url: fileUrl,
      fileName,
      originalFileName: file.originalname,
      mimeType: file.mimetype,
      fileSize: file.size,
      uploadedBy: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System",
      uploadedAt: new Date()
    });

    // 6. Write Audit Log
    const auditService = require("../services/audit.service");
    await auditService.record(req.companyId, {
      action: "SUPPLIER_DOCUMENT_UPLOADED",
      description: `تم رفع مستند ${newDoc.name} للمورد ${supplier.name}`,
      user: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System",
      userId: req.user ? req.user.id : null,
      place: req.branchId || "System",
      sourceDocument: supplier.id,
      severity: "info",
      after: JSON.stringify(newDoc.toJSON())
    });

    emitEntityChanged(req.companyId, {
      entity: "Attachment",
      action: "upload",
      id: docId,
      related: {
        supplierId: supplierId
      }
    });
    return res.status(201).json({
      success: true,
      data: newDoc
    });
  } catch (error) {
    next(error);
  }
});

router.delete("/suppliers/:id/documents/:docId", authMiddleware, async (req, res, next) => {
  try {
    const supplierId = req.params.id;
    const docId = req.params.docId;

    // 1. Validate supplier exists and belongs to company
    const supplier = await models.Supplier.findOne({
      where: { id: supplierId, companyId: req.companyId }
    });
    if (!supplier) {
      return res.status(404).json({ success: false, message: "المورد غير موجود" });
    }

    // 2. Validate permission
    const permissionService = require("../services/permission.service");
    const hasPermission = await permissionService.userHasAnyPermission(req.user, ["suppliers.update", "suppliers.documents.manage"]);
    if (!hasPermission) {
      return res.status(403).json({ success: false, message: "تم رفض الدخول. لا تملك الصلاحية اللازمة لإدارة مستندات الموردين." });
    }

    // 3. Find supplier document
    const doc = await models.SupplierDocument.findOne({
      where: { id: docId, supplierId }
    });
    if (!doc) {
      return res.status(404).json({ success: false, message: "المستند غير موجود" });
    }

    const docDataBefore = doc.toJSON();

    // 4. Delete physical file if exists
    if (doc.url) {
      const fs = require("fs");
      const path = require("path");
      const filename = path.basename(doc.url);
      const baseUploadDir = process.env.UPLOAD_DIR
        ? path.resolve(process.env.UPLOAD_DIR)
        : path.join(__dirname, "../../../uploads");
      const filePath = path.join(baseUploadDir, "supplier-documents", filename);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (fileErr) {
          logger.error(`Failed to delete physical file: ${filePath}`, fileErr);
        }
      }
    }

    // 5. Delete from database
    await doc.destroy();

    // 6. Write Audit Log
    const auditService = require("../services/audit.service");
    await auditService.record(req.companyId, {
      action: "SUPPLIER_DOCUMENT_DELETED",
      description: `تم حذف مستند ${doc.name} للمورد ${supplier.name}`,
      user: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System",
      userId: req.user ? req.user.id : null,
      place: req.branchId || "System",
      sourceDocument: supplier.id,
      severity: "info",
      before: JSON.stringify(docDataBefore)
    });

    emitEntityChanged(req.companyId, {
      entity: "Attachment",
      action: "delete",
      id: docId,
      related: {
        supplierId: supplierId
      }
    });
    return res.status(200).json({
      success: true,
      message: "تم حذف المستند بنجاح"
    });
  } catch (error) {
    next(error);
  }
});

// Asset Timeline Logs
router.get("/assets/:id/timeline", authMiddleware, async (req, res, next) => {
  try {
    const assetId = req.params.id;
    const events = await models.AssetEvent.findAll({ where: { assetId }, order: [["date", "DESC"]] });
    return res.status(200).json({ success: true, items: events, data: events });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POS — Pricing preview & invoice posting
// ─────────────────────────────────────────────────────────────────────────────

// Pricing preview — sums asset prices + charges, applies discount and VAT.
router.post("/pricing/calculate", authMiddleware, async (req, res, next) => {
  try {
    const { assetIds = [], discount = 0, makingCharge = 0, stoneValue = 0 } = req.body || {};

    const products = await models.Product.findAll({
      where: { id: assetIds, companyId: req.companyId }
    });

    const assets = await models.Asset.findAll({
      where: { id: assetIds, companyId: req.companyId }
    });

    const itemsMap = new Map();
    products.forEach(p => itemsMap.set(p.id, { price: Number(p.salePrice) || 0, cost: Number(p.unitCost) || 0 }));
    assets.forEach(a => itemsMap.set(a.id, { price: Number(a.price) || 0, cost: Number(a.cost) || 0 }));

    let basePrice = 0;
    let cost = 0;
    const items = [];

    for (const id of assetIds) {
      const match = itemsMap.get(id);
      if (match) {
        basePrice += match.price;
        cost += match.cost;
        items.push({ assetId: id, price: String(match.price) });
      }
    }

    const settings = await settingsService.getCompanySettings(req.companyId);

    // VAT/totals via the SHARED sales service so preview == checkout exactly.
    // `taxBase` is the net-of-VAT amount (= total - tax) used for revenue posting.
    const { taxBase, tax, total, vatRate: vatRatePercent } = salesService.computeTotals({
      subtotal: basePrice,
      makingCharge: Number(makingCharge),
      stoneValue: Number(stoneValue),
      discount: Number(discount),
      vatRatePercent: settings.vatRate,
    });
    const journalPreview = postingService.previewInvoiceLines({
      total, tax, subtotal: taxBase, cost,
      paymentMethod: req.body.paymentMethod || "Cash",
      status: req.body.status || "paid"
    });

    // Top-level fields for direct front-end binding + nested data envelope.
    const payload = {
      subtotal: String(taxBase),
      tax: String(tax),
      total: String(total),
      vatRate: vatRatePercent,
      items,
      journalPreview
    };
    return res.status(200).json({ success: true, ...payload, data: payload });
  } catch (error) {
    next(error);
  }
});

// Create a sales invoice (draft/post). Idempotent on Idempotency-Key header.
router.post("/sales/invoices/draft", authMiddleware, requirePermission("sales.create"), async (req, res, next) => {
  try {
    const body = req.body || {};
    const idempotencyKey = req.headers["idempotency-key"] || body.idempotencyKey;

    // Return the existing invoice if this key was already used (idempotency).
    if (idempotencyKey) {
      const existing = await models.Invoice.findOne({
        where: { idempotencyKey, companyId: req.companyId }
      });
      if (existing) {
        return res.status(200).json({ success: true, ...existing.toJSON(), data: existing.toJSON() });
      }
    }

    const id = body.id || `INV-${Date.now()}`;
    const now = new Date().toISOString().slice(0, 16).replace("T", " ");
    const items = Array.isArray(body.items) ? body.items : [];

    // VAT rate from settings (single source of truth) — stored on the invoice
    // so receipts/reports can show the exact rate applied at the time of sale.
    const draftSettings = await settingsService.getCompanySettings(req.companyId);
    const vatRatePercent = Number(draftSettings.vatRate) || 0;

    const invoice = await models.Invoice.create({
      id,
      companyId: req.companyId,
      type: body.type || "sale",
      customerId: body.customerId || "",
      customerName: body.customerName || "عميل نقدي",
      date: body.date || now,
      subtotal: body.subtotal || 0,
      total: body.total || 0,
      tax: body.tax || 0,
      vatRate: body.vatRate !== undefined ? Number(body.vatRate) : vatRatePercent,
      discount: body.discount || 0,
      makingCharge: body.makingCharge || 0,
      stoneValue: body.stoneValue || 0,
      deposit: body.deposit || 0,
      status: body.status || "paid",
      paymentMethod: body.paymentMethod || "Cash",
      paymentSplits: body.paymentSplits || [],
      branch: body.branch || req.branchId || "Main Branch",
      notes: body.notes || "",
      idempotencyKey: idempotencyKey || null,
      postingStatus: "posted", // legacy misnamed immediate-post route (used by reservations)
      invoiceNumber: id,
      postedAt: now
    });

    // Phase 16B — resolve COGS book cost SERVER-SIDE (Asset.cost / Product
    // .averageCost). Never trust the client-supplied item.cost. Selling fields
    // (price/qty/discount/tax) are kept from the request unchanged.
    const safeItems = [];
    for (const item of items) {
      const refId = item.assetId || item.id;
      let serverCost = 0;
      if (refId) {
        const asset = await models.Asset.findOne({ where: { id: refId, companyId: req.companyId } });
        if (asset) {
          serverCost = Number(asset.cost) || 0;
        } else {
          const product = await models.Product.findOne({ where: { id: refId, companyId: req.companyId } });
          if (product) serverCost = Number(product.averageCost) || Number(product.unitCost) || 0;
        }
      }
      safeItems.push({ ...item, cost: serverCost });
    }

    // Persist line items (server book cost) and mark the sold assets.
    for (const item of safeItems) {
      await models.InvoiceItem.create({
        invoiceId: id,
        assetId: item.assetId || item.id,
        name: item.name || "",
        quantity: item.quantity || 1,
        price: item.price || 0,
        cost: item.cost,
        weight: item.weight || item.grossWeight || 0,
        karat: item.karat || null,
        discount: item.discount || 0,
        makingCharge: item.makingCharge || 0,
        stoneValue: item.stoneValue || 0
      });
      if (item.assetId || item.id) {
        await models.Asset.update(
          { status: "sold" },
          { where: { id: item.assetId || item.id, companyId: req.companyId } }
        );
      }
    }

    // ── Auto-post the double-entry journal (Financial Posting Engine) ──
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    const inv = invoice.toJSON();
    inv.downPayment = Number(body.downPayment) || 0;
    let journalEntry = null;
    try {
      if (inv.type === "return") {
        journalEntry = await postingService.postReturnEntry(inv, items, actor);
      } else if (inv.type === "deposit") {
        journalEntry = await postingService.postDepositEntry(inv, actor);
      } else {
        journalEntry = await postingService.postInvoiceEntry(inv, safeItems, actor);
      }
    } catch (postErr) {
      // Never let a posting issue lose the sale; surface it instead.
      logger.error(`[Posting] Failed to post journal for invoice ${id}: ${postErr.message}`);
    }

    // ── Generate the installment schedule for installment sales ──
    // Uses the SAME shared scheduler as /pos/checkout so both paths agree.
    let installments = [];
    if (inv.type === "installment") {
      const financed = Math.max(0, Number(inv.total) - inv.downPayment);
      const schedule = salesService.buildInstallmentSchedule({
        remaining: financed,
        installmentCount: Math.max(1, parseInt(body.installmentCount) || 1),
        frequency: body.installmentFrequency || draftSettings.installment.defaultFrequency || "monthly",
        firstDueDate: body.firstDueDate || body.date,
        customDays: body.customDays,
      });
      for (const inst of schedule) {
        const row = await models.Installment.create({
          id: `INST-${id}-${inst.sequence}`,
          companyId: req.companyId,
          invoiceId: id,
          customerId: inv.customerId,
          customerName: inv.customerName,
          sequence: inst.sequence,
          dueDate: inst.dueDate,
          amount: inst.amount,
          paidAmount: 0,
          status: "pending",
          branch: inv.branch
        });
        installments.push(row.toJSON());
      }
    }

    // ── Award loyalty points + refresh segment for real customer sales ──
    let loyalty = null;
    if ((inv.type === "sale" || inv.type === "installment") && inv.customerId) {
      try {
        const customer = await models.Customer.findOne({ where: { id: inv.customerId, companyId: req.companyId } });
        if (customer) loyalty = await awardLoyaltyForSale(req.companyId, customer, Number(inv.total) || 0, id);
      } catch (loyErr) {
        logger.error(`[Loyalty] Failed to award points for invoice ${id}: ${loyErr.message}`);
      }
    }

    const out = invoice.toJSON();
    out.journalEntry = journalEntry;
    out.installments = installments;
    out.loyalty = loyalty;
    out.items = items; // line items live in a separate table — echo them for the receipt
    // Realtime: a POS sale touches invoices, inventory, accounts & customers.
    emitEntityChanged(req.companyId, { entity: "Invoice", action: inv.type || "create", id });
    await notificationService.createNotification(req.companyId, {
      title: "Sale created",
      message: `Invoice ${id} was created for ${inv.customerName || "customer"}.`,
      type: "success",
      entityType: "Invoice",
      entityId: id
    });
    return res.status(201).json({ success: true, ...out, data: out });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// INVOICE DRAFT LIFECYCLE (P4.2) — create / edit / cancel a DRAFT only.
// A draft has ZERO side effects: no inventory, no journal, no payment/cash, no
// customer balance, no loyalty, no postedAt. Posting a draft is P4.3 (separate).
// These are the official lifecycle endpoints; generic CRUD remains blocked from
// touching lifecycle fields (P4.1a).
// ─────────────────────────────────────────────────────────────────────────────

// Lifecycle fields a draft edit must never accept directly (mirrors P4.1a).
const DRAFT_PROTECTED_FIELDS = [
  "postingStatus", "posting_status",
  "postedAt", "posted_at",
  "cancelledAt", "cancelled_at",
  "cancelReason", "cancel_reason"
];

// Validate + normalize the items array for a draft. Each item must reference an
// existing asset of this company (we do NOT change the asset — drafts are
// side-effect free). Returns the rows to persist.
async function buildDraftItems(items, companyId, transaction) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new ValidationError("لا يمكن إنشاء مسودة بدون أصناف");
  }
  const rows = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const assetId = it.assetId || it.id;
    if (!assetId) throw new ValidationError(`الصنف رقم ${i + 1} بدون معرف أصل`);
    const asset = await models.Asset.findOne({ where: { id: assetId, companyId }, transaction });
    if (!asset) throw new ValidationError(`الأصل ${assetId} غير موجود`);
    rows.push({
      assetId,
      name: it.name || asset.name || "",
      quantity: it.quantity || 1,
      price: Number(it.price) || 0,
      // Phase 16B — COGS book cost is server-sourced (Asset.cost), never the
      // client-supplied it.cost. (buildDraftItems is asset-only.)
      cost: Number(asset.cost) || 0,
      weight: Number(it.weight || it.grossWeight) || 0,
      karat: it.karat ?? null,
      discount: Number(it.discount) || 0,
      makingCharge: Number(it.makingCharge) || 0,
      stoneValue: Number(it.stoneValue) || 0
    });
  }
  return rows;
}

// Resolve + validate the branch for a draft; returns the Branch record.
async function resolveDraftBranch(body, req, transaction) {
  const branchId = body.branchId || req.headers["x-branch-id"] || req.branchId;
  if (!branchId) throw new ValidationError("الفرع النشط مطلوب");
  const branch = await models.Branch.findOne({ where: { id: branchId, companyId: req.companyId, isActive: true }, transaction });
  if (!branch) throw new ValidationError("الفرع المحدد غير موجود أو غير نشط");
  return branch;
}

// 1) Create a DRAFT invoice (no side effects).
router.post("/sales/invoices/drafts", authMiddleware, requirePermission("sales.create"), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const body = req.body || {};
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    const idempotencyKey = req.headers["idempotency-key"] || body.idempotencyKey;

    // Idempotency: same key returns the existing draft instead of a new one.
    if (idempotencyKey) {
      const existing = await models.Invoice.findOne({
        where: { idempotencyKey, companyId: req.companyId },
        include: [{ model: models.InvoiceItem, as: "items" }],
        transaction: t
      });
      if (existing) {
        await t.rollback();
        return res.status(200).json({ success: true, ...existing.toJSON(), data: existing.toJSON() });
      }
    }

    // Validate customer exists.
    if (!body.customerId) throw new ValidationError("العميل مطلوب لإنشاء المسودة");
    const customer = await models.Customer.findOne({ where: { id: body.customerId, companyId: req.companyId }, transaction: t });
    if (!customer) throw new NotFoundError("العميل غير موجود");

    const branch = await resolveDraftBranch(body, req, t);
    const itemRows = await buildDraftItems(body.items, req.companyId, t);

    const draftSettings = await settingsService.getCompanySettings(req.companyId);
    const vatRatePercent = body.vatRate !== undefined ? Number(body.vatRate) : (Number(draftSettings.vatRate) || 0);
    const computedSubtotal = itemRows.reduce((s, r) => s + (Number(r.price) || 0), 0);
    const id = `DRAFT-${Date.now()}`;
    const now = new Date().toISOString().slice(0, 16).replace("T", " ");

    const invoice = await models.Invoice.create({
      id,
      companyId: req.companyId,
      type: body.type || "sale",
      customerId: customer.id,
      customerName: customer.name || body.customerName || "عميل",
      date: body.date || now,
      subtotal: body.subtotal !== undefined ? Number(body.subtotal) : computedSubtotal,
      total: body.total !== undefined ? Number(body.total) : computedSubtotal,
      tax: body.tax !== undefined ? Number(body.tax) : 0,
      vatRate: vatRatePercent,
      discount: Number(body.discount) || 0,
      makingCharge: Number(body.makingCharge) || 0,
      stoneValue: Number(body.stoneValue) || 0,
      status: "due", // payment status; a draft owes nothing yet but never "paid"
      postingStatus: "draft", // ← lifecycle: NO posting side effects
      paymentMethod: body.paymentMethod || "Cash",
      branch: branch.name,
      branchId: branch.id,
      notes: body.notes || "",
      idempotencyKey: idempotencyKey || null
      // NOTE: deliberately NO postedAt — a draft is not posted.
    }, { transaction: t });

    for (const r of itemRows) {
      await models.InvoiceItem.create({ invoiceId: id, ...r }, { transaction: t });
    }

    await auditService.record(req.companyId, {
      action: "invoice.draft.create",
      description: `Draft invoice ${id} created for ${customer.name || customer.id}`,
      user: actor,
      userId: req.user ? req.user.id : null,
      place: branch.name,
      branch: branch.name,
      sourceDocument: id,
      severity: "info",
      before: null,
      after: JSON.stringify({ id, postingStatus: "draft", total: invoice.total, items: itemRows.length })
    }, { transaction: t });

    await t.commit();
    emitEntityChanged(req.companyId, { entity: "Invoice", action: "draft-create", id, related: { customerId: customer.id } });
    const out = invoice.toJSON();
    out.items = itemRows;
    return res.status(201).json({ success: true, ...out, data: out });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

// 2) Edit a DRAFT invoice (draft only; no side effects).
router.patch("/sales/invoices/:id", authMiddleware, requirePermission("sales.create"), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const body = req.body || {};
    // Never allow lifecycle fields to be set through the edit route.
    if (DRAFT_PROTECTED_FIELDS.some((f) => Object.prototype.hasOwnProperty.call(body, f))) {
      await t.rollback();
      return res.status(403).json({ success: false, message: "Invoice lifecycle fields can only be changed through invoice lifecycle endpoints" });
    }

    const invoice = await models.Invoice.findOne({ where: { id: req.params.id, companyId: req.companyId }, transaction: t });
    if (!invoice) { await t.rollback(); return res.status(404).json({ success: false, message: "الفاتورة غير موجودة" }); }
    if (invoice.postingStatus !== "draft") {
      await t.rollback();
      return res.status(409).json({ success: false, message: "يمكن تعديل المسودات فقط (هذه الفاتورة ليست مسودة)" });
    }

    const before = invoice.toJSON();
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";

    // Allowed scalar fields.
    const updates = {};
    for (const f of ["customerId", "customerName", "date", "notes", "discount", "makingCharge", "stoneValue", "paymentMethod", "total", "subtotal", "tax", "type"]) {
      if (body[f] !== undefined) updates[f] = body[f];
    }
    if (body.customerId !== undefined) {
      const customer = await models.Customer.findOne({ where: { id: body.customerId, companyId: req.companyId }, transaction: t });
      if (!customer) throw new NotFoundError("العميل غير موجود");
      updates.customerName = body.customerName || customer.name;
    }
    if (body.branchId !== undefined || body.branch !== undefined) {
      const branch = await resolveDraftBranch(body, req, t);
      updates.branch = branch.name;
      updates.branchId = branch.id;
    }
    await invoice.update(updates, { transaction: t });

    // Replace items if provided — NO stock effects.
    let itemRows = null;
    if (Array.isArray(body.items)) {
      itemRows = await buildDraftItems(body.items, req.companyId, t);
      await models.InvoiceItem.destroy({ where: { invoiceId: invoice.id }, transaction: t });
      for (const r of itemRows) {
        await models.InvoiceItem.create({ invoiceId: invoice.id, ...r }, { transaction: t });
      }
    }

    await auditService.record(req.companyId, {
      action: "invoice.draft.update",
      description: `Draft invoice ${invoice.id} updated`,
      user: actor,
      userId: req.user ? req.user.id : null,
      place: invoice.branch,
      branch: invoice.branch,
      sourceDocument: invoice.id,
      severity: "info",
      before: JSON.stringify({ total: before.total, items: "(unchanged unless replaced)" }),
      after: JSON.stringify({ total: invoice.total, reason: body.reason || null, itemsReplaced: itemRows ? itemRows.length : false })
    }, { transaction: t });

    await t.commit();
    emitEntityChanged(req.companyId, { entity: "Invoice", action: "draft-update", id: invoice.id });
    const out = invoice.toJSON();
    if (itemRows) out.items = itemRows;
    return res.status(200).json({ success: true, ...out, data: out });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

// 3) Cancel a DRAFT invoice (draft only; no reversal needed — drafts have no effects).
router.post("/sales/invoices/:id/cancel", authMiddleware, requirePermission("sales.create"), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const body = req.body || {};
    const invoice = await models.Invoice.findOne({ where: { id: req.params.id, companyId: req.companyId }, transaction: t });
    if (!invoice) { await t.rollback(); return res.status(404).json({ success: false, message: "الفاتورة غير موجودة" }); }

    // Idempotent: already cancelled → return it unchanged, no side effects.
    if (invoice.postingStatus === "cancelled") {
      await t.rollback();
      return res.status(200).json({ success: true, ...invoice.toJSON(), data: invoice.toJSON() });
    }
    // Only drafts can be cancelled here; a posted invoice needs a return/void.
    if (invoice.postingStatus !== "draft") {
      await t.rollback();
      return res.status(409).json({ success: false, message: "لا يمكن إلغاء فاتورة مرحَّلة من هذا المسار — استخدم المرتجع/الإلغاء المحاسبي" });
    }

    const reason = (body.reason || "").trim();
    if (!reason) {
      await t.rollback();
      return res.status(422).json({ success: false, message: "سبب الإلغاء مطلوب" });
    }

    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    const now = new Date().toISOString().slice(0, 16).replace("T", " ");
    await invoice.update({ postingStatus: "cancelled", cancelledAt: now, cancelReason: reason }, { transaction: t });

    await auditService.record(req.companyId, {
      action: "invoice.draft.cancel",
      description: `Draft invoice ${invoice.id} cancelled: ${reason}`,
      user: actor,
      userId: req.user ? req.user.id : null,
      place: invoice.branch,
      branch: invoice.branch,
      sourceDocument: invoice.id,
      severity: "info",
      before: JSON.stringify({ postingStatus: "draft" }),
      after: JSON.stringify({ postingStatus: "cancelled", cancelledAt: now, cancelReason: reason })
    }, { transaction: t });

    await t.commit();
    emitEntityChanged(req.companyId, { entity: "Invoice", action: "draft-cancel", id: invoice.id });
    return res.status(200).json({ success: true, ...invoice.toJSON(), data: invoice.toJSON() });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

// 4) POST a DRAFT → posted (P4.3). Applies the full operational effects ONCE,
// in a single transaction, reusing the shared posting/sales services (the same
// ones /pos/checkout uses) — checkout itself is left untouched. Idempotent:
// guarded by row-lock + postingStatus, so retry/refresh cannot double-post.
//
// NOTE: the draft keeps its DRAFT-* id when posted (no PK change → no broken
// InvoiceItem FK). Assigning a final sequential invoice number at post time is a
// deliberate FOLLOW-UP (see docs) — not done here to avoid PK/relation risk.
router.post("/sales/invoices/:id/post", authMiddleware, requirePermission("sales.create"), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const body = req.body || {};
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    const idempotencyKey = req.headers["idempotency-key"] || body.idempotencyKey;

    // Lock the invoice row so concurrent posts serialize.
    const invoice = await models.Invoice.findOne({
      where: { id: req.params.id, companyId: req.companyId },
      lock: true,
      transaction: t
    });
    if (!invoice) { await t.rollback(); return res.status(404).json({ success: false, message: "الفاتورة غير موجودة" }); }

    // Already posted → idempotent return for the SAME key, else 409.
    if (invoice.postingStatus === "posted") {
      await t.rollback();
      if (idempotencyKey && invoice.idempotencyKey === idempotencyKey) {
        const items = await models.InvoiceItem.findAll({ where: { invoiceId: invoice.id } });
        const out = invoice.toJSON(); out.items = items;
        return res.status(200).json({ success: true, ...out, data: out });
      }
      return res.status(409).json({ success: false, message: "الفاتورة مرحَّلة بالفعل" });
    }
    if (invoice.postingStatus !== "draft") {
      await t.rollback();
      return res.status(409).json({ success: false, message: "لا يمكن ترحيل فاتورة ملغاة" });
    }

    // Re-validate customer + active branch at post time.
    const customer = await models.Customer.findOne({ where: { id: invoice.customerId, companyId: req.companyId }, transaction: t });
    if (!customer) throw new NotFoundError("العميل غير موجود");
    const branchId = invoice.branchId;
    const branchRecord = await models.Branch.findOne({ where: { id: branchId, companyId: req.companyId, isActive: true }, transaction: t });
    if (!branchRecord) throw new ValidationError("الفرع المحدد غير موجود أو غير نشط");

    // Draft items already exist; re-validate + LOCK each product/asset now
    // (a draft does not reserve stock, so availability must be re-checked).
    const draftItems = await models.InvoiceItem.findAll({ where: { invoiceId: invoice.id }, transaction: t });
    if (!draftItems.length) throw new ValidationError("لا يمكن ترحيل مسودة بدون أصناف");

    const validated = [];
    let subtotal = 0;
    for (const di of draftItems) {
      const itemId = di.assetId;
      const product = await models.Product.findOne({ where: { id: itemId, companyId: req.companyId }, lock: true, transaction: t });
      if (product) {
        const qty = Number(di.quantity) || 1;
        if (Number(product.quantityAvailable) < qty) {
          throw new ValidationError(`الكمية المطلوبة غير متاحة للمنتج ${product.productName}. المتاح: ${product.quantityAvailable}`);
        }
        if (product.branchId !== branchId) throw new ValidationError(`المنتج ${product.productName} تابع لفرع آخر`);
        validated.push({ isProduct: true, product, di, qty, price: Number(di.price) || 0, weight: Number(di.weight) || 0, cost: Number(di.cost) || 0 });
        subtotal += (Number(di.price) || 0) * qty;
      } else {
        const asset = await models.Asset.findOne({ where: { id: itemId, companyId: req.companyId }, lock: true, transaction: t });
        if (!asset) throw new ValidationError(`الأصل ${itemId} غير موجود`);
        if (asset.status !== "available") throw new ValidationError(`الأصل ${asset.name} (${asset.id}) غير متاح للبيع، حالته: ${asset.status}`);
        if (asset.branchId !== branchId) throw new ValidationError(`الأصل ${asset.name} تابع لفرع آخر`);
        validated.push({ isProduct: false, asset, di, price: Number(di.price) || 0, weight: Number(di.weight) || 0, cost: Number(di.cost) || 0 });
        subtotal += Number(di.price) || 0;
      }
    }

    // Totals + payment via the shared sales service (single source of truth).
    const settings = await settingsService.getCompanySettings(req.companyId, { transaction: t });
    const discount = Number(invoice.discount) || 0;
    const makingCharge = Number(invoice.makingCharge) || 0;
    const stoneValue = Number(invoice.stoneValue) || 0;
    const totals = salesService.computeTotals({ subtotal, makingCharge, stoneValue, discount, vatRatePercent: settings.vatRate });
    const paymentMethod = invoice.paymentMethod || "cash";
    const payment = salesService.resolvePayment({
      paymentMethod,
      total: totals.total,
      body: {
        downPayment: invoice.downPayment,
        installmentCount: invoice.installmentCount,
        installmentFrequency: invoice.installmentFrequency,
        firstDueDate: body.firstDueDate || invoice.date,
        deposit: invoice.deposit,
        paymentSplits: invoice.paymentSplits,
      },
      installmentRules: settings.installment,
      user: req.user,
    });
    const { paidAmount, remainingAmount, status, installmentsToCreate } = payment;
    const type = paymentMethod === "installment" ? "installment" : (paymentMethod === "deposit" ? "deposit" : (invoice.type || "sale"));
    const nowStr = new Date().toISOString().slice(0, 16).replace("T", " ");

    // Assign a final customer-facing number from the shared sequence (the draft
    // keeps its DRAFT-* id). Reuse an already-assigned number on idempotent retry.
    const prefix = settings.invoicePrefix || "INV-2026";
    const finalInvoiceNumber = invoice.invoiceNumber || (await nextInvoiceNumber(req.companyId, prefix, t));

    // Flip the draft to posted with the authoritative computed money fields.
    await invoice.update({
      type,
      subtotal: totals.taxBase, // net-of-VAT base so the journal balances (checkout convention)
      tax: totals.tax,
      vatRate: totals.vatRate,
      total: totals.total,
      paidAmount,
      remainingAmount,
      status,
      postingStatus: "posted",
      invoiceNumber: finalInvoiceNumber,
      postedAt: nowStr,
      idempotencyKey: idempotencyKey || invoice.idempotencyKey
    }, { transaction: t });

    // Inventory effects (InvoiceItems already exist — do NOT recreate them).
    for (const v of validated) {
      if (v.isProduct) {
        const product = v.product, qty = v.qty;
        product.quantityAvailable = Math.round((Number(product.quantityAvailable) - qty) * 100) / 100;
        product.quantityOnHand = Math.round((Number(product.quantityOnHand) - qty) * 100) / 100;
        product.quantitySold = Math.round((Number(product.quantitySold) + qty) * 100) / 100;
        product.totalWeight = Math.round((Number(product.totalWeight) - v.weight) * 10000) / 10000;
        await product.save({ transaction: t, skipAdjustmentHook: true });
        await models.StockMovement.create({
          id: `SM-SALE-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          companyId: req.companyId, productId: product.id, productCode: product.productCode,
          type: "sale", quantityIn: 0, quantityOut: qty, weightIn: 0, weightOut: v.weight,
          unitCost: v.cost, totalCost: v.cost * qty, referenceType: "Invoice", referenceId: invoice.id,
          customerId: customer.id, branchId, createdBy: actor
        }, { transaction: t });
      } else {
        const asset = v.asset;
        await asset.update({ status: "sold" }, { transaction: t });
        await models.AssetEvent.create({
          id: `ASE-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          assetId: asset.id, action: "SALE", date: nowStr.slice(0, 10), user: actor,
          branch: branchRecord.name, note: `تم البيع بموجب الفاتورة رقم ${invoice.id}`,
          sourceDocument: invoice.id, beforeState: "status:available", afterState: "status:sold"
        }, { transaction: t });
      }
    }

    // Payments (mirror checkout: split / installment down payment / single).
    const paymentsCreated = [];
    const mkPay = async (method, amount, notes) => {
      const p = await models.Payment.create({
        id: `PAY-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        companyId: req.companyId, branchId, invoiceId: invoice.id,
        paymentMethod: method, amount, reference: body.reference || "",
        date: invoice.date || nowStr.slice(0, 10), notes
      }, { transaction: t });
      paymentsCreated.push(p.toJSON());
    };
    if (paymentMethod === "split") {
      for (const s of (Array.isArray(invoice.paymentSplits) ? invoice.paymentSplits : [])) {
        await mkPay(s.method, s.amount, `دفع مجزأ للفاتورة ${invoice.id}`);
      }
    } else if (paymentMethod === "installment") {
      if (paidAmount > 0) await mkPay("cash", paidAmount, `دفعة أولى للفاتورة ${invoice.id}`);
    } else if (paidAmount > 0) {
      await mkPay(paymentMethod, paidAmount, paymentMethod === "deposit" ? `عربون للفاتورة ${invoice.id}` : `سداد للفاتورة ${invoice.id}`);
    }

    // Installment schedule.
    const createdInstallments = [];
    for (const inst of installmentsToCreate) {
      const row = await models.Installment.create({
        id: `INST-${invoice.id}-${inst.sequence}`, companyId: req.companyId, invoiceId: invoice.id,
        customerId: customer.id, customerName: customer.name, sequence: inst.sequence,
        dueDate: inst.dueDate, amount: inst.amount, paidAmount: 0, status: "pending", branch: branchRecord.name
      }, { transaction: t });
      createdInstallments.push(row.toJSON());
    }

    // Journal entry (balanced; failure throws → whole post rolls back).
    // Phase 16B — recompute COGS book cost SERVER-SIDE at post time (defense-in-
    // depth; also protects drafts saved before this fix). The stored
    // InvoiceItem.cost is NOT trusted for COGS. assetId may reference an Asset or
    // (for quantity products) a Product. No silent client/stored fallback.
    const safeDraftItems = [];
    for (const di of draftItems) {
      const d = di.toJSON();
      let serverCost = null;
      if (d.assetId) {
        const asset = await models.Asset.findOne({ where: { id: d.assetId, companyId: req.companyId }, transaction: t });
        if (asset) {
          serverCost = Number(asset.cost) || 0;
        } else {
          const product = await models.Product.findOne({ where: { id: d.assetId, companyId: req.companyId }, transaction: t });
          if (product) serverCost = Number(product.averageCost) || Number(product.unitCost) || 0;
        }
      }
      if (serverCost === null) throw new ValidationError(`تعذّر تحديد تكلفة الصنف ${d.assetId || d.id} من السيرفر للترحيل`);
      safeDraftItems.push({ ...d, cost: serverCost });
    }

    const invPlain = invoice.toJSON();
    invPlain.downPayment = Number(invoice.downPayment) || 0;
    let journalEntry;
    try {
      if (type === "deposit") {
        journalEntry = await postingService.postDepositEntry(invPlain, actor, { transaction: t });
      } else {
        journalEntry = await postingService.postInvoiceEntry(invPlain, safeDraftItems, actor, { transaction: t });
      }
    } catch (postErr) {
      logger.error(`[Posting] Failed to post journal for draft ${invoice.id}: ${postErr.message}`);
      throw new Error(`خطأ في إنشاء القيد المحاسبي: ${postErr.message}`);
    }

    // Treasury cash-in per payment.
    for (const pay of paymentsCreated) {
      const m = pay.paymentMethod.toLowerCase();
      const account = (m.includes("card") || m.includes("bank") || m.includes("transfer")) ? "bank" : "cash";
      await models.CashTransaction.create({
        id: `TX-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        companyId: req.companyId, branchId, branch: branchRecord.name, type: "cash_in", account,
        amount: pay.amount, category: type === "deposit" ? "عربون عميل" : "مبيعات مجوهرات",
        description: `مقبوضات فاتورة ${invoice.id} - ${pay.paymentMethod}`, reference: invoice.id,
        date: invoice.date || nowStr.slice(0, 10), status: "posted",
        createdBy: req.user ? req.user.id : "System", journalEntryId: journalEntry ? journalEntry.id : null
      }, { transaction: t });
    }

    // Loyalty + customer balance (only when something is owed) — inside the tx.
    const loyalty = await awardLoyaltyForSale(req.companyId, customer, totals.total, invoice.id, { transaction: t });
    if (remainingAmount > 0) {
      await customer.update(
        { balance: Math.round((Number(customer.balance || 0) + remainingAmount) * 100) / 100 },
        { transaction: t }
      );
    }

    await auditService.record(req.companyId, {
      action: "invoice.draft.post",
      description: `Draft invoice ${invoice.id} posted (total ${totals.total})`,
      user: actor, userId: req.user ? req.user.id : null,
      place: branchRecord.name, branch: branchRecord.name, sourceDocument: invoice.id,
      severity: "info",
      before: JSON.stringify({ postingStatus: "draft" }),
      after: JSON.stringify({ postingStatus: "posted", postedAt: nowStr, total: totals.total, paymentMethod, idempotencyKey: idempotencyKey || null })
    }, { transaction: t });

    const { recalculateCustomerNetPurchases } = require("../services/customer-purchases.service");
    await recalculateCustomerNetPurchases(models, req.companyId, customer.id, { transaction: t });

    await t.commit();
    emitEntityChanged(req.companyId, { entity: "Invoice", action: "post", id: invoice.id, branchId, related: { customerId: customer.id } });
    await notificationService.createNotification(req.companyId, {
      title: "ترحيل فاتورة", message: `تم ترحيل الفاتورة ${invoice.id} للعميل ${customer.name}.`,
      type: "success", entityType: "Invoice", entityId: invoice.id
    });

    const out = invoice.toJSON();
    out.journalEntry = journalEntry;
    out.payments = paymentsCreated;
    out.installments = createdInstallments;
    out.loyalty = loyalty;
    out.items = draftItems.map((d) => d.toJSON());
    return res.status(200).json({ success: true, ...out, data: out });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS BY KEY (إعدادات مفتاح/قيمة) — e.g. receipt customization
// ─────────────────────────────────────────────────────────────────────────────

// Read a settings document by key (returns its value JSON, or null).
// Per-user view preferences persisted via the settings table but excluded from
// the audit chain (they are convenience UI state, not operational config).
const SETTINGS_AUDIT_EXCLUDED_KEYS = new Set(["inventory-columns"]);

router.get("/settings/by-key/:key", authMiddleware, requirePermission("settings.view"), async (req, res, next) => {
  try {
    const row = await models.Setting.findOne({
      where: { companyId: req.companyId, key: req.params.key }
    });
    const value = row ? row.value : null;
    return res.status(200).json({ success: true, key: req.params.key, value, data: value });
  } catch (error) {
    next(error);
  }
});

// Upsert a settings document by key.
router.put("/settings/by-key/:key", authMiddleware, requirePermission("settings.update"), async (req, res, next) => {
  try {
    const value = req.body && req.body.value !== undefined ? req.body.value : req.body;
    const [row, created] = await models.Setting.findOrCreate({
      where: { companyId: req.companyId, key: req.params.key },
      defaults: { companyId: req.companyId, key: req.params.key, value }
    });
    const before = created ? null : row.value;
    if (!created) await row.update({ value });

    // Audit operational settings mutations (this by-key path previously wrote
    // no audit row, unlike PATCH /settings). Routed through auditService so it
    // joins the tamper-evident hash chain. Pure per-user view preferences
    // (e.g. inventory column visibility) are intentionally excluded so toggling
    // a column does not flood the financial audit chain with low-value rows.
    if (!SETTINGS_AUDIT_EXCLUDED_KEYS.has(req.params.key)) {
      await auditService.record(req.companyId, {
        action: "settings.update",
        description: `Setting "${req.params.key}" updated`,
        user: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System",
        userId: req.user ? req.user.id : null,
        place: req.branchId || "System",
        sourceDocument: req.params.key,
        severity: "info",
        before: before === null ? null : JSON.stringify(before),
        after: JSON.stringify(value)
      });
    }

    emitEntityChanged(req.companyId, { entity: "Settings", action: "update", id: req.params.key });
    return res.status(200).json({ success: true, key: req.params.key, value: row.value, data: row.value });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// IMMUTABLE AUDIT (سجل التدقيق غير القابل للتعديل) — append-only + hash chain
// ─────────────────────────────────────────────────────────────────────────────
const auditController = new ErpController(models.AuditLog, ["description", "user", "place", "action"]);

// List + read (reuse the generic controller's pagination/filtering).
router.get("/audit-logs", authMiddleware, auditController.list);

// Verify the tamper-evident hash chain. Registered before :id so "verify"
// is not captured as an audit id.
router.get("/audit-logs/verify", authMiddleware, async (req, res, next) => {
  try {
    const result = await auditService.verifyChain(req.companyId);
    return res.status(200).json({ success: true, ...result, data: result });
  } catch (error) {
    next(error);
  }
});

router.get("/audit-logs/:id", authMiddleware, auditController.getById);

// Append a new audit entry (chained + hashed). No update/delete routes exist.
router.post("/audit-logs", authMiddleware, async (req, res, next) => {
  try {
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : (req.body.user || "System");
    const row = await auditService.record(req.companyId, {
      ...req.body,
      user: req.body.user || actor,
      userId: req.body.userId || (req.user ? req.user.id : null)
    });
    return res.status(201).json({ success: true, ...row.toJSON(), data: row.toJSON() });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// LOYALTY & SEGMENTATION (الولاء وتقسيم العملاء)
// ─────────────────────────────────────────────────────────────────────────────

// Tunable loyalty rules.
const LOYALTY_EARN_RATE = 0.1; // points earned per 1 currency spent
const LOYALTY_REDEEM_RATE = 0.1; // currency value per 1 point redeemed
// Auto-tier thresholds by lifetime purchases.
const SEGMENT_THRESHOLDS = { VIP: 100000, Gold: 30000 };

function tierForPurchases(purchases) {
  const p = Number(purchases) || 0;
  if (p >= SEGMENT_THRESHOLDS.VIP) return "VIP";
  if (p >= SEGMENT_THRESHOLDS.Gold) return "Gold";
  return "Standard";
}

// Award loyalty points for a sale and refresh the customer's tier.
// Safe to call inside a sale flow — callers wrap it so it never blocks a sale.
async function awardLoyaltyForSale(companyId, customer, amount, invoiceId, opts = {}) {
  const pts = Math.floor(Number(amount) * LOYALTY_EARN_RATE);
  const newPurchases = parseFloat(customer.purchases || 0) + Number(amount);
  const newPoints = (customer.loyaltyPoints || 0) + pts;
  const tier = tierForPurchases(newPurchases);
  await customer.update(
    { purchases: newPurchases, loyaltyPoints: newPoints, tier, lastVisit: new Date().toISOString().slice(0, 10) },
    { transaction: opts.transaction }
  );
  if (pts > 0) {
    await models.LoyaltyTransaction.create({
      id: `LYT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      companyId, customerId: customer.id, customerName: customer.name,
      type: "earn", points: pts, balanceAfter: newPoints,
      invoiceId, date: new Date().toISOString().slice(0, 10)
    }, { transaction: opts.transaction });
  }
  return { points: pts, balance: newPoints, tier };
}

// Segment overview: customer counts and lifetime purchases per tier.
router.get("/loyalty/segments", authMiddleware, async (req, res, next) => {
  try {
    const customers = await models.Customer.findAll({ where: { companyId: req.companyId } });
    const segments = { VIP: { count: 0, purchases: 0, points: 0 }, Gold: { count: 0, purchases: 0, points: 0 }, Standard: { count: 0, purchases: 0, points: 0 } };
    customers.forEach((c) => {
      const tier = c.tier || "Standard";
      const s = segments[tier] || segments.Standard;
      s.count += 1;
      s.purchases += parseFloat(c.purchases || 0);
      s.points += c.loyaltyPoints || 0;
    });
    return res.status(200).json({ success: true, segments, thresholds: SEGMENT_THRESHOLDS, data: { segments } });
  } catch (error) {
    next(error);
  }
});

// Recompute every customer's tier from lifetime purchases.
router.post("/loyalty/recalculate-segments", authMiddleware, async (req, res, next) => {
  try {
    const customers = await models.Customer.findAll({ where: { companyId: req.companyId } });
    let updated = 0;
    for (const c of customers) {
      const tier = tierForPurchases(c.purchases);
      if (tier !== c.tier) { await c.update({ tier }); updated += 1; }
    }
    return res.status(200).json({ success: true, updated, total: customers.length, data: { updated } });
  } catch (error) {
    next(error);
  }
});

// Loyalty transactions ledger (optionally by customer).
router.get("/loyalty/transactions", authMiddleware, async (req, res, next) => {
  try {
    const where = { companyId: req.companyId };
    if (req.query.customerId) where.customerId = req.query.customerId;
    const rows = await models.LoyaltyTransaction.findAll({
      where, order: [["created_at", "DESC"]], limit: parseInt(req.query.pageSize) || 200
    });
    return res.status(200).json({ success: true, items: rows, data: { items: rows } });
  } catch (error) {
    next(error);
  }
});

// A customer's loyalty summary + recent ledger.
router.get("/customers/:id/loyalty", authMiddleware, async (req, res, next) => {
  try {
    const c = await models.Customer.findOne({ where: { id: req.params.id, companyId: req.companyId } });
    if (!c) return res.status(404).json({ success: false, message: "العميل غير موجود" });
    const ledger = await models.LoyaltyTransaction.findAll({
      where: { companyId: req.companyId, customerId: c.id }, order: [["created_at", "DESC"]], limit: 50
    });
    const out = {
      customerId: c.id, customerName: c.name, tier: c.tier,
      loyaltyPoints: c.loyaltyPoints || 0, purchases: parseFloat(c.purchases || 0),
      redeemValue: Math.round((c.loyaltyPoints || 0) * LOYALTY_REDEEM_RATE * 100) / 100,
      ledger
    };
    return res.status(200).json({ success: true, ...out, data: out });
  } catch (error) {
    next(error);
  }
});

// Manually award/earn points (by explicit points or by spend amount).
router.post("/customers/:id/loyalty/earn", authMiddleware, async (req, res, next) => {
  try {
    const c = await models.Customer.findOne({ where: { id: req.params.id, companyId: req.companyId } });
    if (!c) return res.status(404).json({ success: false, message: "العميل غير موجود" });
    const pts = req.body.points != null
      ? parseInt(req.body.points)
      : Math.floor((Number(req.body.amount) || 0) * LOYALTY_EARN_RATE);
    if (!pts || pts <= 0) return res.status(422).json({ success: false, message: "نقاط غير صالحة" });
    const newPoints = (c.loyaltyPoints || 0) + pts;
    await c.update({ loyaltyPoints: newPoints });
    const txn = await models.LoyaltyTransaction.create({
      id: `LYT-${Date.now()}`, companyId: req.companyId, customerId: c.id, customerName: c.name,
      type: "earn", points: pts, balanceAfter: newPoints, date: new Date().toISOString().slice(0, 10),
      notes: req.body.notes || null
    });
    return res.status(201).json({ success: true, balance: newPoints, ...txn.toJSON(), data: txn.toJSON() });
  } catch (error) {
    next(error);
  }
});

// Redeem points for monetary value (returns the value the POS can apply).
router.post("/customers/:id/loyalty/redeem", authMiddleware, async (req, res, next) => {
  try {
    const c = await models.Customer.findOne({ where: { id: req.params.id, companyId: req.companyId } });
    if (!c) return res.status(404).json({ success: false, message: "العميل غير موجود" });
    const pts = parseInt(req.body.points);
    if (!pts || pts <= 0) return res.status(422).json({ success: false, message: "نقاط غير صالحة" });
    if (pts > (c.loyaltyPoints || 0)) {
      return res.status(409).json({ success: false, message: "النقاط المطلوبة أكبر من الرصيد" });
    }
    const value = Math.round(pts * LOYALTY_REDEEM_RATE * 100) / 100;
    const newPoints = (c.loyaltyPoints || 0) - pts;
    await c.update({ loyaltyPoints: newPoints });
    const txn = await models.LoyaltyTransaction.create({
      id: `LYT-${Date.now()}`, companyId: req.companyId, customerId: c.id, customerName: c.name,
      type: "redeem", points: -pts, value, balanceAfter: newPoints, invoiceId: req.body.invoiceId || null,
      date: new Date().toISOString().slice(0, 10)
    });
    return res.status(201).json({ success: true, balance: newPoints, value, ...txn.toJSON(), data: txn.toJSON() });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PAYROLL & ATTENDANCE (الرواتب والحضور)
// ─────────────────────────────────────────────────────────────────────────────

// Attendance list (filter by employee / date).
router.get("/attendance", authMiddleware, async (req, res, next) => {
  try {
    const where = { companyId: req.companyId };
    if (req.query.employeeId) where.employeeId = req.query.employeeId;
    if (req.query.date) where.date = req.query.date;
    const rows = await models.Attendance.findAll({
      where, order: [["date", "DESC"], ["created_at", "DESC"]], limit: parseInt(req.query.pageSize) || 300
    });
    return res.status(200).json({ success: true, items: rows, data: { items: rows } });
  } catch (error) {
    next(error);
  }
});

// Check-in: create today's attendance row for an employee.
router.post("/attendance/check-in", authMiddleware, async (req, res, next) => {
  try {
    const emp = await models.Employee.findOne({ where: { id: req.body.employeeId, companyId: req.companyId } });
    if (!emp) return res.status(404).json({ success: false, message: "الموظف غير موجود" });
    const today = new Date().toISOString().slice(0, 10);
    let row = await models.Attendance.findOne({ where: { companyId: req.companyId, employeeId: emp.id, date: today } });
    if (row && row.checkIn) {
      return res.status(409).json({ success: false, message: "تم تسجيل الحضور بالفعل اليوم" });
    }
    const now = new Date().toISOString();
    if (row) {
      await row.update({ checkIn: now });
    } else {
      row = await models.Attendance.create({
        id: `ATT-${emp.id}-${today}`, companyId: req.companyId, employeeId: emp.id, employeeName: emp.name,
        date: today, checkIn: now, status: "present", branch: emp.branch
      });
    }
    return res.status(201).json({ success: true, ...row.toJSON(), data: row.toJSON() });
  } catch (error) {
    next(error);
  }
});

// Check-out: stamp check-out and compute hours worked.
router.post("/attendance/check-out", authMiddleware, async (req, res, next) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const row = await models.Attendance.findOne({ where: { companyId: req.companyId, employeeId: req.body.employeeId, date: today } });
    if (!row || !row.checkIn) return res.status(404).json({ success: false, message: "لا يوجد تسجيل حضور اليوم" });
    const now = new Date();
    const hours = Math.round(((now - new Date(row.checkIn)) / 3600000) * 100) / 100;
    await row.update({ checkOut: now.toISOString(), hours: hours > 0 ? hours : 0 });
    return res.status(200).json({ success: true, ...row.toJSON(), data: row.toJSON() });
  } catch (error) {
    next(error);
  }
});

// Payslips list (filter by period / status / employee).
router.get("/payslips", authMiddleware, async (req, res, next) => {
  try {
    const where = { companyId: req.companyId };
    if (req.query.period) where.period = req.query.period;
    if (req.query.status) where.status = req.query.status;
    if (req.query.employeeId) where.employeeId = req.query.employeeId;
    const rows = await models.Payslip.findAll({
      where, order: [["period", "DESC"], ["employee_name", "ASC"]], limit: parseInt(req.query.pageSize) || 300
    });
    return res.status(200).json({ success: true, items: rows, data: { items: rows } });
  } catch (error) {
    next(error);
  }
});

// Generate draft payslips for all active employees for a period (YYYY-MM).
router.post("/payroll/generate", authMiddleware, async (req, res, next) => {
  try {
    const period = req.body.period || new Date().toISOString().slice(0, 7);
    const employees = await models.Employee.findAll({ where: { companyId: req.companyId, status: ["present", "leave"] } });
    const created = [];
    for (const e of employees) {
      const exists = await models.Payslip.findOne({ where: { companyId: req.companyId, employeeId: e.id, period } });
      if (exists) continue;
      const base = parseFloat(e.baseSalary || 0);
      const allow = parseFloat(e.allowances || 0);
      const net = Math.round((base + allow) * 100) / 100;
      const slip = await models.Payslip.create({
        id: `PS-${period}-${e.id}`, companyId: req.companyId, employeeId: e.id, employeeName: e.name,
        period, baseSalary: base, allowances: allow, overtime: 0, deductions: 0, net,
        status: "draft", branch: e.branch
      });
      created.push(slip.toJSON());
    }
    return res.status(201).json({ success: true, created: created.length, items: created, data: { items: created } });
  } catch (error) {
    next(error);
  }
});

// Pay a payslip + auto-post the salary journal entry.
router.post("/payslips/:id/pay", authMiddleware, async (req, res, next) => {
  try {
    const slip = await models.Payslip.findOne({ where: { id: req.params.id, companyId: req.companyId } });
    if (!slip) return res.status(404).json({ success: false, message: "كشف الراتب غير موجود" });

    // Idempotency: a retry of the same pay request returns the already-paid
    // payslip instead of posting the salary payment twice.
    const idempotencyKey = req.headers["idempotency-key"] || req.body.idempotencyKey;
    if (idempotencyKey && slip.idempotencyKey === idempotencyKey) {
      const out = slip.toJSON();
      return res.status(200).json({ success: true, ...out, data: out });
    }

    if (slip.status === "paid") return res.status(409).json({ success: false, message: "تم صرف الراتب بالفعل" });

    const method = req.body.paymentMethod || "Cash";
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    let journalEntry = null;
    try {
      journalEntry = await postingService.postPayrollEntry(slip.toJSON(), method, actor);
    } catch (postErr) {
      logger.error(`[Payroll] Failed to post payslip ${slip.id}: ${postErr.message}`);
    }
    await slip.update({
      status: "paid", paidDate: new Date().toISOString().slice(0, 10),
      paymentMethod: method, journalEntryId: journalEntry ? journalEntry.id : null,
      idempotencyKey: idempotencyKey || slip.idempotencyKey
    });
    const out = slip.toJSON();
    out.journalEntry = journalEntry;
    return res.status(200).json({ success: true, ...out, data: out });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GOLD CENTER (مركز الذهب) — karat prices, item quoting & rate fixing
// ─────────────────────────────────────────────────────────────────────────────

// Latest manual gold-price row for a karat, TENANT-SAFE: prefer the company's
// own price, else fall back to a legacy/global row (company_id IS NULL). A
// company NEVER reads another company's price.
async function findLatestGoldPrice(companyId, currency, karat) {
  const k = parseInt(karat);
  let row = await models.GoldPrice.findOne({ where: { companyId, currency, karat: k }, order: [["updated_at", "DESC"]] });
  if (!row) row = await models.GoldPrice.findOne({ where: { companyId: null, currency, karat: k }, order: [["updated_at", "DESC"]] });
  return row;
}

// Effective per-gram rate for a karat: a manual daily fixing wins over the
// live-derived rate, so quotes and fixings honour the rate the shop set.
async function effectiveKaratPrice(companyId, currency, karat) {
  const override = await findLatestGoldPrice(companyId, currency, karat);
  if (override) return parseFloat(override.pricePerGram);
  const snap = await goldService.getKaratPrices(currency, [parseInt(karat)]);
  return snap.prices[0].pricePerGram;
}

// Derived per-gram karat prices (from the live feed) merged with any manual
// daily fixings stored in gold_prices (manual overrides win).
router.get("/gold/karat-prices", authMiddleware, async (req, res, next) => {
  try {
    const currency = req.query.currency || "AED";
    const snap = await goldService.getKaratPrices(currency);
    // Tenant-safe: the company's own prices win per karat; legacy/global
    // (company_id NULL) rows only fill karats the company has not fixed.
    const companyOverrides = await models.GoldPrice.findAll({
      where: { companyId: req.companyId, currency },
      order: [["updated_at", "DESC"]]
    });
    const legacyOverrides = await models.GoldPrice.findAll({
      where: { companyId: null, currency },
      order: [["updated_at", "DESC"]]
    });
    const byKarat = {};
    companyOverrides.forEach((o) => { if (!byKarat[o.karat]) byKarat[o.karat] = o; });
    legacyOverrides.forEach((o) => { if (!byKarat[o.karat]) byKarat[o.karat] = o; });
    const prices = snap.prices.map((p) => {
      const o = byKarat[p.karat];
      return o
        ? { ...p, pricePerGram: parseFloat(o.pricePerGram), source: "manual", updatedBy: o.updatedBy }
        : { ...p, source: "live" };
    });
    return res.status(200).json({ success: true, ...snap, prices, data: { ...snap, prices } });
  } catch (error) {
    next(error);
  }
});

// Manually fix (lock) today's per-gram price for one or more karats.
router.post("/gold/karat-prices", authMiddleware, async (req, res, next) => {
  try {
    const currency = req.body.currency || "AED";
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    const entries = Array.isArray(req.body.prices) ? req.body.prices : [];
    if (!entries.length) {
      return res.status(422).json({ success: false, message: "لا توجد أسعار للحفظ" });
    }
    const saved = [];
    const auditChanges = [];
    for (const e of entries) {
      const karat = parseInt(e.karat);
      const newPrice = Number(e.pricePerGram);
      // Previous effective price for this karat (company-scoped), for the audit "before".
      const prev = await findLatestGoldPrice(req.companyId, currency, karat);
      const row = await models.GoldPrice.create({
        karat,
        pricePerGram: newPrice,
        currency,
        updatedBy: actor,
        companyId: req.companyId, // tenant-scoped write
        source: "manual"
      });
      saved.push(row.toJSON());
      auditChanges.push({ karat, oldPrice: prev ? Number(prev.pricePerGram) : null, newPrice });
    }

    // Audit the manual gold-price fixing (was previously unaudited). Each POST
    // appends a new gold_prices row, so the row log IS the price history; this
    // records the before/after in the tamper-evident chain too.
    await auditService.record(req.companyId, {
      action: "gold_price.update",
      description: `Gold prices updated (${currency}): ${auditChanges.map((c) => `${c.karat}K ${c.oldPrice ?? "-"}→${c.newPrice}`).join(", ")}`,
      user: actor,
      userId: req.user ? req.user.id : null,
      place: req.branchId || "System",
      sourceDocument: "gold-prices",
      severity: "info",
      before: JSON.stringify(auditChanges.map((c) => ({ karat: c.karat, pricePerGram: c.oldPrice }))),
      after: JSON.stringify(auditChanges.map((c) => ({ karat: c.karat, pricePerGram: c.newPrice, source: "manual" })))
    });

    return res.status(201).json({ success: true, items: saved, data: { items: saved } });
  } catch (error) {
    next(error);
  }
});

// Quote an item: metal value + making charge + stone value + VAT.
router.post("/gold/quote", authMiddleware, async (req, res, next) => {
  try {
    const settings = await settingsService.getCompanySettings(req.companyId);
    const currency = req.body.currency || settings.currency || "AED";
    const karat = Number(req.body.karat) || 21;
    const perGram = await effectiveKaratPrice(req.companyId, currency, karat);
    const quote = await goldService.quoteItem({
      grossWeight: Number(req.body.grossWeight) || 0,
      karat,
      makingCharge: Number(req.body.makingCharge) || 0,
      stoneValue: Number(req.body.stoneValue) || 0,
      currency,
      vatRate: (Number(settings.vatRate) || 0) / 100,
      perGram
    });
    return res.status(200).json({ success: true, ...quote, data: quote });
  } catch (error) {
    next(error);
  }
});

// List gold fixings (optionally by status).
router.get("/gold/fixings", authMiddleware, async (req, res, next) => {
  try {
    const where = { companyId: req.companyId };
    if (req.query.status) where.status = req.query.status;
    const rows = await models.GoldFixing.findAll({
      where,
      order: [["created_at", "DESC"]],
      limit: parseInt(req.query.pageSize) || 200
    });
    return res.status(200).json({ success: true, items: rows, data: { items: rows } });
  } catch (error) {
    next(error);
  }
});

// Fix (lock) the rate for a gold weight position at the current/quoted rate.
router.post("/gold/fixings", authMiddleware, async (req, res, next) => {
  try {
    const b = req.body || {};
    const currency = b.currency || "AED";
    const karat = parseInt(b.karat) || 21;
    const grossWeight = Number(b.grossWeight) || 0;
    if (grossWeight <= 0) {
      return res.status(422).json({ success: false, message: "الوزن يجب أن يكون أكبر من صفر" });
    }
    // Use the supplied rate, otherwise lock at the effective karat price
    // (manual daily fixing wins over the live-derived rate).
    let ratePerGram = Number(b.ratePerGram);
    if (!ratePerGram || ratePerGram <= 0) {
      ratePerGram = await effectiveKaratPrice(req.companyId, currency, karat);
    }
    const purity = Number(b.purity) || goldService.constructor.purityFor(karat);
    const fineWeight = Math.round(grossWeight * purity * 10000) / 10000;
    const value = Math.round(grossWeight * ratePerGram * 100) / 100;
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";

    const fixing = await models.GoldFixing.create({
      id: `GF-${Date.now()}`,
      companyId: req.companyId,
      customerId: b.customerId || null,
      customerName: b.customerName || null,
      direction: b.direction === "sell" ? "sell" : "buy",
      karat,
      grossWeight,
      fineWeight,
      ratePerGram,
      value,
      currency,
      status: "fixed",
      fixedAt: new Date().toISOString(),
      fixedBy: actor,
      notes: b.notes || null
    });

    return res.status(201).json({ success: true, ...fixing.toJSON(), data: fixing.toJSON() });
  } catch (error) {
    next(error);
  }
});

// Unfix (release) a fixing back to a floating weight position.
router.post("/gold/fixings/:id/unfix", authMiddleware, async (req, res, next) => {
  try {
    const fixing = await models.GoldFixing.findOne({
      where: { id: req.params.id, companyId: req.companyId }
    });
    if (!fixing) return res.status(404).json({ success: false, message: "التثبيت غير موجود" });
    if (fixing.status === "settled") {
      return res.status(409).json({ success: false, message: "تمت تسوية هذا التثبيت ولا يمكن فكّه" });
    }
    await fixing.update({ status: "unfixed", unfixedAt: new Date().toISOString() });
    return res.status(200).json({ success: true, ...fixing.toJSON(), data: fixing.toJSON() });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// INSTALLMENTS (التقسيط) — schedule listing & collection
// ─────────────────────────────────────────────────────────────────────────────

// List installments (optionally by invoice or status), newest due first.
router.get("/installments", authMiddleware, async (req, res, next) => {
  try {
    const where = { companyId: req.companyId };
    if (req.query.invoiceId) where.invoiceId = req.query.invoiceId;
    if (req.query.status) where.status = req.query.status;
    const rows = await models.Installment.findAll({
      where,
      order: [["due_date", "ASC"]],
      limit: parseInt(req.query.pageSize) || 200
    });
    return res.status(200).json({ success: true, items: rows, data: { items: rows } });
  } catch (error) {
    next(error);
  }
});

// Pay (collect) an installment + auto-post the journal.
router.post("/installments/:id/pay", authMiddleware, async (req, res, next) => {
  try {
    const inst = await models.Installment.findOne({
      where: { id: req.params.id, companyId: req.companyId }
    });
    if (!inst) return res.status(404).json({ success: false, message: "القسط غير موجود" });

    // Idempotency: a retry of the exact same payment request returns the
    // already-applied installment instead of charging it again.
    const idempotencyKey = req.headers["idempotency-key"] || req.body.idempotencyKey;
    if (idempotencyKey && inst.idempotencyKey === idempotencyKey) {
      const out = inst.toJSON();
      return res.status(200).json({ success: true, ...out, data: out });
    }

    if (inst.status === "paid") {
      return res.status(409).json({ success: false, message: "القسط مدفوع بالفعل" });
    }

    const remaining = round4(parseFloat(inst.amount) - parseFloat(inst.paidAmount || 0));

    // Phase 10P: strict amount validation BEFORE any update/create/posting. The
    // old `Number(req.body.amount) || due` shortcut treated 0 / NaN / missing as
    // a full payment, which (now that a Payment row is created) could record a
    // Payment of the wrong value. amount must be an explicit finite number > 0,
    // and a full payment must send amount = remaining explicitly (no shortcut).
    const amount = Number(req.body.amount);
    if (
      req.body.amount === undefined ||
      req.body.amount === null ||
      req.body.amount === "" ||
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      return res.status(422).json({ success: false, message: "Payment amount must be greater than zero" });
    }
    if (amount > remaining + 0.01) {
      return res.status(422).json({
        success: false,
        message: `Overpayment rejected: amount ${amount} exceeds remaining ${remaining}`,
      });
    }
    const method = req.body.paymentMethod || "Cash";
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";

    const newPaid = parseFloat(inst.paidAmount || 0) + amount;
    const status = newPaid >= parseFloat(inst.amount) - 0.01 ? "paid" : "partial";
    const payDate = new Date().toISOString().slice(0, 10);

    // Treasury account mirrors the GL cash account chosen by
    // postInstallmentPayment (cashCode 1120/bank vs 1110/cash) so the treasury
    // log row lands on the same account the journal debits.
    const m = String(method).toLowerCase();
    const treasuryAccount =
      m.includes("card") || m.includes("bank") || m.includes("شبك") || m.includes("تحويل") ? "bank" : "cash";
    const branchId =
      req.branchId && String(req.branchId).startsWith("BR-") ? req.branchId : null;

    // Phase 10O + 11D: record the installment collection ATOMICALLY — the
    // installment update, the Payment row (so Customer Statement V2 picks it up
    // as a credit), the GL journal, and a treasury CashTransaction all commit
    // together. The journal posting is moved INSIDE the transaction (it used to
    // be best-effort after commit): a posting failure now rolls back the whole
    // collection, so we never leave a paid installment / Payment without a GL
    // entry, nor a CashTransaction without its journalEntryId. The idempotency
    // early-return above guarantees a replay never reaches this block, so
    // nothing is duplicated. No Customer.balance writer is added. The
    // CashTransaction is an operational treasury LOG only — it is linked to the
    // EXISTING installment journal and NO postCashEntry is called, so there is
    // no second journal and no double-posting (mirrors the POS/invoice-post
    // pattern, not the supplier-payment pattern that is itself the journal).
    let installmentPayment = null;
    let journalEntry = null;
    await models.sequelize.transaction(async (t) => {
      await inst.update({
        paidAmount: newPaid,
        status,
        paidDate: payDate,
        idempotencyKey: idempotencyKey || inst.idempotencyKey
      }, { transaction: t });

      installmentPayment = await models.Payment.create({
        id: `PAY-INST-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        companyId: inst.companyId,
        branchId,
        invoiceId: inst.invoiceId,
        paymentMethod: method,
        amount,
        reference: req.body.reference || `Installment #${inst.sequence}`,
        date: payDate,
        notes: req.body.notes || `تحصيل قسط ${inst.id}`
      }, { transaction: t });

      journalEntry = await postingService.postInstallmentPayment(
        inst.toJSON(), amount, method, actor, { transaction: t }
      );

      await models.CashTransaction.create({
        id: `TX-INST-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        companyId: inst.companyId,
        type: "cash_in",
        account: treasuryAccount,
        amount,
        category: "تحصيل قسط",
        description: `تحصيل قسط ${inst.id} — فاتورة ${inst.invoiceId}`,
        reference: inst.invoiceId,
        branch: inst.branch || "Main Branch",
        branchId,
        date: payDate,
        createdBy: req.user ? req.user.id : "System",
        status: "posted",
        journalEntryId: journalEntry ? journalEntry.id : null
      }, { transaction: t });
    });

    if (inst.customerId) {
      const { recalculateCustomerNetPurchases } = require("../services/customer-purchases.service");
      await recalculateCustomerNetPurchases(models, req.companyId, inst.customerId);
    }

    const out = inst.toJSON();
    out.journalEntry = journalEntry;
    out.payment = installmentPayment;
    return res.status(200).json({ success: true, ...out, data: out });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GIFT VOUCHERS (قسائم الهدايا) — issue, lookup & redeem
// ─────────────────────────────────────────────────────────────────────────────

router.get("/gift-vouchers", authMiddleware, async (req, res, next) => {
  try {
    const where = { companyId: req.companyId };
    if (req.query.status) where.status = req.query.status;
    const rows = await models.GiftVoucher.findAll({
      where,
      order: [["created_at", "DESC"]],
      limit: parseInt(req.query.pageSize) || 200
    });
    return res.status(200).json({ success: true, items: rows, data: { items: rows } });
  } catch (error) {
    next(error);
  }
});

router.get("/gift-vouchers/:code", authMiddleware, async (req, res, next) => {
  try {
    const v = await models.GiftVoucher.findOne({
      where: { code: req.params.code, companyId: req.companyId }
    });
    if (!v) return res.status(404).json({ success: false, message: "القسيمة غير موجودة" });
    return res.status(200).json({ success: true, ...v.toJSON(), data: v.toJSON() });
  } catch (error) {
    next(error);
  }
});

// Issue a new gift voucher + auto-post (deferred-revenue liability).
router.post("/gift-vouchers/issue", authMiddleware, async (req, res, next) => {
  try {
    const b = req.body || {};
    const value = Number(b.value);
    if (!value || value <= 0) {
      return res.status(422).json({ success: false, message: "قيمة القسيمة يجب أن تكون أكبر من صفر" });
    }
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    const code = b.code || `GV-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    const voucher = await models.GiftVoucher.create({
      id: `GVID-${Date.now()}`,
      companyId: req.companyId,
      code,
      value,
      balance: value,
      customerId: b.customerId || null,
      customerName: b.customerName || null,
      status: "active",
      issueDate: new Date().toISOString().slice(0, 10),
      expiryDate: b.expiryDate || null,
      paymentMethod: b.paymentMethod || "Cash",
      branch: b.branch || req.branchId || "Main Branch"
    });

    let journalEntry = null;
    try {
      journalEntry = await postingService.postVoucherIssueEntry(voucher.toJSON(), actor);
    } catch (postErr) {
      logger.error(`[GiftVoucher] Failed to post issue ${voucher.id}: ${postErr.message}`);
    }

    const out = voucher.toJSON();
    out.journalEntry = journalEntry;
    return res.status(201).json({ success: true, ...out, data: out });
  } catch (error) {
    next(error);
  }
});

// Redeem (spend) part or all of a voucher's balance + auto-post.
router.post("/gift-vouchers/redeem", authMiddleware, async (req, res, next) => {
  try {
    const b = req.body || {};
    const voucher = await models.GiftVoucher.findOne({
      where: { code: b.code, companyId: req.companyId }
    });
    if (!voucher) return res.status(404).json({ success: false, message: "القسيمة غير موجودة" });
    if (voucher.status !== "active") {
      return res.status(409).json({ success: false, message: "القسيمة غير صالحة للاستخدام" });
    }

    const balance = parseFloat(voucher.balance);
    const amount = Math.min(Number(b.amount) || balance, balance);
    if (amount <= 0) {
      return res.status(422).json({ success: false, message: "لا يوجد رصيد متاح في القسيمة" });
    }
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";

    const newBalance = Math.round((balance - amount) * 100) / 100;
    await voucher.update({
      balance: newBalance,
      status: newBalance <= 0.01 ? "redeemed" : "active"
    });

    let journalEntry = null;
    try {
      journalEntry = await postingService.postVoucherRedeemEntry(voucher.toJSON(), amount, actor);
    } catch (postErr) {
      logger.error(`[GiftVoucher] Failed to post redeem ${voucher.id}: ${postErr.message}`);
    }

    const out = voucher.toJSON();
    out.redeemedAmount = amount;
    out.journalEntry = journalEntry;
    return res.status(200).json({ success: true, ...out, data: out });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// TREASURY (الخزنة) — cash movements, balances & closing reconciliation
// ─────────────────────────────────────────────────────────────────────────────

const TREASURY_GL = { cash: "1110", bank: "1120" };

// List treasury transactions (newest first), optional type/branch/account filters.
router.get("/treasury/transactions", authMiddleware, requirePermission("treasury.view"), async (req, res, next) => {
  try {
    const where = { companyId: req.companyId };
    if (req.query.type) where.type = req.query.type;
    if (req.query.account) where.account = req.query.account;
    if (req.query.branch) where.branch = req.query.branch;

    // Phase 6B: real server-side pagination (offset + total). page/pageSize are
    // optional and clamped; pageSize defaults to 20 and is capped at 100 (the
    // previous limit-only default), so callers that pass neither still get the
    // newest rows and the {items}/{data.items} shape stays backward compatible.
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 20));
    const offset = (page - 1) * pageSize;

    const { count, rows } = await models.CashTransaction.findAndCountAll({
      where,
      order: [["created_at", "DESC"]],
      limit: pageSize,
      offset,
    });
    const total = count;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const payload = { items: rows, page, pageSize, total, totalPages };
    return res.status(200).json({ success: true, ...payload, data: payload });
  } catch (error) {
    next(error);
  }
});

// Current treasury balances + today's movement totals.
router.get("/treasury/summary", authMiddleware, requirePermission("treasury.view"), async (req, res, next) => {
  try {
    const accounts = await models.Account.findAll({
      where: { companyId: req.companyId, code: ["1110", "1120"] }
    });
    const balOf = (code) => {
      const a = accounts.find((x) => x.code === code);
      return a ? parseFloat(a.balance || 0) : 0;
    };
    const cash = balOf("1110");
    const bank = balOf("1120");

    const today = new Date().toISOString().slice(0, 10);
    const todays = await models.CashTransaction.findAll({
      where: { companyId: req.companyId, date: today }
    });
    const sum = (type) =>
      todays.filter((t) => t.type === type).reduce((s, t) => s + parseFloat(t.amount || 0), 0);

    return res.status(200).json({
      success: true,
      data: {
        cash,
        bank,
        total: cash + bank,
        todayIn: sum("cash_in"),
        todayOut: sum("cash_out"),
        todayTransfers: sum("transfer")
      }
    });
  } catch (error) {
    next(error);
  }
});

// Create a treasury transaction (cash_in / cash_out / transfer) + auto-post journal.
// Phase 11B: gated by treasury.update and made ATOMIC — the CashTransaction, its
// GL posting (postCashEntry), the journalEntryId back-link, and the audit row are
// created in ONE DB transaction. If posting fails, everything rolls back so no
// orphan CashTransaction (without a journal) is ever left behind.
router.post("/treasury/transactions", authMiddleware, requirePermission("treasury.update"), async (req, res, next) => {
  try {
    const b = req.body || {};
    const amount = Number(b.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(422).json({ success: false, message: "المبلغ يجب أن يكون أكبر من صفر" });
    }
    const type = ["cash_in", "cash_out", "transfer"].includes(b.type) ? b.type : "cash_in";
    const id = `CT-${Date.now()}`;
    const now = new Date().toISOString().slice(0, 16).replace("T", " ");
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    const idempotencyKey = req.headers["idempotency-key"] || b.idempotencyKey;

    // Idempotency: a retried/double-clicked entry returns the original transaction
    // instead of recording the cash movement twice. (No unique index yet, so a
    // narrow race window remains between concurrent same-key requests.)
    if (idempotencyKey) {
      const existing = await models.CashTransaction.findOne({
        where: { idempotencyKey, companyId: req.companyId }
      });
      if (existing) {
        const out = existing.toJSON();
        return res.status(200).json({ success: true, ...out, data: out, meta: { idempotentReplay: true } });
      }
    }

    const result = await models.sequelize.transaction(async (t) => {
      const tx = await models.CashTransaction.create({
        id,
        companyId: req.companyId,
        type,
        account: b.account || "cash",
        toAccount: b.toAccount || null,
        amount,
        category: b.category || null,
        counterAccountCode: b.counterAccountCode || null,
        description: b.description || null,
        reference: b.reference || null,
        branch: b.branch || req.branchId || "Main Branch",
        date: b.date || now.slice(0, 10),
        createdBy: actor,
        status: "posted",
        idempotencyKey: idempotencyKey || null
      }, { transaction: t });

      // Post the GL entry inside the SAME transaction; any failure rolls back the
      // CashTransaction too (no orphan cash movement without a journal).
      const journalEntry = await postingService.postCashEntry(tx.toJSON(), actor, { transaction: t });
      await tx.update({ journalEntryId: journalEntry.id }, { transaction: t });

      await auditService.record(req.companyId, {
        action: "treasury_transaction_created",
        description: `Treasury ${type} ${amount} (${b.account || "cash"})${b.category ? " — " + b.category : ""}`,
        user: actor,
        userId: req.user ? req.user.id : null,
        place: tx.branch,
        branch: tx.branch,
        sourceDocument: tx.id,
        severity: "info",
        after: JSON.stringify({
          id: tx.id, type, account: tx.account, toAccount: tx.toAccount, amount,
          category: tx.category, reference: tx.reference, journalEntryId: journalEntry.id,
        }),
      }, { transaction: t });

      const out = tx.toJSON();
      out.journalEntry = journalEntry;
      return out;
    });

    return res.status(201).json({ success: true, ...result, data: result });
  } catch (error) {
    next(error);
  }
});

// Treasury closing — reconcile expected vs actual and record variance.
router.post("/treasury/closing", authMiddleware, requirePermission("treasury.update"), async (req, res, next) => {
  try {
    const b = req.body || {};

    // Phase 11F: strict account validation — only the two treasury accounts are
    // valid. An unknown account must NOT fall back to cash (1110) silently.
    const account = b.account;
    if (account !== "cash" && account !== "bank") {
      return res.status(422).json({ success: false, message: "Account must be 'cash' or 'bank'" });
    }
    const glCode = TREASURY_GL[account];

    // Idempotency: a retried/double-clicked closing returns the original closing
    // record instead of recording a second one. Checked BEFORE the duplicate
    // guard so a genuine replay (same key) returns 200, never 409.
    const idempotencyKey = req.headers["idempotency-key"] || b.idempotencyKey;
    if (idempotencyKey) {
      const existing = await models.CashTransaction.findOne({
        where: { idempotencyKey, companyId: req.companyId, type: "closing" }
      });
      if (existing) {
        const out = existing.toJSON();
        return res.status(200).json({ success: true, ...out, data: out });
      }
    }

    // Phase 11F: strict actualBalance validation. The old `Number(x) || 0`
    // turned a missing/blank/non-numeric value into 0 silently, recording a
    // bogus variance (= -expected) and poisoning the next closing's opening.
    // 0 is allowed ONLY when sent explicitly as a valid number.
    if (b.actualBalance === undefined || b.actualBalance === null || b.actualBalance === "") {
      return res.status(422).json({ success: false, message: "Actual balance must be a valid non-negative number" });
    }
    const actual = Number(b.actualBalance);
    if (!Number.isFinite(actual) || actual < 0) {
      return res.status(422).json({ success: false, message: "Actual balance must be a valid non-negative number" });
    }

    const now = new Date().toISOString().slice(0, 16).replace("T", " ");
    const closingDate = b.date || now.slice(0, 10);
    const closingDay = String(closingDate).slice(0, 10);

    // Phase 11F: prevent a second closing for the same account on the same day
    // within the company (a genuine idempotent replay already returned above).
    // Scoped by the stored `date` day — not createdAt.
    const dupe = await models.CashTransaction.findOne({
      where: {
        companyId: req.companyId,
        type: "closing",
        account,
        date: { [Op.like]: `${closingDay}%` }
      }
    });
    if (dupe) {
      return res.status(409).json({ success: false, message: "Treasury closing already exists for this account and date" });
    }

    // Expected = current GL balance of the treasury account.
    const acc = await models.Account.findOne({ where: { companyId: req.companyId, code: glCode } });
    const expected = acc ? parseFloat(acc.balance || 0) : 0;

    // Opening = previous closing's actual balance for the same account (else 0).
    // Scoped by account ONLY (not day) so cross-day chaining is preserved.
    const prev = await models.CashTransaction.findOne({
      where: { companyId: req.companyId, type: "closing", account },
      order: [["created_at", "DESC"]]
    });
    const opening = prev ? parseFloat(prev.actualBalance || 0) : 0;

    const variance = Math.round((actual - expected) * 100) / 100;
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";

    const closingId = `CLS-${Date.now()}`;
    const closing = await models.sequelize.transaction(async (t) => {
      const row = await models.CashTransaction.create({
        id: closingId,
        companyId: req.companyId,
        type: "closing",
        account,
        amount: actual,
        description: b.description || `إغلاق خزينة ${account === "bank" ? "البنك" : "النقدية"}`,
        branch: b.branch || req.branchId || "Main Branch",
        date: closingDate,
        createdBy: actor,
        status: "approved",
        openingBalance: opening,
        expectedBalance: expected,
        actualBalance: actual,
        variance,
        idempotencyKey: idempotencyKey || null
      }, { transaction: t });

      // Phase 11B: audit the closing (no GL variance posting — recorded only).
      await auditService.record(req.companyId, {
        action: "treasury_closing_created",
        description: `Treasury closing ${account} — actual ${actual}, expected ${expected}, variance ${variance}`,
        user: actor,
        userId: req.user ? req.user.id : null,
        place: row.branch,
        branch: row.branch,
        sourceDocument: row.id,
        severity: variance === 0 ? "info" : "warning",
        after: JSON.stringify({ id: row.id, account, openingBalance: opening, expectedBalance: expected, actualBalance: actual, variance }),
      }, { transaction: t });

      return row;
    });

    return res.status(201).json({
      success: true,
      ...closing.toJSON(),
      data: { ...closing.toJSON(), opening, expected, actual, variance }
    });
  } catch (error) {
    next(error);
  }
});

// List closing records.
router.get("/treasury/closings", authMiddleware, requirePermission("treasury.view"), async (req, res, next) => {
  try {
    const rows = await models.CashTransaction.findAll({
      where: { companyId: req.companyId, type: "closing" },
      order: [["created_at", "DESC"]],
      limit: 50
    });
    return res.status(200).json({ success: true, items: rows, data: { items: rows } });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
