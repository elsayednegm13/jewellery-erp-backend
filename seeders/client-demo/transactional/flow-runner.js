"use strict";

const fs = require("fs");
const path = require("path");
const client = require("./http-client");
const { loadContext } = require("./context");

// List of flow scenarios in strict dependency order
const FLOWS = [
  require("./flows/01-supplier-purchases"),
  require("./flows/02-pos-cash-sales"),
  require("./flows/03-pos-installment-sale"),
  require("./flows/04-pos-deposit-sale"),
  require("./flows/05-sales-return"),
  require("./flows/06-sales-exchange"),
  require("./flows/07-installment-payments"),
  require("./flows/08-customer-gold"),
  require("./flows/09-supplier-payment"),
  require("./flows/10-manual-journal-cycle"),
  require("./flows/11-gift-voucher-cycle"),
  require("./flows/12-treasury-transactions"),
  require("./flows/13-customer-credit-cycle"),
  require("./flows/14-invoice-draft-post")
];

/**
 * Execute all transactional demo flows sequentially.
 */
async function runAll(isPlan = false) {
  if (isPlan) {
    throw new Error("Cannot run flows in plan mode.");
  }

  let dbContext = null;
  console.log("[Seeder] Booting in-process Express server on ephemeral port...");
  await client.startServer();

  try {
    console.log("[Seeder] Loading database context...");
    dbContext = await loadContext();

    console.log("[Seeder] Authenticating as demo administrator...");
    await client.login();
    console.log("[Seeder] Authentication successful.");

    console.log("[Seeder] Starting sequential flow runner...");
    for (const flow of FLOWS) {
      console.log(`[Seeder] Running flow: ${flow.name} (${flow.description})...`);
      try {
        await flow.run(client, dbContext);
        console.log(`[Seeder] ✓ Flow completed successfully: ${flow.name}`);
      } catch (err) {
        console.error(`[Seeder] ✗ Flow failed: ${flow.name}`);
        console.error(`[Seeder] Error message: ${err.message}`);
        throw err;
      }
    }
    console.log("[Seeder] ✓ All transactional demo flows completed successfully.");
    return true;
  } catch (error) {
    console.error(`[Seeder] Transactional seed runner aborted: ${error.message}`);
    throw error;
  } finally {
    console.log("[Seeder] Stopping in-process Express server...");
    await client.stopServer();
    console.log("[Seeder] Server stopped.");
  }
}

module.exports = {
  FLOWS,
  runAll
};
