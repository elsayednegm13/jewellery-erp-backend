const express = require("express");
const bcrypt = require("bcryptjs");
const { Op } = require("sequelize");
const { authMiddleware, requirePermission, requireAnyPermission } = require("../middleware/auth.middleware");
const ErpController = require("../controllers/erp.controller");
const models = require("../models");
const postingService = require("../services/posting.service");
const goldService = require("../services/gold.service");
const settingsService = require("../services/settings.service");
const salesService = require("../services/sales.service");
const auditService = require("../services/audit.service");
const { emitEntityChanged } = require("../services/realtime-helper.service");
const notificationService = require("../services/notification.service");
const logger = require("../utils/logger");
const { ValidationError, NotFoundError } = require("../utils/errors");
const uploadMiddleware = require("../middleware/upload.middleware");
const { moveUploadedFileSafe } = require("../utils/file-move");

const router = express.Router();
const allowAuthenticated = (req, res, next) => next();

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

    // 8. Generate safe sequence invoice ID
    const prefix = settings.invoicePrefix || "INV-2026";
    const lastInvoice = await models.Invoice.findOne({
      where: { companyId: req.companyId, id: { [Op.like]: `${prefix}-%` } },
      order: [["createdAt", "DESC"]],
      lock: true,
      transaction: t
    });
    let nextNumber = 1;
    if (lastInvoice) {
      const parts = lastInvoice.id.split("-");
      const lastNum = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastNum)) nextNumber = lastNum + 1;
    }
    const invoiceId = `${prefix}-${String(nextNumber).padStart(6, "0")}`;

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
      where: { relatedInvoiceId: originalInvoice.id, type: "return", companyId: req.companyId },
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
      ["invoices", () => models.Invoice.count({ where: { customerId: customer.id, companyId: req.companyId }, transaction: t })],
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
      ["invoices", () => models.Invoice.count({ where: { branchId: branch.id, companyId: req.companyId }, transaction: t })],
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
setupCrud("invoices", models.Invoice, ["customerName", "status", "paymentMethod"]);
setupCrud("reservations", models.Reservation, ["customerName", "assetName", "status"]);
setupCrud("approval-requests", models.ApprovalRequest, ["description", "status", "requestedBy"]);
setupCrud("journal-entries", models.JournalEntry, ["description", "status"]);
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

    const total = Math.round(normalizedItems.reduce((sum, item) => sum + item.totalCost, 0) * 100) / 100;
    const totalWeight = Math.round(normalizedItems.reduce((sum, item) => sum + item.totalWeight, 0) * 10000) / 10000;
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
      branch: branch.name,
      notes: [body.notes, drcNote, `Payment: ${paymentStatus}`, `Total weight: ${totalWeight}g`].filter(Boolean).join(" | "),
      isConsignment: Boolean(body.isConsignment ?? supplier.isConsignment),
      idempotencyKey: idempotencyKey || null
    }, { transaction: t });

    const createdAssets = [];
    const createdItems = [];
    let hasProducts = false;

    for (let itemIndex = 0; itemIndex < normalizedItems.length; itemIndex++) {
      const item = normalizedItems[itemIndex];
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
        const newAvgCost = newQty > 0 ? ((currentAvgCost * currentQty) + (item.unitCost * item.quantity)) / newQty : item.unitCost;
        const totalWeight = product ? Number(product.totalWeight) : 0;
        const newWeight = totalWeight + item.totalWeight;

        if (product) {
          await product.update({
            quantityOnHand: Number(product.quantityOnHand) + item.quantity,
            quantityAvailable: Number(product.quantityAvailable) + item.quantity,
            totalWeight: newWeight,
            averageCost: newAvgCost,
            averageUnitWeight: newQty > 0 ? (newWeight / newQty) : item.weightPerUnit,
            unitCost: item.unitCost,
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
            unitCost: item.unitCost,
            averageCost: item.unitCost,
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
          unitCost: item.unitCost,
          totalCost: item.totalCost,
          referenceType: "PurchaseOrder",
          referenceId: purchaseOrderId,
          supplierId,
          branchId: branch.id,
          createdBy: actor
        }, { transaction: t });

        // Create PurchaseOrderItem
        const poItem = await models.PurchaseOrderItem.create({
          id: `POI-${Date.now()}-${itemIndex + 1}-1`,
          purchaseOrderId,
          assetId: product.id, // Store product.id in assetId column!
          description: item.name,
          quantity: item.quantity,
          unit: item.unit || "قطعة",
          unitPrice: item.unitCost,
          total: item.totalCost,
          receivedQuantity: item.quantity
        }, { transaction: t });

        createdAssets.push(product.toJSON());
        createdItems.push(poItem.toJSON());
      } else {
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
            cost: item.cost,
            branch: branch.name,
            branchId: branch.id,
            location: item.location,
            status: "available",
            barcode,
            source: "supplier_purchase",
            notes: [item.notes, body.notes, `Supplier: ${supplier.name}`, `Purchase: ${purchaseOrderId}`, drcNote].filter(Boolean).join(" | ")
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
            assetId,
            description: item.name,
            quantity: 1,
            unit: item.unit || "قطعة",
            unitPrice: item.unitCost,
            total: item.unitCost,
            receivedQuantity: 1
          }, { transaction: t });
          createdItems.push(poItem.toJSON());
        }
      }
    }

    if (remainingAmount > 0) {
      await supplier.increment("due", { by: remainingAmount, transaction: t });
    }
    await supplier.update({ lastOrder: dateStr }, { transaction: t });

    const journalEntry = await postingService.postPurchaseEntry(
      purchaseOrder.toJSON(),
      paidAmount,
      paymentMethod,
      actor,
      { transaction: t, branchId: branch.id }
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
        isDRC: Boolean(body.isDRC || body.reverseVat || body.useReverseCharge)
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

    const settingKeys = ["language", "theme", "vatRate", "goldKaratDefaults", "goldPricingMode", "invoicePrefix", "invoiceNumbering", "dateFormat", "decimalPrecision", "print", "notifications", "lowStockThreshold", "receipt", "allowZeroDownPayment", "paymentMethods", "installmentEnabled", "installmentDefaultFrequency", "installmentMaxCount", "installmentMinDownPaymentPercent", "barcode"];
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
      where: { customerId, companyId: req.companyId },
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
      where: { customerId, companyId: req.companyId },
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
      postedAt: now
    });

    // Persist line items and mark the sold assets.
    for (const item of items) {
      await models.InvoiceItem.create({
        invoiceId: id,
        assetId: item.assetId || item.id,
        name: item.name || "",
        quantity: item.quantity || 1,
        price: item.price || 0,
        cost: item.cost || 0,
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
        journalEntry = await postingService.postInvoiceEntry(inv, items, actor);
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

// Effective per-gram rate for a karat: a manual daily fixing wins over the
// live-derived rate, so quotes and fixings honour the rate the shop set.
async function effectiveKaratPrice(currency, karat) {
  const override = await models.GoldPrice.findOne({
    where: { currency, karat: parseInt(karat) },
    order: [["updated_at", "DESC"]]
  });
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
    const overrides = await models.GoldPrice.findAll({
      where: { currency },
      order: [["updated_at", "DESC"]]
    });
    // Keep the latest manual price per karat.
    const byKarat = {};
    overrides.forEach((o) => {
      if (!byKarat[o.karat]) byKarat[o.karat] = o;
    });
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
      // Previous effective price for this karat (latest row), for the audit "before".
      const prev = await models.GoldPrice.findOne({
        where: { currency, karat },
        order: [["updated_at", "DESC"]]
      });
      const row = await models.GoldPrice.create({
        karat,
        pricePerGram: newPrice,
        currency,
        updatedBy: actor
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
    const perGram = await effectiveKaratPrice(currency, karat);
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
      ratePerGram = await effectiveKaratPrice(currency, karat);
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

    const due = parseFloat(inst.amount) - parseFloat(inst.paidAmount || 0);
    const amount = Number(req.body.amount) || due;
    const method = req.body.paymentMethod || "Cash";
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";

    const newPaid = parseFloat(inst.paidAmount || 0) + amount;
    const status = newPaid >= parseFloat(inst.amount) - 0.01 ? "paid" : "partial";
    await inst.update({
      paidAmount: newPaid,
      status,
      paidDate: new Date().toISOString().slice(0, 10),
      idempotencyKey: idempotencyKey || inst.idempotencyKey
    });

    if (inst.customerId) {
      const { recalculateCustomerNetPurchases } = require("../services/customer-purchases.service");
      await recalculateCustomerNetPurchases(models, req.companyId, inst.customerId);
    }

    let journalEntry = null;
    try {
      journalEntry = await postingService.postInstallmentPayment(inst.toJSON(), amount, method, actor);
    } catch (postErr) {
      logger.error(`[Installment] Failed to post payment ${inst.id}: ${postErr.message}`);
    }

    const out = inst.toJSON();
    out.journalEntry = journalEntry;
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
router.get("/treasury/transactions", authMiddleware, async (req, res, next) => {
  try {
    const where = { companyId: req.companyId };
    if (req.query.type) where.type = req.query.type;
    if (req.query.account) where.account = req.query.account;
    if (req.query.branch) where.branch = req.query.branch;

    const rows = await models.CashTransaction.findAll({
      where,
      order: [["created_at", "DESC"]],
      limit: parseInt(req.query.pageSize) || 100
    });
    return res.status(200).json({ success: true, items: rows, data: { items: rows } });
  } catch (error) {
    next(error);
  }
});

// Current treasury balances + today's movement totals.
router.get("/treasury/summary", authMiddleware, async (req, res, next) => {
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
router.post("/treasury/transactions", authMiddleware, async (req, res, next) => {
  try {
    const b = req.body || {};
    const amount = Number(b.amount);
    if (!amount || amount <= 0) {
      return res.status(422).json({ success: false, message: "المبلغ يجب أن يكون أكبر من صفر" });
    }
    const type = ["cash_in", "cash_out", "transfer"].includes(b.type) ? b.type : "cash_in";
    const id = `CT-${Date.now()}`;
    const now = new Date().toISOString().slice(0, 16).replace("T", " ");
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";

    // Idempotency: a retried/double-clicked treasury entry returns the
    // original transaction instead of recording the cash movement twice.
    const idempotencyKey = req.headers["idempotency-key"] || b.idempotencyKey;
    if (idempotencyKey) {
      const existing = await models.CashTransaction.findOne({
        where: { idempotencyKey, companyId: req.companyId }
      });
      if (existing) {
        const out = existing.toJSON();
        return res.status(200).json({ success: true, ...out, data: out });
      }
    }

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
    });

    let journalEntry = null;
    try {
      journalEntry = await postingService.postCashEntry(tx.toJSON(), actor);
      await tx.update({ journalEntryId: journalEntry.id });
    } catch (postErr) {
      logger.error(`[Treasury] Failed to post journal for ${id}: ${postErr.message}`);
    }

    const out = tx.toJSON();
    out.journalEntry = journalEntry;
    return res.status(201).json({ success: true, ...out, data: out });
  } catch (error) {
    next(error);
  }
});

// Treasury closing — reconcile expected vs actual and record variance.
router.post("/treasury/closing", authMiddleware, async (req, res, next) => {
  try {
    const b = req.body || {};
    const account = b.account || "cash";
    const glCode = TREASURY_GL[account] || "1110";

    // Idempotency: a retried/double-clicked closing returns the original
    // closing record instead of recording a second closing.
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

    // Expected = current GL balance of the treasury account.
    const acc = await models.Account.findOne({ where: { companyId: req.companyId, code: glCode } });
    const expected = acc ? parseFloat(acc.balance || 0) : 0;

    // Opening = previous closing's actual balance for the same account (else 0).
    const prev = await models.CashTransaction.findOne({
      where: { companyId: req.companyId, type: "closing", account },
      order: [["created_at", "DESC"]]
    });
    const opening = prev ? parseFloat(prev.actualBalance || 0) : 0;

    const actual = Number(b.actualBalance) || 0;
    const variance = Math.round((actual - expected) * 100) / 100;
    const now = new Date().toISOString().slice(0, 16).replace("T", " ");
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";

    const closing = await models.CashTransaction.create({
      id: `CLS-${Date.now()}`,
      companyId: req.companyId,
      type: "closing",
      account,
      amount: actual,
      description: b.description || `إغلاق خزينة ${account === "bank" ? "البنك" : "النقدية"}`,
      branch: b.branch || req.branchId || "Main Branch",
      date: b.date || now.slice(0, 10),
      createdBy: actor,
      status: "approved",
      openingBalance: opening,
      expectedBalance: expected,
      actualBalance: actual,
      variance,
      idempotencyKey: idempotencyKey || null
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
router.get("/treasury/closings", authMiddleware, async (req, res, next) => {
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
