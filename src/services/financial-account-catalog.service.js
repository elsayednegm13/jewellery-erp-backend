"use strict";

const BOOTSTRAP_VERSION = 2;

const accountRole = (code, name, nameAr, type, nature, statementClassification) =>
  Object.freeze({
    code,
    name,
    nameAr,
    type,
    nature,
    statementClassification,
    isPosting: true,
    bootstrapVersion: BOOTSTRAP_VERSION,
  });

/**
 * Stable semantic roles. Posting code resolves these roles; translated names
 * and incidental account ordering are never financial authority.
 */
const ACCOUNT_ROLE_CATALOG = Object.freeze({
  CASH_TREASURY: accountRole("SYS-CASH", "Cash Treasury", "الخزينة النقدية", "asset", "debit", "asset"),
  BANK_ACCOUNT: accountRole("SYS-BANK", "Bank Account", "الحساب البنكي", "asset", "debit", "asset"),
  ACCOUNTS_RECEIVABLE: accountRole("SYS-AR", "Accounts Receivable", "الذمم المدينة", "asset", "debit", "asset"),
  SUPPLIER_PAYABLE: accountRole("SYS-AP", "Accounts Payable", "ذمم الموردين", "liability", "credit", "liability"),
  INVENTORY_ASSET: accountRole("SYS-INVENTORY", "Inventory Asset", "أصل المخزون", "asset", "debit", "asset"),
  COST_OF_GOODS_SOLD: accountRole("SYS-COGS", "Cost of Goods Sold", "تكلفة البضاعة المباعة", "expense", "debit", "cost_of_goods_sold"),
  SALES_REVENUE: accountRole("SYS-SALES", "Sales Revenue", "إيرادات المبيعات", "revenue", "credit", "revenue"),
  CUSTOMER_DEPOSIT_LIABILITY: accountRole("SYS-CUSTOMER-DEPOSIT", "Customer Deposit Liability", "التزامات دفعات العملاء", "liability", "credit", "liability"),
  VAT_PAYABLE: accountRole("SYS-VAT", "VAT Payable", "ضريبة القيمة المضافة المستحقة", "liability", "credit", "liability"),
  OPENING_BALANCE_EQUITY: accountRole("SYS-OPENING-EQUITY", "Opening Balance Equity", "حقوق ملكية الأرصدة الافتتاحية", "equity", "credit", "equity"),
  OPERATING_EXPENSE: accountRole("SYS-OPERATING-EXPENSE", "Operating Expense", "المصروفات التشغيلية", "expense", "debit", "operating_expense"),
  OTHER_INCOME: accountRole("SYS-OTHER-INCOME", "Other Income", "إيرادات أخرى", "revenue", "credit", "other_income"),
});

const branchMapping = (accountRoleCode) =>
  Object.freeze({ accountRoleCode, required: true, bootstrapVersion: BOOTSTRAP_VERSION });

const BRANCH_MAPPING_CATALOG = Object.freeze({
  CASH_TREASURY: branchMapping("CASH_TREASURY"),
  BANK_ACCOUNT: branchMapping("BANK_ACCOUNT"),
  ACCOUNTS_RECEIVABLE: branchMapping("ACCOUNTS_RECEIVABLE"),
  SUPPLIER_PAYABLE: branchMapping("SUPPLIER_PAYABLE"),
  INVENTORY_ASSET: branchMapping("INVENTORY_ASSET"),
  COST_OF_GOODS_SOLD: branchMapping("COST_OF_GOODS_SOLD"),
  SALES_REVENUE: branchMapping("SALES_REVENUE"),
  RESERVATION_ADVANCE_LIABILITY: branchMapping("CUSTOMER_DEPOSIT_LIABILITY"),
  DEFAULT_EXPENSE: branchMapping("OPERATING_EXPENSE"),
  OTHER_INCOME: branchMapping("OTHER_INCOME"),
  VAT_PAYABLE: branchMapping("VAT_PAYABLE"),
});

const POSTING_CODE_ROLE = Object.freeze({
  "1110": "CASH_TREASURY",
  "1120": "BANK_ACCOUNT",
  "1300": "ACCOUNTS_RECEIVABLE",
  "2100": "SUPPLIER_PAYABLE",
  "1200": "INVENTORY_ASSET",
  "5000": "COST_OF_GOODS_SOLD",
  "4100": "SALES_REVENUE",
  "2300": "CUSTOMER_DEPOSIT_LIABILITY",
  "2200": "VAT_PAYABLE",
  "3000": "OPENING_BALANCE_EQUITY",
  "6000": "OPERATING_EXPENSE",
  "4900": "OTHER_INCOME",
});

const POSTING_ACCOUNT_CATALOG = Object.freeze({
  "1000": { name: "Assets", nameAr: "الأصول", type: "asset", nature: "debit", level: 1, parent: null, isPosting: false, statementClassification: "asset" },
  "1100": { name: "Cash & Bank", nameAr: "النقد والبنوك", type: "asset", nature: "debit", level: 2, parent: "1000", isPosting: false, statementClassification: "asset" },
  "1210": { name: "Inventory Gold 18K", nameAr: "مخزون ذهب 18", type: "asset", nature: "debit", level: 3, parent: "1000", isPosting: true, statementClassification: "asset" },
  "1211": { name: "Inventory Gold 21K", nameAr: "مخزون ذهب 21", type: "asset", nature: "debit", level: 3, parent: "1000", isPosting: true, statementClassification: "asset" },
  "1212": { name: "Inventory Gold 22K", nameAr: "مخزون ذهب 22", type: "asset", nature: "debit", level: 3, parent: "1000", isPosting: true, statementClassification: "asset" },
  "1213": { name: "Inventory Gold 24K", nameAr: "مخزون ذهب 24", type: "asset", nature: "debit", level: 3, parent: "1000", isPosting: true, statementClassification: "asset" },
  "1219": { name: "Inventory Other / Non-Gold", nameAr: "مخزون أخرى / غير ذهب", type: "asset", nature: "debit", level: 3, parent: "1000", isPosting: true, statementClassification: "asset" },
  "1400": { name: "Input VAT Recoverable", nameAr: "ضريبة مدخلات قابلة للخصم", type: "asset", nature: "debit", level: 2, parent: "1000", isPosting: true, statementClassification: "asset" },
  "2000": { name: "Liabilities", nameAr: "الخصوم", type: "liability", nature: "credit", level: 1, parent: null, isPosting: false, statementClassification: "liability" },
  "2210": { name: "RCM Output VAT", nameAr: "ضريبة احتساب عكسي مستحقة", type: "liability", nature: "credit", level: 2, parent: "2000", isPosting: true, statementClassification: "liability" },
  "2400": { name: "Gift Voucher Liability", nameAr: "التزام قسائم الهدايا", type: "liability", nature: "credit", level: 2, parent: "2000", isPosting: true, statementClassification: "liability" },
  "4000": { name: "Revenue", nameAr: "الإيرادات", type: "revenue", nature: "credit", level: 1, parent: null, isPosting: false, statementClassification: "revenue" },
  "4110": { name: "Sales Revenue Gold 18K", nameAr: "إيراد مبيعات ذهب 18", type: "revenue", nature: "credit", level: 2, parent: "4000", isPosting: true, statementClassification: "revenue" },
  "4111": { name: "Sales Revenue Gold 21K", nameAr: "إيراد مبيعات ذهب 21", type: "revenue", nature: "credit", level: 2, parent: "4000", isPosting: true, statementClassification: "revenue" },
  "4112": { name: "Sales Revenue Gold 22K", nameAr: "إيراد مبيعات ذهب 22", type: "revenue", nature: "credit", level: 2, parent: "4000", isPosting: true, statementClassification: "revenue" },
  "4113": { name: "Sales Revenue Gold 24K", nameAr: "إيراد مبيعات ذهب 24", type: "revenue", nature: "credit", level: 2, parent: "4000", isPosting: true, statementClassification: "revenue" },
  "4119": { name: "Sales Revenue Other / Non-Gold", nameAr: "إيراد مبيعات أخرى / غير ذهب", type: "revenue", nature: "credit", level: 2, parent: "4000", isPosting: true, statementClassification: "revenue" },
  "4200": { name: "Gold Profit", nameAr: "أرباح الذهب", type: "revenue", nature: "credit", level: 2, parent: "4000", isPosting: true, statementClassification: "other_income" },
  "5010": { name: "COGS Gold 18K", nameAr: "تكلفة مبيعات ذهب 18", type: "expense", nature: "debit", level: 2, parent: null, isPosting: true, statementClassification: "cost_of_goods_sold" },
  "5011": { name: "COGS Gold 21K", nameAr: "تكلفة مبيعات ذهب 21", type: "expense", nature: "debit", level: 2, parent: null, isPosting: true, statementClassification: "cost_of_goods_sold" },
  "5012": { name: "COGS Gold 22K", nameAr: "تكلفة مبيعات ذهب 22", type: "expense", nature: "debit", level: 2, parent: null, isPosting: true, statementClassification: "cost_of_goods_sold" },
  "5013": { name: "COGS Gold 24K", nameAr: "تكلفة مبيعات ذهب 24", type: "expense", nature: "debit", level: 2, parent: null, isPosting: true, statementClassification: "cost_of_goods_sold" },
  "5019": { name: "COGS Other / Non-Gold", nameAr: "تكلفة مبيعات أخرى / غير ذهب", type: "expense", nature: "debit", level: 2, parent: null, isPosting: true, statementClassification: "cost_of_goods_sold" },
  "6100": { name: "Salaries & Wages", nameAr: "الرواتب والأجور", type: "expense", nature: "debit", level: 2, parent: null, isPosting: true, statementClassification: "operating_expense" },
});

module.exports = {
  BOOTSTRAP_VERSION,
  ACCOUNT_ROLE_CATALOG,
  BRANCH_MAPPING_CATALOG,
  POSTING_CODE_ROLE,
  POSTING_ACCOUNT_CATALOG,
};
