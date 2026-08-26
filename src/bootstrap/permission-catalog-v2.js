"use strict";

// Later permission additions stay separate from the immutable v1 baseline.
const INVENTORY_RETURN_RESTOCK_PERMISSIONS = [
  "inventory.returns.approve_restock",
];

const INVENTORY_REVISION_PERMISSIONS = [
  "inventory.revision.create",
  "inventory.revision.view",
];

module.exports = { INVENTORY_RETURN_RESTOCK_PERMISSIONS, INVENTORY_REVISION_PERMISSIONS };
