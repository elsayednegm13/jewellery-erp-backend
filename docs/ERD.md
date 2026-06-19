# DARFUS Jewellery ERP — Entity Relationship Diagram (ERD)

This document maps out the database schema, field constraints, precision policies, and indexes for the DARFUS PostgreSQL database.

---

## 1. Relational Diagram (Mermaid)

```mermaid
erDiagram
  COMPANIES ||--o{ USERS : "has users"
  COMPANIES ||--o{ EMPLOYEES : "has employees"
  COMPANIES ||--o{ CUSTOMERS : "has customers"
  COMPANIES ||--o{ SUPPLIERS : "has suppliers"
  COMPANIES ||--o{ ASSETS : "has assets"
  COMPANIES ||--o{ INVOICES : "has sales/returns"
  COMPANIES ||--o{ PURCHASE_ORDERS : "has purchases"
  COMPANIES ||--o{ JOURNAL_ENTRIES : "has journal vouchers"

  EMPLOYEES ||--o{ EMPLOYEE_SESSIONS : "opens sessions"
  
  ASSETS ||--o{ ASSET_EVENTS : "logs timeline"
  ASSETS ||--o{ ASSET_CERTIFICATES : "possesses"
  ASSETS ||--o{ ASSET_ATTACHMENTS : "possesses files"

  SUPPLIERS ||--o{ SUPPLIER_DOCUMENTS : "holds"
  SUPPLIERS ||--o{ SUPPLIER_CONSIGNMENTS : "supplies"
  SUPPLIERS ||--o{ PURCHASE_ORDERS : "receives"
  
  PURCHASE_ORDERS ||--o{ PURCHASE_ORDER_ITEMS : "contains"
  
  CUSTOMERS ||--o{ INVOICES : "buys from"
  CUSTOMERS ||--o{ CUSTOMER_GOLD_POOLS : "deposits gold to"
  
  INVOICES ||--o{ INVOICE_ITEMS : "contains"
  
  JOURNAL_ENTRIES ||--o{ JOURNAL_LINES : "contains"
  ACCOUNTS ||--o{ JOURNAL_LINES : "records debit/credit on"
```

---

## 2. Table Specifications and Precisions

### 2.1. Decimal Precision Policy
As per strict enterprise requirements, all monetary values (prices, costs, tax, invoice totals, customer dues, supplier balances) and weight measurements (gold weights, gross weights, net weights, carat weights) are stored using:
- **`DECIMAL(20,8)`**

This eliminates any IEEE-754 floating point inaccuracies and guarantees exact precision during financial reporting and workshop melting calculations.

### 2.2. Indexing Strategy
To ensure query latency remains sub-millisecond as tables grow:
- **Tenancy Indexes**: Composite index on `(company_id)` is applied to all scoped tables.
- **Search Optimization**: B-Tree indexes are applied to search identifiers like `barcode`, `rfid`, `phone`, and `email`.
- **Foreign Keys**: Indexes are created on all referencing keys (e.g., `asset_id`, `invoice_id`, `employee_id`) to accelerate join queries.
