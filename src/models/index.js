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
const ReservationItem = require("./reservationItem.model");
const ReservationPayment = require("./reservationPayment.model");
const ReservationPaymentApplication = require("./reservationPaymentApplication.model");
const ReservationRefund = require("./reservationRefund.model");
const ReservationRefundAllocation = require("./reservationRefundAllocation.model");
const ReservationAmendment = require("./reservationAmendment.model");
const ReservationAmendmentItem = require("./reservationAmendmentItem.model");
const ReservationExpiryExtension = require("./reservationExpiryExtension.model");
const ReservationRenewal = require("./reservationRenewal.model");
const ReservationPaymentTransfer = require("./reservationPaymentTransfer.model");
const Transfer = require("./transfer.model");
const ManufacturingOrder = require("./manufacturingOrder.model");
const CustomerGoldPool = require("./customerGoldPool.model");
const InventoryGoldPool = require("./inventoryGoldPool.model");
const CustomerGoldPurchaseDocument = require("./customerGoldPurchaseDocument.model");
const CustomerGoldPurchaseItem = require("./customerGoldPurchaseItem.model");
const InvestmentGoldPurchaseDocument = require("./investmentGoldPurchaseDocument.model");
const InvestmentGoldPurchaseItem = require("./investmentGoldPurchaseItem.model");
const GoldPurchaseApprovalRequest = require("./goldPurchaseApprovalRequest.model");
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
const BarcodeInventoryCode = require("./barcodeInventoryCode.model");
const BarcodeItemCode = require("./barcodeItemCode.model");
const BarcodeSequence = require("./barcodeSequence.model");

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
Asset.hasMany(StockMovement, { foreignKey: "assetId", as: "stockMovements" });
StockMovement.belongsTo(Asset, { foreignKey: "assetId", as: "asset" });

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

Company.hasMany(BarcodeInventoryCode, { foreignKey: "companyId", as: "barcodeInventoryCodes" });
BarcodeInventoryCode.belongsTo(Company, { foreignKey: "companyId", as: "company" });
Company.hasMany(BarcodeItemCode, { foreignKey: "companyId", as: "barcodeItemCodes" });
BarcodeItemCode.belongsTo(Company, { foreignKey: "companyId", as: "company" });
Company.hasMany(BarcodeSequence, { foreignKey: "companyId", as: "barcodeSequences" });
BarcodeSequence.belongsTo(Company, { foreignKey: "companyId", as: "company" });

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
Company.hasMany(ReservationItem, { foreignKey: "companyId", as: "reservationItems" });
ReservationItem.belongsTo(Company, { foreignKey: "companyId", as: "company" });
Company.hasMany(ReservationPayment, { foreignKey: "companyId", as: "reservationPayments" });
ReservationPayment.belongsTo(Company, { foreignKey: "companyId", as: "company" });
Company.hasMany(ReservationPaymentApplication, { foreignKey: "companyId", as: "reservationPaymentApplications" });
ReservationPaymentApplication.belongsTo(Company, { foreignKey: "companyId", as: "company" });
Company.hasMany(ReservationRefund, { foreignKey: "companyId", as: "reservationRefunds" });
ReservationRefund.belongsTo(Company, { foreignKey: "companyId", as: "company" });
Company.hasMany(ReservationRefundAllocation, { foreignKey: "companyId", as: "reservationRefundAllocations" });
ReservationRefundAllocation.belongsTo(Company, { foreignKey: "companyId", as: "company" });

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
Reservation.hasMany(ReservationItem, { foreignKey: "reservationId", as: "items" });
ReservationItem.belongsTo(Reservation, { foreignKey: "reservationId", as: "reservation" });
Reservation.hasMany(ReservationPayment, { foreignKey: "reservationId", as: "payments" });
ReservationPayment.belongsTo(Reservation, { foreignKey: "reservationId", as: "reservation" });
Reservation.hasMany(ReservationPaymentApplication, { foreignKey: "reservationId", as: "paymentApplications" });
ReservationPaymentApplication.belongsTo(Reservation, { foreignKey: "reservationId", as: "reservation" });
Reservation.hasMany(ReservationRefund, { foreignKey: "reservationId", as: "refunds" });
ReservationRefund.belongsTo(Reservation, { foreignKey: "reservationId", as: "reservation" });
Customer.hasMany(ReservationPayment, { foreignKey: "customerId", as: "reservationPayments" });
ReservationPayment.belongsTo(Customer, { foreignKey: "customerId", as: "customer" });
Customer.hasMany(ReservationRefund, { foreignKey: "customerId", as: "reservationRefunds" });
ReservationRefund.belongsTo(Customer, { foreignKey: "customerId", as: "customer" });
Asset.hasMany(ReservationItem, { foreignKey: "assetId", as: "reservationItems" });
ReservationItem.belongsTo(Asset, { foreignKey: "assetId", as: "asset" });
ReservationPayment.belongsTo(JournalEntry, { foreignKey: "journalEntryId", as: "journalEntry" });
JournalEntry.hasOne(ReservationPayment, { foreignKey: "journalEntryId", as: "reservationPayment" });
ReservationPayment.hasOne(ReservationPaymentApplication, { foreignKey: "reservationPaymentId", as: "application" });
ReservationPaymentApplication.belongsTo(ReservationPayment, { foreignKey: "reservationPaymentId", as: "reservationPayment" });
Invoice.hasOne(Reservation, { foreignKey: "finalInvoiceId", as: "completedReservation" });
Reservation.belongsTo(Invoice, { foreignKey: "finalInvoiceId", as: "finalInvoice" });
ReservationRefund.hasMany(ReservationRefundAllocation, { foreignKey: "reservationRefundId", as: "allocations" });
ReservationRefundAllocation.belongsTo(ReservationRefund, { foreignKey: "reservationRefundId", as: "refund" });
ReservationPayment.hasMany(ReservationRefundAllocation, { foreignKey: "reservationPaymentId", as: "refundAllocations" });
ReservationRefundAllocation.belongsTo(ReservationPayment, { foreignKey: "reservationPaymentId", as: "reservationPayment" });
ReservationRefund.belongsTo(JournalEntry, { foreignKey: "journalEntryId", as: "journalEntry" });
JournalEntry.hasOne(ReservationRefund, { foreignKey: "journalEntryId", as: "reservationRefund" });

// Phase 32.6-Fix C — amendments, expiry extensions, renewals, payment transfers.
Company.hasMany(ReservationAmendment, { foreignKey: "companyId", as: "reservationAmendments" });
ReservationAmendment.belongsTo(Company, { foreignKey: "companyId", as: "company" });
Reservation.hasMany(ReservationAmendment, { foreignKey: "reservationId", as: "amendments" });
ReservationAmendment.belongsTo(Reservation, { foreignKey: "reservationId", as: "reservation" });
ReservationAmendment.hasMany(ReservationAmendmentItem, { foreignKey: "amendmentId", as: "items" });
ReservationAmendmentItem.belongsTo(ReservationAmendment, { foreignKey: "amendmentId", as: "amendment" });
Reservation.hasMany(ReservationAmendmentItem, { foreignKey: "reservationId", as: "amendmentItems" });
ReservationAmendmentItem.belongsTo(Reservation, { foreignKey: "reservationId", as: "reservation" });

Company.hasMany(ReservationExpiryExtension, { foreignKey: "companyId", as: "reservationExpiryExtensions" });
ReservationExpiryExtension.belongsTo(Company, { foreignKey: "companyId", as: "company" });
Reservation.hasMany(ReservationExpiryExtension, { foreignKey: "reservationId", as: "expiryExtensions" });
ReservationExpiryExtension.belongsTo(Reservation, { foreignKey: "reservationId", as: "reservation" });

Company.hasMany(ReservationRenewal, { foreignKey: "companyId", as: "reservationRenewals" });
ReservationRenewal.belongsTo(Company, { foreignKey: "companyId", as: "company" });
Reservation.hasMany(ReservationRenewal, { foreignKey: "sourceReservationId", as: "renewalsAsSource" });
ReservationRenewal.belongsTo(Reservation, { foreignKey: "sourceReservationId", as: "sourceReservation" });
ReservationRenewal.belongsTo(Reservation, { foreignKey: "successorReservationId", as: "successorReservation" });

Company.hasMany(ReservationPaymentTransfer, { foreignKey: "companyId", as: "reservationPaymentTransfers" });
ReservationPaymentTransfer.belongsTo(Company, { foreignKey: "companyId", as: "company" });
ReservationRenewal.hasMany(ReservationPaymentTransfer, { foreignKey: "renewalId", as: "transfers" });
ReservationPaymentTransfer.belongsTo(ReservationRenewal, { foreignKey: "renewalId", as: "renewal" });
ReservationPayment.hasMany(ReservationPaymentTransfer, { foreignKey: "sourcePaymentId", as: "transfersOut" });
ReservationPaymentTransfer.belongsTo(ReservationPayment, { foreignKey: "sourcePaymentId", as: "sourcePayment" });

Customer.hasMany(CustomerGoldPool, { foreignKey: "customerId", as: "customerGoldPools" });
CustomerGoldPool.belongsTo(Customer, { foreignKey: "customerId", as: "customer" });

// Phase 33B — additive, non-posting Gold Purchase draft aggregates.
Company.hasMany(CustomerGoldPurchaseDocument, { foreignKey: "companyId", as: "customerGoldPurchaseDocuments" });
CustomerGoldPurchaseDocument.belongsTo(Company, { foreignKey: "companyId", as: "company" });
Branch.hasMany(CustomerGoldPurchaseDocument, { foreignKey: "branchId", as: "customerGoldPurchaseDocuments" });
CustomerGoldPurchaseDocument.belongsTo(Branch, { foreignKey: "branchId", as: "branch" });
Customer.hasMany(CustomerGoldPurchaseDocument, { foreignKey: "customerId", as: "goldPurchaseDocuments" });
CustomerGoldPurchaseDocument.belongsTo(Customer, { foreignKey: "customerId", as: "customer" });
CustomerGoldPurchaseDocument.hasMany(CustomerGoldPurchaseItem, { foreignKey: "documentId", as: "items" });
CustomerGoldPurchaseItem.belongsTo(CustomerGoldPurchaseDocument, { foreignKey: "documentId", as: "document" });

Company.hasMany(InvestmentGoldPurchaseDocument, { foreignKey: "companyId", as: "investmentGoldPurchaseDocuments" });
InvestmentGoldPurchaseDocument.belongsTo(Company, { foreignKey: "companyId", as: "company" });
Branch.hasMany(InvestmentGoldPurchaseDocument, { foreignKey: "branchId", as: "investmentGoldPurchaseDocuments" });
InvestmentGoldPurchaseDocument.belongsTo(Branch, { foreignKey: "branchId", as: "branch" });
Supplier.hasMany(InvestmentGoldPurchaseDocument, { foreignKey: "supplierId", as: "investmentGoldPurchaseDocuments" });
InvestmentGoldPurchaseDocument.belongsTo(Supplier, { foreignKey: "supplierId", as: "supplier" });
InvestmentGoldPurchaseDocument.hasMany(InvestmentGoldPurchaseItem, { foreignKey: "documentId", as: "items" });
InvestmentGoldPurchaseItem.belongsTo(InvestmentGoldPurchaseDocument, { foreignKey: "documentId", as: "document" });

Company.hasMany(GoldPurchaseApprovalRequest, { foreignKey: "companyId", as: "goldPurchaseApprovalRequests" });
GoldPurchaseApprovalRequest.belongsTo(Company, { foreignKey: "companyId", as: "company" });
Branch.hasMany(GoldPurchaseApprovalRequest, { foreignKey: "branchId", as: "goldPurchaseApprovalRequests" });
GoldPurchaseApprovalRequest.belongsTo(Branch, { foreignKey: "branchId", as: "branch" });
User.hasMany(GoldPurchaseApprovalRequest, { foreignKey: "requestedBy", as: "requestedGoldPurchaseApprovals" });
GoldPurchaseApprovalRequest.belongsTo(User, { foreignKey: "requestedBy", as: "requester" });
User.hasMany(GoldPurchaseApprovalRequest, { foreignKey: "reviewedBy", as: "reviewedGoldPurchaseApprovals" });
GoldPurchaseApprovalRequest.belongsTo(User, { foreignKey: "reviewedBy", as: "reviewer" });

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
  ReservationItem,
  ReservationPayment,
  ReservationPaymentApplication,
  ReservationRefund,
  ReservationRefundAllocation,
  ReservationAmendment,
  ReservationAmendmentItem,
  ReservationExpiryExtension,
  ReservationRenewal,
  ReservationPaymentTransfer,
  Transfer,
  ManufacturingOrder,
  CustomerGoldPool,
  InventoryGoldPool,
  CustomerGoldPurchaseDocument,
  CustomerGoldPurchaseItem,
  InvestmentGoldPurchaseDocument,
  InvestmentGoldPurchaseItem,
  GoldPurchaseApprovalRequest,
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
  CustomerCreditTransaction,
  BarcodeInventoryCode,
  BarcodeItemCode,
  BarcodeSequence
};
