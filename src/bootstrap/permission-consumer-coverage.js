"use strict";

// Canonical permission modules used by the generic ERP CRUD adapter. Read-only
// branch discovery is part of Settings/Company context; branch lifecycle
// mutations retain their dedicated branches.* permissions.
const CRUD_PERMISSIONS = Object.freeze({
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
});

const CRUD_READ_PERMISSION_OVERRIDES = Object.freeze({
  branches: "settings.view",
});

// Some generic resources intentionally expose only a read surface or a
// dedicated mutation authority. An empty list is an explicit fail-closed
// result; it is not permission drift and must never synthesize a new slug.
const CRUD_ACTION_PERMISSION_OVERRIDES = Object.freeze({
  invoices: Object.freeze({ update: [], delete: [] }),
  reservations: Object.freeze({ update: [], delete: [] }),
  "approval-requests": Object.freeze({ create: ["approvals.manage"], update: ["approvals.manage"], delete: ["approvals.manage"] }),
  "journal-entries": Object.freeze({ create: ["accounting.post"], update: ["accounting.post"], delete: ["accounting.post"] }),
  accounts: Object.freeze({ create: ["accounting.post"], update: ["accounting.post"], delete: ["accounting.post"] }),
  "cash-transactions": Object.freeze({ create: ["treasury.update"], update: ["treasury.update"], delete: ["treasury.update"] }),
});

function crudGuardPermissionCandidates(resourceName, action) {
  const permissionModule = CRUD_PERMISSIONS[resourceName];
  if (!permissionModule) return [];
  const mappedAction = action === "list" || action === "get" ? "view" : action;
  const readOverride = mappedAction === "view" ? CRUD_READ_PERMISSION_OVERRIDES[resourceName] : null;
  if (readOverride) return [readOverride];
  const actionOverride = CRUD_ACTION_PERMISSION_OVERRIDES[resourceName]?.[mappedAction];
  if (actionOverride) return actionOverride;
  return [
    `${permissionModule}.${mappedAction}`,
  ].filter(Boolean);
}

module.exports = {
  CRUD_PERMISSIONS,
  CRUD_READ_PERMISSION_OVERRIDES,
  CRUD_ACTION_PERMISSION_OVERRIDES,
  crudGuardPermissionCandidates,
};
