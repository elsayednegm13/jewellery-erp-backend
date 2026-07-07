const sequelize = require("../config/database");

// Import all models
const Company = require("./company.model");
const User = require("./user.model");
const Role = require("./role.model");
const Permission = require("./permission.model");
const RolePermission = require("./rolePermission.model");
const UserRole = require("./userRole.model");
const Employee = require("./employee.model");
const EmployeeSession = require("./employeeSession.model");
const Asset = require("./asset.model");
const AssetEvent = require("./assetEvent.model");
const AssetCertificate = require("./assetCertificate.model");
const AssetAttachment = require("./assetAttachment.model");
const Customer = require("./customer.model");
const CustomerAttachment = require("./customerAttachment.model");
const Supplier = require("./supplier.model");
const SupplierDocument = require("./supplierDocument.model");
const SupplierConsignment = require("./supplierConsignment.model");
const PurchaseOrder = require("./purchaseOrder.model");
const PurchaseOrderItem = require("./purchaseOrderItem.model");
const Invoice = require("./invoice.model");
const InvoiceItem = require("./invoiceItem.model");
const Reservation = require("./reservation.model");
const Transfer = require("./transfer.model");
const ManufacturingOrder = require("./manufacturingOrder.model");
const CustomerGoldPool = require("./customerGoldPool.model");
const InventoryGoldPool = require("./inventoryGoldPool.model");
const Account = require("./account.model");
const JournalEntry = require("./journalEntry.model");
const JournalLine = require("./journalLine.model");
const CashTransaction = require("./cashTransaction.model");
const Installment = require("./installment.model");
const GiftVoucher = require("./giftVoucher.model");
const GoldFixing = require("./goldFixing.model");
const LoyaltyTransaction = require("./loyaltyTransaction.model");
const Attendance = require("./attendance.model");
const Payslip = require("./payslip.model");
const ApprovalRequest = require("./approvalRequest.model");
const Setting = require("./setting.model");
const AuditLog = require("./auditLog.model");
const GoldPrice = require("./goldPrice.model");
const Notification = require("./notification.model");
const Branch = require("./branch.model");
const Payment = require("./payment.model");
const StockAudit = require("./stockAudit.model");
const StockAuditItem = require("./stockAuditItem.model");
const Product = require("./product.model");
const StockMovement = require("./stockMovement.model");
const IdempotencyRequest = require("./idempotencyRequest.model");
const CustomerCreditTransaction = require("./customerCreditTransaction.model");

// Define Associations

// Company relationships
Company.hasMany(User, { foreignKey: "companyId", as: "users" });
User.belongsTo(Company, { foreignKey: "companyId", as: "company" });

Company.hasMany(Role, { foreignKey: "companyId", as: "roles" });
Role.belongsTo(Company, { foreignKey: "companyId", as: "company" });

Company.hasMany(Branch, { foreignKey: "companyId", as: "branches" });
Branch.belongsTo(Company, { foreignKey: "companyId", as: "company" });

// Product relationships
Company.hasMany(Product, { foreignKey: "companyId", as: "products" });
Product.belongsTo(Company, { foreignKey: "companyId", as: "company" });

Branch.hasMany(Product, { foreignKey: "branchId", as: "products" });
Product.belongsTo(Branch, { foreignKey: "branchId", as: "branchDetail" });

// StockMovement relationships
Company.hasMany(StockMovement, { foreignKey: "companyId", as: "stockMovements" });
StockMovement.belongsTo(Company, { foreignKey: "companyId", as: "company" });

Product.hasMany(StockMovement, { foreignKey: "productId", as: "movements" });
StockMovement.belongsTo(Product, { foreignKey: "productId", as: "product" });

Branch.hasMany(Asset, { foreignKey: "branchId", as: "assets" });
Asset.belongsTo(Branch, { foreignKey: "branchId", as: "branchDetail" });
User.belongsToMany(Role, { through: UserRole, foreignKey: "userId", otherKey: "roleId", as: "roles" });
Role.belongsToMany(User, { through: UserRole, foreignKey: "roleId", otherKey: "userId", as: "users" });
Role.belongsToMany(Permission, { through: RolePermission, foreignKey: "roleId", otherKey: "permissionId", as: "permissions" });
Permission.belongsToMany(Role, { through: RolePermission, foreignKey: "permissionId", otherKey: "roleId", as: "roles" });

Company.hasMany(Employee, { foreignKey: "companyId", as: "employees" });
Employee.belongsTo(Company, { foreignKey: "companyId", as: "company" });

Company.hasMany(Asset, { foreignKey: "companyId", as: "assets" });
Asset.belongsTo(Company, { foreignKey: "companyId", as: "company" });

Company.hasMany(Customer, { foreignKey: "companyId", as: "customers" });
Customer.belongsTo(Company, { foreignKey: "companyId", as: "company" });

Company.hasMany(Supplier, { foreignKey: "companyId", as: "suppliers" });
Supplier.belongsTo(Company, { foreignKey: "companyId", as: "company" });

Company.hasMany(PurchaseOrder, { foreignKey: "companyId", as: "purchaseOrders" });
PurchaseOrder.belongsTo(Company, { foreignKey: "companyId", as: "company" });

Company.hasMany(Invoice, { foreignKey: "companyId", as: "invoices" });
Invoice.belongsTo(Company, { foreignKey: "companyId", as: "company" });

Company.hasMany(Reservation, { foreignKey: "companyId", as: "reservations" });
Reservation.belongsTo(Company, { foreignKey: "companyId", as: "company" });

Company.hasMany(Transfer, { foreignKey: "companyId", as: "transfers" });
Transfer.belongsTo(Company, { foreignKey: "companyId", as: "company" });

Company.hasMany(ManufacturingOrder, { foreignKey: "companyId", as: "manufacturingOrders" });
ManufacturingOrder.belongsTo(Company, { foreignKey: "companyId", as: "company" });

Company.hasMany(CustomerGoldPool, { foreignKey: "companyId", as: "customerGoldPools" });
CustomerGoldPool.belongsTo(Company, { foreignKey: "companyId", as: "company" });

Company.hasMany(InventoryGoldPool, { foreignKey: "companyId", as: "inventoryGoldPools" });
InventoryGoldPool.belongsTo(Company, { foreignKey: "companyId", as: "company" });

Company.hasMany(Account, { foreignKey: "companyId", as: "accounts" });
Account.belongsTo(Company, { foreignKey: "companyId", as: "company" });

Company.hasMany(JournalEntry, { foreignKey: "companyId", as: "journalEntries" });
JournalEntry.belongsTo(Company, { foreignKey: "companyId", as: "company" });

Company.hasMany(CashTransaction, { foreignKey: "companyId", as: "cashTransactions" });
CashTransaction.belongsTo(Company, { foreignKey: "companyId", as: "company" });
CashTransaction.belongsTo(JournalEntry, { foreignKey: "journalEntryId", as: "journalEntry" });

Company.hasMany(Installment, { foreignKey: "companyId", as: "installments" });
Installment.belongsTo(Company, { foreignKey: "companyId", as: "company" });
Invoice.hasMany(Installment, { foreignKey: "invoiceId", as: "installments" });
Installment.belongsTo(Invoice, { foreignKey: "invoiceId", as: "invoice" });

Company.hasMany(Payment, { foreignKey: "companyId", as: "payments" });
Payment.belongsTo(Company, { foreignKey: "companyId", as: "company" });

Branch.hasMany(Payment, { foreignKey: "branchId", as: "payments" });
Payment.belongsTo(Branch, { foreignKey: "branchId", as: "branchDetail" });

Invoice.hasMany(Payment, { foreignKey: "invoiceId", as: "payments" });
Payment.belongsTo(Invoice, { foreignKey: "invoiceId", as: "invoice" });


Company.hasMany(GiftVoucher, { foreignKey: "companyId", as: "giftVouchers" });
GiftVoucher.belongsTo(Company, { foreignKey: "companyId", as: "company" });

Company.hasMany(GoldFixing, { foreignKey: "companyId", as: "goldFixings" });
GoldFixing.belongsTo(Company, { foreignKey: "companyId", as: "company" });

Company.hasMany(LoyaltyTransaction, { foreignKey: "companyId", as: "loyaltyTransactions" });
LoyaltyTransaction.belongsTo(Company, { foreignKey: "companyId", as: "company" });
Customer.hasMany(LoyaltyTransaction, { foreignKey: "customerId", as: "loyaltyTransactions" });
LoyaltyTransaction.belongsTo(Customer, { foreignKey: "customerId", as: "customer" });

Company.hasMany(Attendance, { foreignKey: "companyId", as: "attendance" });
Attendance.belongsTo(Company, { foreignKey: "companyId", as: "company" });
Employee.hasMany(Attendance, { foreignKey: "employeeId", as: "attendance" });
Attendance.belongsTo(Employee, { foreignKey: "employeeId", as: "employee" });

Company.hasMany(Payslip, { foreignKey: "companyId", as: "payslips" });
Payslip.belongsTo(Company, { foreignKey: "companyId", as: "company" });
Employee.hasMany(Payslip, { foreignKey: "employeeId", as: "payslips" });
Payslip.belongsTo(Employee, { foreignKey: "employeeId", as: "employee" });

Company.hasMany(ApprovalRequest, { foreignKey: "companyId", as: "approvalRequests" });
ApprovalRequest.belongsTo(Company, { foreignKey: "companyId", as: "company" });

Company.hasMany(Setting, { foreignKey: "companyId", as: "settings" });
Setting.belongsTo(Company, { foreignKey: "companyId", as: "company" });

Company.hasMany(AuditLog, { foreignKey: "companyId", as: "auditLogs" });
AuditLog.belongsTo(Company, { foreignKey: "companyId", as: "company" });

Company.hasMany(Notification, { foreignKey: "companyId", as: "notifications" });
Notification.belongsTo(Company, { foreignKey: "companyId", as: "company" });
User.hasMany(Notification, { foreignKey: "userId", as: "notifications" });
Notification.belongsTo(User, { foreignKey: "userId", as: "user" });

// Stock Audit associations
Company.hasMany(StockAudit, { foreignKey: "companyId", as: "stockAudits" });
StockAudit.belongsTo(Company, { foreignKey: "companyId", as: "company" });

Branch.hasMany(StockAudit, { foreignKey: "branchId", as: "stockAudits" });
StockAudit.belongsTo(Branch, { foreignKey: "branchId", as: "branchDetail" });

StockAudit.hasMany(StockAuditItem, { foreignKey: "stockAuditId", as: "items" });
StockAuditItem.belongsTo(StockAudit, { foreignKey: "stockAuditId", as: "stockAudit" });

StockAuditItem.belongsTo(Asset, { foreignKey: "assetId", as: "asset" });
Asset.hasMany(StockAuditItem, { foreignKey: "assetId", as: "stockAuditItems" });

StockAuditItem.belongsTo(Branch, { foreignKey: "expectedBranchId", as: "expectedBranch" });
StockAuditItem.belongsTo(Branch, { foreignKey: "scannedBranchId", as: "scannedBranch" });

// Employee & Sessions
Employee.hasMany(EmployeeSession, { foreignKey: "employeeId", as: "sessions" });
EmployeeSession.belongsTo(Employee, { foreignKey: "employeeId", as: "employee" });

// Asset relationships
Asset.hasMany(AssetEvent, { foreignKey: "assetId", as: "events" });
AssetEvent.belongsTo(Asset, { foreignKey: "assetId", as: "asset" });

Asset.hasMany(AssetCertificate, { foreignKey: "assetId", as: "certificates" });
AssetCertificate.belongsTo(Asset, { foreignKey: "assetId", as: "asset" });

Asset.hasMany(AssetAttachment, { foreignKey: "assetId", as: "attachments" });
AssetAttachment.belongsTo(Asset, { foreignKey: "assetId", as: "asset" });

// Customer relationships
Customer.hasMany(Invoice, { foreignKey: "customerId", as: "invoices" });
Invoice.belongsTo(Customer, { foreignKey: "customerId", as: "customer" });

Customer.hasMany(Reservation, { foreignKey: "customerId", as: "reservations" });
Reservation.belongsTo(Customer, { foreignKey: "customerId", as: "customer" });

Customer.hasMany(CustomerGoldPool, { foreignKey: "customerId", as: "customerGoldPools" });
CustomerGoldPool.belongsTo(Customer, { foreignKey: "customerId", as: "customer" });

Customer.hasMany(CustomerAttachment, { foreignKey: "customerId", as: "attachments" });
CustomerAttachment.belongsTo(Customer, { foreignKey: "customerId", as: "customer" });
Company.hasMany(CustomerAttachment, { foreignKey: "companyId", as: "customerAttachments" });
CustomerAttachment.belongsTo(Company, { foreignKey: "companyId", as: "company" });

// Customer Credit Ledger (Phase 23-Fix) — minimal, read-side associations only.
Company.hasMany(CustomerCreditTransaction, { foreignKey: "companyId", as: "customerCreditTransactions" });
CustomerCreditTransaction.belongsTo(Company, { foreignKey: "companyId", as: "company" });
Customer.hasMany(CustomerCreditTransaction, { foreignKey: "customerId", as: "creditTransactions" });
CustomerCreditTransaction.belongsTo(Customer, { foreignKey: "customerId", as: "customer" });

// Supplier relationships
Supplier.hasMany(SupplierDocument, { foreignKey: "supplierId", as: "documents" });
SupplierDocument.belongsTo(Supplier, { foreignKey: "supplierId", as: "supplier" });

Supplier.hasMany(SupplierConsignment, { foreignKey: "supplierId", as: "consignments" });
SupplierConsignment.belongsTo(Supplier, { foreignKey: "supplierId", as: "supplier" });

Supplier.hasMany(PurchaseOrder, { foreignKey: "supplierId", as: "purchaseOrders" });
PurchaseOrder.belongsTo(Supplier, { foreignKey: "supplierId", as: "supplier" });

// PurchaseOrder items
PurchaseOrder.hasMany(PurchaseOrderItem, { foreignKey: "purchaseOrderId", as: "items" });
PurchaseOrderItem.belongsTo(PurchaseOrder, { foreignKey: "purchaseOrderId", as: "purchaseOrder" });
PurchaseOrderItem.belongsTo(Asset, { foreignKey: "assetId", as: "asset" });
Asset.hasOne(PurchaseOrderItem, { foreignKey: "assetId", as: "purchaseOrderItem" });

// Invoice items
Invoice.hasMany(InvoiceItem, { foreignKey: "invoiceId", as: "items" });
InvoiceItem.belongsTo(Invoice, { foreignKey: "invoiceId", as: "invoice" });

// JournalEntry lines
JournalEntry.hasMany(JournalLine, { foreignKey: "journalEntryId", as: "lines" });
JournalLine.belongsTo(JournalEntry, { foreignKey: "journalEntryId", as: "journalEntry" });

JournalLine.belongsTo(Account, { foreignKey: "accountId", as: "account" });
Account.hasMany(JournalLine, { foreignKey: "accountId", as: "journalLines" });

module.exports = {
  sequelize,
  Company,
  User,
  Role,
  Permission,
  RolePermission,
  UserRole,
  Employee,
  EmployeeSession,
  Asset,
  AssetEvent,
  AssetCertificate,
  AssetAttachment,
  Customer,
  CustomerAttachment,
  Supplier,
  SupplierDocument,
  SupplierConsignment,
  PurchaseOrder,
  PurchaseOrderItem,
  Invoice,
  InvoiceItem,
  Reservation,
  Transfer,
  ManufacturingOrder,
  CustomerGoldPool,
  InventoryGoldPool,
  Account,
  JournalEntry,
  JournalLine,
  CashTransaction,
  Installment,
  GiftVoucher,
  GoldFixing,
  LoyaltyTransaction,
  Attendance,
  Payslip,
  ApprovalRequest,
  Setting,
  AuditLog,
  GoldPrice,
  Notification,
  Branch,
  Payment,
  StockAudit,
  StockAuditItem,
  Product,
  StockMovement,
  IdempotencyRequest,
  CustomerCreditTransaction
};
