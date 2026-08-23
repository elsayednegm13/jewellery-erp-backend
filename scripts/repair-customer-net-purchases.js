#!/usr/bin/env node
/**
 * Manual Customer Net Purchases Repair Utility.
 * Recalculates net purchases for all customers based on Option B rules.
 *
 * Usage:
 *   node scripts/repair-customer-net-purchases.js [--dry-run]
 *   node scripts/repair-customer-net-purchases.js --apply
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const models = require("../src/models");
const { recalculateCustomerNetPurchases } = require("../src/services/customer-purchases.service");

async function run() {
  const isApply = process.argv.includes("--apply");
  const modeName = isApply ? "APPLY (Live Update)" : "DRY RUN (Simulation)";
  console.log(`[PurchasesRepair] Starting repair utility in ${modeName} mode...\n`);

  const customers = await models.Customer.findAll();
  console.log(`Found ${customers.length} customers in database.`);

  const t = await models.sequelize.transaction();
  let changeCount = 0;

  try {
    const summary = [];

    for (const customer of customers) {
      const oldPurchases = Number(customer.purchases) || 0;
      
      // Calculate net purchases using central service (inside transaction)
      const newPurchases = await recalculateCustomerNetPurchases(models, customer.companyId, customer.id, { transaction: t });
      const difference = Math.round((newPurchases - oldPurchases) * 100) / 100;

      if (Math.abs(difference) > 0.01) {
        summary.push({
          id: customer.id,
          name: customer.name,
          oldPurchases: oldPurchases.toFixed(2),
          newPurchases: newPurchases.toFixed(2),
          difference: (difference > 0 ? "+" : "") + difference.toFixed(2)
        });
        changeCount++;
      }
    }

    if (summary.length === 0) {
      console.log("No mismatched customer net purchase totals found. Database is already consistent!");
    } else {
      console.log("Mismatched Customers Summary:");
      console.table(summary);
    }

    if (isApply) {
      await t.commit();
      console.log(`\n[PurchasesRepair] Successfully applied updates for ${changeCount} customers.`);
    } else {
      await t.rollback();
      console.log(`\n[PurchasesRepair] Dry run complete. Rolled back all changes. No DB updates were saved. Run with --apply to commit.`);
    }

    process.exit(0);
  } catch (err) {
    await t.rollback();
    console.error("[PurchasesRepair] Error running repair utility:", err.message);
    process.exit(1);
  }
}

run();
