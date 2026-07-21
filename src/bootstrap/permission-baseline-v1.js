"use strict";

// Immutable v1.0.0 baseline. Later catalog versions must be added separately
// so migrations that import this module keep their original upgrade contract.
const LIFECYCLE_PERMISSIONS = [
  "branches.create", "branches.update", "branches.deactivate", "branches.reactivate", "branches.delete",
  "customers.deactivate", "customers.reactivate", "suppliers.deactivate", "suppliers.reactivate"
];

const SALES_ADJUSTMENT_PERMISSIONS = [
  "sales.returns.execute", "sales.exchanges.execute", "sales.installments.collect"
];

const PERMISSIONS = [
  "dashboard.view",
  "customers.view", "customers.create", "customers.update", "customers.delete", "customers.export",
  "sales.view", "sales.create", "sales.approve", "sales.export", "sales.print", ...SALES_ADJUSTMENT_PERMISSIONS,
  "pos.view", "pos.sell", "pos.discount.approve",
  "inventory.view", "inventory.create", "inventory.update", "inventory.delete", "inventory.adjust", "inventory.export", "inventory.print",
  "suppliers.view", "suppliers.create", "suppliers.update", "suppliers.delete", "suppliers.export",
  "accounting.view", "accounting.post", "accounting.export", "accounting.lock.manage", "accounting.reconciliation.view",
  "treasury.view", "treasury.update", "treasury.register.view", "treasury.register.open", "treasury.register.close",
  "reports.view", "reports.export", "settings.view", "settings.update",
  "reservations.view", "reservations.view_all", "reservations.view_branch", "reservations.view_own",
  "reservations.create", "reservations.record_payment", "reservations.view_payments", "reservations.view_receipts",
  "reservations.complete_sale", "reservations.cancel", "reservations.amend_items", "reservations.reprice_items",
  "reservations.extend_expiry", "reservations.renew", "reservations.view_renewal_transfers",
  "reservations.refund_request", "reservations.refund_approve", "reservations.refund_reject", "reservations.refund_execute",
  "reservations.refund_method_override", "reservations.audit_view", "reservations.reports_view", "reservations.reports_export",
  "reservations.statement_view", "reservations.configure_account",
  "gold_purchase.cgp.view", "gold_purchase.cgp.view_all", "gold_purchase.cgp.view_branch", "gold_purchase.cgp.view_own",
  "gold_purchase.cgp.create", "gold_purchase.cgp.update_draft", "gold_purchase.cgp.validate", "gold_purchase.cgp.submit",
  "gold_purchase.cgp.approve", "gold_purchase.cgp.reject", "gold_purchase.cgp.self_approve", "gold_purchase.cgp.void",
  "gold_purchase.igp.view", "gold_purchase.igp.view_all", "gold_purchase.igp.view_branch", "gold_purchase.igp.view_own",
  "gold_purchase.igp.create", "gold_purchase.igp.update_draft", "gold_purchase.igp.validate", "gold_purchase.igp.submit",
  "gold_purchase.igp.approve", "gold_purchase.igp.reject", "gold_purchase.igp.self_approve", "gold_purchase.igp.void",
  "users.view", "users.create", "users.update", "users.delete", "users.manage",
  "system_accounts.view", "system_accounts.manage", "system_accounts.credentials.reset",
  "system_accounts.sessions.revoke", "security.recovery.manage", "super_admin.manage",
  "employees.credentials.manage", "employees.permissions.manage", "employees.branches.manage", "employees.verification.view",
  "roles.view", "roles.manage", "permissions.manage",
  "notifications.view", "notifications.manage", "approvals.view", "approvals.manage",
  "audit.view", "gold.view", "gold.update", "payroll.view", "payroll.manage",
  ...LIFECYCLE_PERMISSIONS
];

const ROLE_DEFS = {
  admin: PERMISSIONS,
  owner: PERMISSIONS,
  manager: PERMISSIONS.filter((permission) => ![
    "accounting.post", "accounting.lock.manage", "users.delete", "roles.manage", "permissions.manage",
    ...LIFECYCLE_PERMISSIONS
  ].includes(permission)),
  accountant: [
    "dashboard.view", "sales.view", "customers.view", "suppliers.view", "accounting.view", "accounting.post",
    "treasury.view", "treasury.update", "treasury.register.view", "treasury.register.open", "treasury.register.close",
    "accounting.lock.manage", "accounting.reconciliation.view", "reports.view", "reports.export", "settings.view",
    "notifications.view", "audit.view", "reservations.view", "reservations.view_all", "reservations.view_payments",
    "reservations.view_receipts", "reservations.refund_approve", "reservations.refund_reject",
    "reservations.refund_execute", "reservations.audit_view", "reservations.reports_view", "reservations.reports_export",
    "reservations.statement_view", "reservations.configure_account"
  ],
  sales: [
    "dashboard.view", "sales.view", "sales.create", "sales.print", "pos.view", "pos.sell", "customers.view", "customers.create",
    "customers.update", "inventory.view", "notifications.view", "reservations.view", "reservations.view_branch",
    "reservations.create", "reservations.record_payment", "reservations.view_payments", "reservations.view_receipts",
    "reservations.complete_sale", "reservations.cancel", "reservations.amend_items", "reservations.reprice_items",
    "reservations.extend_expiry", "reservations.renew", "reservations.view_renewal_transfers",
    "reservations.refund_request", "reservations.audit_view", "reservations.statement_view"
  ]
};

module.exports = {
  PERMISSION_BASELINE_VERSION: "v1.0.0",
  LIFECYCLE_PERMISSIONS,
  SALES_ADJUSTMENT_PERMISSIONS,
  PERMISSIONS,
  ROLE_DEFS
};
