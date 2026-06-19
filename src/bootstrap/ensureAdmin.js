const bcrypt = require("bcryptjs");
const { Op } = require("sequelize");
const { User, Company } = require("../models");
const logger = require("../utils/logger");
const { ensureRolesForCompany, assignUserRole } = require("./accessControl");

/**
 * Ensures default branches exist for a company.
 */
async function ensureDefaultBranches(companyId) {
  try {
    const { Branch, Setting } = require("../models");
    const initialized = await Setting.findOne({ where: { companyId, key: "branchesInitialized" } });
    if (initialized?.value === true || initialized?.value === "true") {
      logger.info(`[Bootstrap] Branch defaults already initialized for company ${companyId}; skipping default branch seed.`);
      return;
    }

    const now = new Date();
    const defaultBranches = [
      {
        id: "BR-DXB",
        companyId,
        name: "فرع دبي مول",
        code: "DXB-MALL",
        type: "store",
        address: "Dubai Mall",
        phone: "+97140000000",
        isActive: true,
        createdAt: now,
        updatedAt: now
      },
      {
        id: "BR-AUH",
        companyId,
        name: "فرع أبوظبي",
        code: "AUH-GALLERY",
        type: "store",
        address: "Abu Dhabi",
        phone: "+97120000000",
        isActive: true,
        createdAt: now,
        updatedAt: now
      },
      {
        id: "BR-SHJ",
        companyId,
        name: "فرع الشارقة",
        code: "SHJ-MALL",
        type: "store",
        address: "Sharjah",
        phone: "+97160000000",
        isActive: true,
        createdAt: now,
        updatedAt: now
      },
      {
        id: "BR-WH",
        companyId,
        name: "المستودع الرئيسي",
        code: "MAIN-WH",
        type: "warehouse",
        address: "Warehouse District",
        phone: "+97149999999",
        isActive: true,
        createdAt: now,
        updatedAt: now
      },
      {
        id: "BR-FAC",
        companyId,
        name: "المصنع",
        code: "GOLD-FACTORY",
        type: "factory",
        address: "Industrial Area",
        phone: "+97148888888",
        isActive: true,
        createdAt: now,
        updatedAt: now
      }
    ];

    const existingBranches = await Branch.findAll({
      where: { id: defaultBranches.map(b => b.id) },
      attributes: ["id"]
    });
    const existingBranchIds = new Set(existingBranches.map(b => b.id));
    const missingBranches = defaultBranches.filter(b => !existingBranchIds.has(b.id));

    if (missingBranches.length > 0) {
      await Branch.bulkCreate(missingBranches);
      logger.info(`[Bootstrap] Created missing default branches: ${missingBranches.map(b => b.id).join(", ")}`);
    }

    if (existingBranchIds.size > 0) {
      logger.info(`[Bootstrap] Default branches already present: ${Array.from(existingBranchIds).join(", ")}`);
    }

    await Setting.findOrCreate({
      where: { companyId, key: "branchesInitialized" },
      defaults: { companyId, key: "branchesInitialized", value: true }
    });
  } catch (err) {
    logger.error(`[Bootstrap] Failed to ensure default branches: ${err.message}`);
  }
}

/**
 * Ensures a primary admin account exists on first run.
 *
 * - If any admin/owner user already exists, does nothing (no duplicates).
 * - Otherwise creates one from ADMIN_* env vars, attaching it to the first
 *   company (creating a default company if none exists).
 * - In production with no admin AND no ADMIN_* env, logs a clear error and
 *   skips (so an existing deployment is never left without a way in, but a
 *   misconfigured fresh deploy is loudly flagged).
 */
async function ensureAdmin() {
  const models = require("../models");
  try {
    logger.info("[Bootstrap] Initializing database tables for products and movements...");
    await models.Product.sync();
    await models.StockMovement.sync();

    const productCount = await models.Product.count();
    if (productCount === 0) {
      logger.info("[Bootstrap] Migrating existing assets to products...");
      const assets = await models.Asset.findAll({ paranoid: false });
      
      const groups = {};
      for (const asset of assets) {
        const name = asset.name || "Default Product";
        const karat = asset.karat || 21;
        const type = asset.type || "gold-piece";
        const branchId = asset.branchId || "BR-DXB";
        const branchName = asset.branch || "فرع دبي مول";
        const price = Number(asset.price) || 0;
        const cost = Number(asset.cost) || 0;
        
        // Clean trailing numbers like "لولو 100" to "لولو" so they group correctly
        const cleanedName = name.replace(/\s+\d+$/, "").trim();
        
        const key = `${cleanedName}|${karat}|${type}|${branchId}|${price}`;
        if (!groups[key]) {
          groups[key] = {
            assets: [],
            name: cleanedName,
            karat,
            type,
            branchId,
            branchName,
            price,
            cost,
          };
        }
        groups[key].assets.push(asset);
      }
      
      let index = 1;
      for (const key of Object.keys(groups)) {
        const group = groups[key];
        
        // Clean Arabic/English names for slug-like product codes
        let baseCode = String(group.name).trim().replace(/\s+/g, "-").toUpperCase();
        baseCode = baseCode.replace(/[^\w\u0621-\u064A\u0620-\u064A-]/g, "");
        if (!baseCode) baseCode = "PRD";
        const productCode = `${baseCode}-${group.karat}K-${index++}`;
        const productId = `PRD-ID-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`;
        
        const availableAssets = group.assets.filter(a => a.status === 'available');
        const soldAssets = group.assets.filter(a => a.status === 'sold');
        const reservedAssets = group.assets.filter(a => a.status === 'reserved');
        
        const qtyAvailable = availableAssets.length;
        const qtySold = soldAssets.length;
        const qtyReserved = reservedAssets.length;
        const qtyOnHand = qtyAvailable + qtyReserved;
        
        const totalWeight = group.assets.reduce((sum, a) => sum + (Number(a.grossWeight) || 0), 0);
        const averageUnitWeight = group.assets.length > 0 ? (totalWeight / group.assets.length) : 0;
        
        const product = await models.Product.create({
          id: productId,
          companyId: group.assets[0].companyId || "CMP-DEMO",
          productCode,
          productName: group.name,
          description: `Migrated from assets group ${key}`,
          karat: group.karat,
          stockType: group.type,
          branchId: group.branchId,
          branchName: group.branchName,
          quantityOnHand: qtyOnHand,
          quantityAvailable: qtyAvailable,
          quantitySold: qtySold,
          quantityReserved: qtyReserved,
          totalWeight,
          averageUnitWeight,
          unitCost: group.cost,
          averageCost: group.cost,
          salePrice: group.price,
          isActive: true
        });
        
        // Link old assets to product
        for (const asset of group.assets) {
          await asset.update({ parentAssetId: productId });
        }
        
        // Create initial stock movement
        await models.StockMovement.create({
          id: `SM-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`,
          companyId: product.companyId,
          productId: product.id,
          productCode: product.productCode,
          type: "opening_balance",
          quantityIn: qtyOnHand + qtySold,
          quantityOut: qtySold,
          weightIn: totalWeight,
          weightOut: soldAssets.reduce((sum, a) => sum + (Number(a.grossWeight) || 0), 0),
          unitCost: product.unitCost,
          totalCost: product.unitCost * (qtyOnHand + qtySold),
          referenceType: "AssetMigration",
          referenceId: "MIGRATION",
          branchId: product.branchId,
          createdBy: "System"
        });
      }
      logger.info(`[Bootstrap] Successfully migrated ${Object.keys(groups).length} asset groups to products.`);
    }
  } catch (syncErr) {
    logger.error(`[Bootstrap] Syncing product tables or migrating assets failed: ${syncErr.message}`);
  }

  const isProd = process.env.NODE_ENV === "production";

  const existingAdmin = await User.findOne({ where: { role: { [Op.in]: ["admin", "owner"] } } });
  if (existingAdmin) {
    await ensureRolesForCompany(existingAdmin.companyId);
    await assignUserRole(existingAdmin.id, existingAdmin.companyId, existingAdmin.role || "admin");
    await ensureDefaultBranches(existingAdmin.companyId);
    logger.info(`[Bootstrap] Admin already present (${existingAdmin.email}). Skipping admin creation.`);
    return;
  }

  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const firstName = process.env.ADMIN_FIRST_NAME || "System";
  const lastName = process.env.ADMIN_LAST_NAME || "Admin";
  const phone = process.env.ADMIN_PHONE || null;

  if (!email || !password) {
    const msg =
      "[Bootstrap] No admin user exists and ADMIN_EMAIL / ADMIN_PASSWORD are not set. " +
      "Set them (see backend/.env.example) to create the primary admin.";
    if (isProd) {
      logger.error(`${msg} Refusing to auto-create a default admin in production.`);
      throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD are required for first production startup.");
    } else {
      logger.warn(`${msg} You can also run \`npm run db:seed\` for demo data.`);
    }
    return;
  }

  if (isProd && password.length < 8) {
    logger.error("[Bootstrap] ADMIN_PASSWORD is too weak for production (min 8 chars). Admin not created.");
    throw new Error("ADMIN_PASSWORD is too weak for production.");
  }

  // Attach to an existing company, or create a default one.
  let company = await Company.findOne();
  if (!company) {
    const { normalizeCurrencyCode } = require("../utils/currency");
    company = await Company.create({
      id: `CMP-${Date.now()}`,
      businessName: process.env.COMPANY_NAME || "DARFUS Jewellery",
      workspace: process.env.COMPANY_WORKSPACE || "darfus",
      currency: normalizeCurrencyCode(process.env.DEFAULT_CURRENCY || "AED"),
      country: process.env.COMPANY_COUNTRY || "UAE",
    });
    logger.info(`[Bootstrap] Created default company ${company.id} (${company.businessName}).`);
  }

  const admin = await User.create({
    id: `USR-${Date.now()}`,
    companyId: company.id,
    firstName,
    lastName,
    email,
    phone,
    password: bcrypt.hashSync(password, 10),
    jobTitle: "Administrator",
    role: "admin",
  });
  await assignUserRole(admin.id, company.id, "admin");
  await ensureDefaultBranches(company.id);

  logger.info(`[Bootstrap] Primary admin created: ${admin.email} (company ${company.id}).`);
}

module.exports = ensureAdmin;
