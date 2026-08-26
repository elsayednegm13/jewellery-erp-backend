"use strict";

const { PERMISSIONS: BASELINE_PERMISSIONS } = require("./permission-baseline-v1");
const {
  INVENTORY_RETURN_RESTOCK_PERMISSIONS,
  INVENTORY_REVISION_PERMISSIONS,
} = require("./permission-catalog-v2");
const { CGP_FUTURE_CAPABILITIES } = require("./cgp-permission-catalog-v3");
const { GOLD_PRICE_APPROVAL_PERMISSION } = require("./gold-price-approval-permission-catalog");
const { GOLD_PRICING_POLICY_PERMISSION } = require("./gold-pricing-policy-permission-catalog");

function descriptorFromName(name) {
  const parts = String(name).split(".");
  const action = parts.pop();
  return { name, module: parts.join("."), action, description: name };
}

// These descriptors are taken from the later authority migrations that
// intentionally superseded the v1 derived metadata. The names remain owned
// by the versioned catalogs; historical migrations are not edited.
const PERMISSION_METADATA_OVERRIDES = Object.freeze({
  "inventory.workshop.read": { module: "inventory", action: "read", description: "Read Workshop custody and lifecycle records" },
  "inventory.workshop.send": { module: "inventory", action: "send", description: "Send an existing Asset to Workshop custody" },
  "inventory.workshop.complete": { module: "inventory", action: "complete", description: "Complete Workshop work and return an Asset" },
  "inventory.workshop.cancel": { module: "inventory", action: "cancel", description: "Cancel a Workshop request before completion" },
  "inventory.count.read": { module: "inventory", action: "read", description: "Read branch-scoped Inventory Count sessions and variances" },
  "inventory.count.create": { module: "inventory", action: "create", description: "Create a branch/location-scoped Inventory Count session" },
  "inventory.count.scan": { module: "inventory", action: "scan", description: "Scan Asset Barcode/RFID identities into an Inventory Count" },
  "inventory.count.complete": { module: "inventory", action: "complete", description: "Complete and close an Inventory Count session" },
  "gold_purchase.cgp.self_approve": { module: "gold_purchase.cgp", action: "self_approve", description: "Controlled self-review override / تجاوز الموافقة الذاتية المنضبط" },
  "gold_purchase.igp.self_approve": { module: "gold_purchase.igp", action: "self_approve", description: "Controlled self-review override / تجاوز الموافقة الذاتية المنضبط" },
  "employees.credentials.manage": { module: "employees", action: "credentials", description: "employees.credentials.manage" },
  "employees.permissions.manage": { module: "employees", action: "permissions", description: "employees.permissions.manage" },
  "employees.branches.manage": { module: "employees", action: "branches", description: "employees.branches.manage" },
  "employees.verification.view": { module: "employees", action: "verification", description: "employees.verification.view" },
  "inventory.returns.approve_restock": { module: "inventory.returns", action: "approve_restock", description: "Approve returned Asset restock after GOOD condition review" },
  "gold.manage_pricing_policy": { module: "gold", action: "manage_pricing_policy", description: "Create and activate versioned CGP pricing policies" },
});

const PERMISSION_CATALOG = Object.freeze([
  ...[
    ...BASELINE_PERMISSIONS,
    ...INVENTORY_RETURN_RESTOCK_PERMISSIONS,
    ...INVENTORY_REVISION_PERMISSIONS,
  ].map(descriptorFromName),
  ...CGP_FUTURE_CAPABILITIES,
  GOLD_PRICE_APPROVAL_PERMISSION,
  GOLD_PRICING_POLICY_PERMISSION,
].map((permission) => ({ ...permission, ...(PERMISSION_METADATA_OVERRIDES[permission.name] || {}) })));

function catalogIntegrityError(code, details) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  return error;
}

function validatePermissionCatalog(catalog = PERMISSION_CATALOG, { enforceUniqueModuleAction = false } = {}) {
  const byName = new Map();
  const byModuleAction = new Map();
  for (const permission of catalog) {
    const name = String(permission?.name || "").trim();
    const module = String(permission?.module || "").trim();
    const action = String(permission?.action || "").trim();
    if (!name || !module || !action) {
      throw catalogIntegrityError("INVALID_PERMISSION_CATALOG_ENTRY", { permission });
    }
    if (byName.has(name)) {
      throw catalogIntegrityError("DUPLICATE_PERMISSION_NAME", { name });
    }
    const moduleAction = `${module}:${action}`;
    if (enforceUniqueModuleAction && byModuleAction.has(moduleAction)) {
      throw catalogIntegrityError("DUPLICATE_PERMISSION_MODULE_ACTION", {
        module,
        action,
        names: [byModuleAction.get(moduleAction), name],
      });
    }
    byName.set(name, permission);
    byModuleAction.set(moduleAction, name);
  }
  return Object.freeze({ count: byName.size, names: Object.freeze([...byName.keys()]), byName });
}

const CATALOG_INDEX = validatePermissionCatalog();

module.exports = {
  PERMISSION_CATALOG,
  PERMISSION_METADATA_OVERRIDES,
  CATALOG_INDEX,
  descriptorFromName,
  validatePermissionCatalog,
};
