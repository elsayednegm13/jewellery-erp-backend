const { DataTypes } = require("sequelize");

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // 1. Companies (Tenants)
    await queryInterface.createTable("companies", {
      id: { type: DataTypes.STRING, primaryKey: true },
      business_name: { type: DataTypes.STRING, allowNull: false },
      workspace: { type: DataTypes.STRING, allowNull: false, unique: true },
      company_size: { type: DataTypes.STRING },
      country: { type: DataTypes.STRING },
      currency: { type: DataTypes.STRING, defaultValue: "AED" },
      city: { type: DataTypes.STRING },
      region: { type: DataTypes.STRING },
      address_1: { type: DataTypes.STRING },
      address_2: { type: DataTypes.STRING },
      postal_code: { type: DataTypes.STRING },
      commercial_register: { type: DataTypes.STRING },
      tax_number: { type: DataTypes.STRING },
      logo: { type: DataTypes.STRING },
      branch_name: { type: DataTypes.STRING, defaultValue: "Main Branch" },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    });

    // 2. Users (Auth Credentials)
    await queryInterface.createTable("users", {
      id: { type: DataTypes.STRING, primaryKey: true },
      company_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      first_name: { type: DataTypes.STRING, allowNull: false },
      last_name: { type: DataTypes.STRING, allowNull: false },
      email: { type: DataTypes.STRING, allowNull: false, unique: true },
      phone: { type: DataTypes.STRING },
      password: { type: DataTypes.STRING, allowNull: false },
      job_title: { type: DataTypes.STRING },
      role: {
        type: DataTypes.ENUM("admin", "owner", "manager", "accountant", "sales"),
        allowNull: false,
        defaultValue: "sales"
      },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
      deleted_at: { type: DataTypes.DATE } // Soft delete support
    });

    // 3. Employees
    await queryInterface.createTable("employees", {
      id: { type: DataTypes.STRING, primaryKey: true },
      company_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      name: { type: DataTypes.STRING, allowNull: false },
      role: { type: DataTypes.STRING, allowNull: false },
      system_role: {
        type: DataTypes.ENUM("admin", "owner", "manager", "accountant", "sales"),
        defaultValue: "sales"
      },
      branch: { type: DataTypes.STRING, allowNull: false },
      status: {
        type: DataTypes.ENUM("present", "leave", "inactive"),
        defaultValue: "present"
      },
      email: { type: DataTypes.STRING },
      phone: { type: DataTypes.STRING },
      join_date: { type: DataTypes.STRING },
      job_title: { type: DataTypes.STRING },
      approval_limit: { type: DataTypes.DECIMAL(20, 8), defaultValue: 0 },
      assigned_device: { type: DataTypes.STRING },
      notes: { type: DataTypes.TEXT },
      approval_limits_detail: { type: DataTypes.JSONB },
      deactivate_reason: { type: DataTypes.STRING },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
      deleted_at: { type: DataTypes.DATE }
    });

    // 4. Employee Sessions
    await queryInterface.createTable("employee_sessions", {
      id: { type: DataTypes.STRING, primaryKey: true },
      employee_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "employees", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      device_name: { type: DataTypes.STRING },
      browser: { type: DataTypes.STRING },
      location: { type: DataTypes.STRING },
      last_active: { type: DataTypes.STRING },
      is_current: { type: DataTypes.BOOLEAN, defaultValue: false },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    });

    // 5. Assets (Jewelry Items)
    await queryInterface.createTable("assets", {
      id: { type: DataTypes.STRING, primaryKey: true },
      company_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      name: { type: DataTypes.STRING, allowNull: false },
      type: {
        type: DataTypes.ENUM("gold-piece", "gold-weight", "diamond", "gemstone", "pearl", "watch"),
        allowNull: false
      },
      category: { type: DataTypes.STRING, allowNull: false },
      karat: { type: DataTypes.INTEGER },
      purity: { type: DataTypes.DECIMAL(10, 8) },
      gross_weight: { type: DataTypes.DECIMAL(20, 8), allowNull: false },
      net_weight: { type: DataTypes.DECIMAL(20, 8), allowNull: false },
      gold_weight: { type: DataTypes.DECIMAL(20, 8) },
      price: { type: DataTypes.DECIMAL(20, 8), allowNull: false },
      cost: { type: DataTypes.DECIMAL(20, 8), allowNull: false },
      branch: { type: DataTypes.STRING, allowNull: false },
      location: { type: DataTypes.STRING, allowNull: false },
      status: {
        type: DataTypes.ENUM("available", "reserved", "sold", "repair", "transferred", "melted", "archived"),
        defaultValue: "available"
      },
      barcode: { type: DataTypes.STRING, allowNull: false },
      rfid: { type: DataTypes.STRING },
      source: { type: DataTypes.STRING },
      parent_asset_id: { type: DataTypes.STRING },
      child_asset_ids: { type: DataTypes.JSONB, defaultValue: [] },
      stones: { type: DataTypes.INTEGER, defaultValue: 0 },
      stone_details: { type: DataTypes.JSONB, defaultValue: [] },
      pearls: { type: DataTypes.INTEGER, defaultValue: 0 },
      pearl_details: { type: DataTypes.JSONB, defaultValue: [] },
      notes: { type: DataTypes.TEXT },
      manufacturing_order_id: { type: DataTypes.STRING },
      contribution_weight: { type: DataTypes.DECIMAL(20, 8) },
      process_loss: { type: DataTypes.DECIMAL(20, 8) },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
      deleted_at: { type: DataTypes.DATE }
    });

    // 6. Asset Events
    await queryInterface.createTable("asset_events", {
      id: { type: DataTypes.STRING, primaryKey: true },
      asset_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "assets", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      action: { type: DataTypes.STRING, allowNull: false },
      date: { type: DataTypes.STRING, allowNull: false },
      user: { type: DataTypes.STRING, allowNull: false },
      branch: { type: DataTypes.STRING, allowNull: false },
      note: { type: DataTypes.TEXT },
      device: { type: DataTypes.STRING },
      reason: { type: DataTypes.STRING },
      source_document: { type: DataTypes.STRING },
      before_state: { type: DataTypes.STRING },
      after_state: { type: DataTypes.STRING },
      correlation_id: { type: DataTypes.STRING },
      severity: { type: DataTypes.ENUM("info", "warning", "critical"), defaultValue: "info" },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    });

    // 7. Asset Certificates
    await queryInterface.createTable("asset_certificates", {
      id: { type: DataTypes.STRING, primaryKey: true },
      asset_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "assets", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      type: { type: DataTypes.STRING, allowNull: false },
      issuer: { type: DataTypes.STRING, allowNull: false },
      issue_date: { type: DataTypes.STRING, allowNull: false },
      expiry_date: { type: DataTypes.STRING },
      certificate_number: { type: DataTypes.STRING, allowNull: false },
      url: { type: DataTypes.STRING },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    });

    // 8. Asset Attachments
    await queryInterface.createTable("asset_attachments", {
      id: { type: DataTypes.STRING, primaryKey: true },
      asset_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "assets", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      name: { type: DataTypes.STRING, allowNull: false },
      type: { type: DataTypes.STRING, allowNull: false },
      url: { type: DataTypes.STRING },
      uploaded_at: { type: DataTypes.STRING, allowNull: false },
      uploaded_by: { type: DataTypes.STRING, allowNull: false },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    });

    // 9. Customers
    await queryInterface.createTable("customers", {
      id: { type: DataTypes.STRING, primaryKey: true },
      company_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      name: { type: DataTypes.STRING, allowNull: false },
      phone: { type: DataTypes.STRING, allowNull: false },
      email: { type: DataTypes.STRING },
      tier: { type: DataTypes.ENUM("VIP", "Gold", "Standard"), defaultValue: "Standard" },
      balance: { type: DataTypes.DECIMAL(20, 8), allowNull: false, defaultValue: 0 },
      purchases: { type: DataTypes.DECIMAL(20, 8), allowNull: false, defaultValue: 0 },
      last_visit: { type: DataTypes.STRING },
      status: { type: DataTypes.ENUM("active", "inactive"), defaultValue: "active" },
      nationality: { type: DataTypes.STRING },
      id_type: { type: DataTypes.STRING },
      id_number: { type: DataTypes.STRING },
      id_expiry: { type: DataTypes.STRING },
      kyc_status: { type: DataTypes.ENUM("verified", "pending", "flagged", "not-started"), defaultValue: "not-started" },
      aml_status: { type: DataTypes.ENUM("clear", "review", "flagged"), defaultValue: "clear" },
      credit_limit: { type: DataTypes.DECIMAL(20, 8), defaultValue: 0 },
      loyalty_points: { type: DataTypes.INTEGER, defaultValue: 0 },
      addresses: { type: DataTypes.JSONB, defaultValue: [] },
      notes: { type: DataTypes.TEXT },
      kyc_details: { type: DataTypes.JSONB },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
      deleted_at: { type: DataTypes.DATE }
    });

    // 10. Suppliers
    await queryInterface.createTable("suppliers", {
      id: { type: DataTypes.STRING, primaryKey: true },
      company_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      name: { type: DataTypes.STRING, allowNull: false },
      category: { type: DataTypes.STRING, allowNull: false },
      phone: { type: DataTypes.STRING, allowNull: false },
      email: { type: DataTypes.STRING },
      due: { type: DataTypes.DECIMAL(20, 8), allowNull: false, defaultValue: 0 },
      last_order: { type: DataTypes.STRING },
      rating: { type: DataTypes.DECIMAL(5, 2), defaultValue: 5.0 },
      status: { type: DataTypes.ENUM("active", "inactive"), defaultValue: "active" },
      address: { type: DataTypes.TEXT },
      country: { type: DataTypes.STRING },
      tax_number: { type: DataTypes.STRING },
      commercial_register: { type: DataTypes.STRING },
      payment_terms: { type: DataTypes.STRING },
      notes: { type: DataTypes.TEXT },
      is_consignment: { type: DataTypes.BOOLEAN, defaultValue: false },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
      deleted_at: { type: DataTypes.DATE }
    });

    // 11. Supplier Documents
    await queryInterface.createTable("supplier_documents", {
      id: { type: DataTypes.STRING, primaryKey: true },
      supplier_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "suppliers", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      name: { type: DataTypes.STRING, allowNull: false },
      type: { type: DataTypes.STRING, allowNull: false },
      expiry_date: { type: DataTypes.STRING, allowNull: false },
      url: { type: DataTypes.STRING },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    });

    // 12. Supplier Consignments
    await queryInterface.createTable("supplier_consignments", {
      id: { type: DataTypes.STRING, primaryKey: true },
      supplier_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "suppliers", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      asset_id: { type: DataTypes.STRING, allowNull: false },
      asset_name: { type: DataTypes.STRING, allowNull: false },
      weight: { type: DataTypes.DECIMAL(20, 8), allowNull: false },
      agreed_price: { type: DataTypes.DECIMAL(20, 8), allowNull: false },
      received_date: { type: DataTypes.STRING, allowNull: false },
      status: { type: DataTypes.ENUM("available", "sold", "returned"), defaultValue: "available" },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    });

    // 13. Purchase Orders
    await queryInterface.createTable("purchase_orders", {
      id: { type: DataTypes.STRING, primaryKey: true },
      company_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      supplier_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "suppliers", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      supplier_name: { type: DataTypes.STRING, allowNull: false },
      status: { type: DataTypes.ENUM("draft", "sent", "partial", "received", "cancelled"), defaultValue: "draft" },
      date: { type: DataTypes.STRING, allowNull: false },
      expected_date: { type: DataTypes.STRING },
      received_date: { type: DataTypes.STRING },
      total: { type: DataTypes.DECIMAL(20, 8), allowNull: false, defaultValue: 0 },
      branch: { type: DataTypes.STRING, allowNull: false },
      notes: { type: DataTypes.TEXT },
      is_consignment: { type: DataTypes.BOOLEAN, defaultValue: false },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
      deleted_at: { type: DataTypes.DATE }
    });

    // 14. Purchase Order Items
    await queryInterface.createTable("purchase_order_items", {
      id: { type: DataTypes.STRING, primaryKey: true },
      purchase_order_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "purchase_orders", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      description: { type: DataTypes.STRING, allowNull: false },
      quantity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      unit: { type: DataTypes.STRING, defaultValue: "قطعة" },
      unit_price: { type: DataTypes.DECIMAL(20, 8), allowNull: false },
      total: { type: DataTypes.DECIMAL(20, 8), allowNull: false },
      received_quantity: { type: DataTypes.INTEGER, defaultValue: 0 },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    });

    // 15. Invoices
    await queryInterface.createTable("invoices", {
      id: { type: DataTypes.STRING, primaryKey: true },
      company_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      type: { type: DataTypes.ENUM("sale", "return", "exchange", "deposit", "repair"), defaultValue: "sale" },
      customer_id: { type: DataTypes.STRING, allowNull: false },
      customer_name: { type: DataTypes.STRING, allowNull: false },
      date: { type: DataTypes.STRING, allowNull: false },
      total: { type: DataTypes.DECIMAL(20, 8), allowNull: false, defaultValue: 0 },
      tax: { type: DataTypes.DECIMAL(20, 8), allowNull: false, defaultValue: 0 },
      subtotal: { type: DataTypes.DECIMAL(20, 8) },
      discount: { type: DataTypes.DECIMAL(20, 8), defaultValue: 0 },
      making_charge: { type: DataTypes.DECIMAL(20, 8), defaultValue: 0 },
      stone_value: { type: DataTypes.DECIMAL(20, 8), defaultValue: 0 },
      deposit: { type: DataTypes.DECIMAL(20, 8), defaultValue: 0 },
      status: { type: DataTypes.ENUM("paid", "partial", "due", "returned", "cancelled"), defaultValue: "due" },
      payment_method: { type: DataTypes.STRING, allowNull: false },
      payment_splits: { type: DataTypes.JSONB, defaultValue: [] },
      branch: { type: DataTypes.STRING, allowNull: false },
      notes: { type: DataTypes.TEXT },
      related_invoice_id: { type: DataTypes.STRING },
      idempotency_key: { type: DataTypes.STRING },
      posted_at: { type: DataTypes.STRING },
      cancelled_at: { type: DataTypes.STRING },
      cancel_reason: { type: DataTypes.STRING },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
      deleted_at: { type: DataTypes.DATE }
    });

    // 16. Invoice Items
    await queryInterface.createTable("invoice_items", {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      invoice_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "invoices", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      asset_id: { type: DataTypes.STRING, allowNull: false },
      name: { type: DataTypes.STRING, allowNull: false },
      quantity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      price: { type: DataTypes.DECIMAL(20, 8), allowNull: false },
      cost: { type: DataTypes.DECIMAL(20, 8) },
      weight: { type: DataTypes.DECIMAL(20, 8) },
      karat: { type: DataTypes.INTEGER },
      discount: { type: DataTypes.DECIMAL(20, 8), defaultValue: 0 },
      making_charge: { type: DataTypes.DECIMAL(20, 8), defaultValue: 0 },
      stone_value: { type: DataTypes.DECIMAL(20, 8), defaultValue: 0 },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    });

    // 17. Reservations
    await queryInterface.createTable("reservations", {
      id: { type: DataTypes.STRING, primaryKey: true },
      company_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      asset_id: { type: DataTypes.STRING, allowNull: false },
      asset_name: { type: DataTypes.STRING, allowNull: false },
      customer_id: { type: DataTypes.STRING, allowNull: false },
      customer_name: { type: DataTypes.STRING, allowNull: false },
      branch: { type: DataTypes.STRING, allowNull: false },
      deposit: { type: DataTypes.DECIMAL(20, 8), allowNull: false, defaultValue: 0 },
      expires_at: { type: DataTypes.STRING, allowNull: false },
      status: { type: DataTypes.ENUM("active", "expired", "completed", "cancelled"), defaultValue: "active" },
      notes: { type: DataTypes.TEXT },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    });

    // 18. Transfers
    await queryInterface.createTable("transfers", {
      id: { type: DataTypes.STRING, primaryKey: true },
      company_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      asset_ids: { type: DataTypes.JSONB, allowNull: false },
      from_branch: { type: DataTypes.STRING, allowNull: false },
      to_branch: { type: DataTypes.STRING, allowNull: false },
      requested_by: { type: DataTypes.STRING, allowNull: false },
      requested_at: { type: DataTypes.STRING, allowNull: false },
      approved_by: { type: DataTypes.STRING },
      approved_at: { type: DataTypes.STRING },
      received_by: { type: DataTypes.STRING },
      received_at: { type: DataTypes.STRING },
      status: { type: DataTypes.ENUM("pending", "approved", "in-transit", "received", "cancelled"), defaultValue: "pending" },
      notes: { type: DataTypes.TEXT },
      cancel_reason: { type: DataTypes.STRING },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    });

    // 19. Manufacturing Orders
    await queryInterface.createTable("manufacturing_orders", {
      id: { type: DataTypes.STRING, primaryKey: true },
      company_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      status: { type: DataTypes.ENUM("draft", "approved", "in-process", "completed", "cancelled"), defaultValue: "draft" },
      type: { type: DataTypes.ENUM("melting", "manufacturing", "conversion"), allowNull: false },
      input_assets: { type: DataTypes.JSONB, defaultValue: [] },
      output_assets: { type: DataTypes.JSONB, defaultValue: [] },
      expected_output_weight: { type: DataTypes.DECIMAL(20, 8), allowNull: false },
      actual_output_weight: { type: DataTypes.DECIMAL(20, 8) },
      process_loss: { type: DataTypes.DECIMAL(20, 8), defaultValue: 0 },
      wastage: { type: DataTypes.DECIMAL(20, 8), defaultValue: 0 },
      branch: { type: DataTypes.STRING, allowNull: false },
      notes: { type: DataTypes.TEXT },
      started_at: { type: DataTypes.STRING },
      completed_at: { type: DataTypes.STRING },
      created_by: { type: DataTypes.STRING, allowNull: false },
      approved_by: { type: DataTypes.STRING },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    });

    // 20. Customer Gold Pools
    await queryInterface.createTable("customer_gold_pools", {
      id: { type: DataTypes.STRING, primaryKey: true },
      company_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      customer_id: { type: DataTypes.STRING, allowNull: false },
      customer_name: { type: DataTypes.STRING, allowNull: false },
      status: { type: DataTypes.ENUM("pending-assay", "assayed", "approved", "transferred", "rejected"), defaultValue: "pending-assay" },
      gross_weight: { type: DataTypes.DECIMAL(20, 8), allowNull: false },
      purity: { type: DataTypes.DECIMAL(10, 8), allowNull: false },
      fine_weight: { type: DataTypes.DECIMAL(20, 8), allowNull: false },
      assay_result: { type: DataTypes.DECIMAL(10, 8) },
      assay_date: { type: DataTypes.STRING },
      assayed_by: { type: DataTypes.STRING },
      received_at: { type: DataTypes.STRING, allowNull: false },
      approved_at: { type: DataTypes.STRING },
      approved_by: { type: DataTypes.STRING },
      notes: { type: DataTypes.TEXT },
      transferred_to_igp: { type: DataTypes.BOOLEAN, defaultValue: false },
      igp_id: { type: DataTypes.STRING },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    });

    // 21. Inventory Gold Pools
    await queryInterface.createTable("inventory_gold_pools", {
      id: { type: DataTypes.STRING, primaryKey: true },
      company_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      source: { type: DataTypes.STRING, allowNull: false },
      cgp_id: { type: DataTypes.STRING },
      gross_weight: { type: DataTypes.DECIMAL(20, 8), allowNull: false },
      purity: { type: DataTypes.DECIMAL(10, 8), allowNull: false },
      fine_weight: { type: DataTypes.DECIMAL(20, 8), allowNull: false },
      available_weight: { type: DataTypes.DECIMAL(20, 8), allowNull: false },
      allocated_weight: { type: DataTypes.DECIMAL(20, 8), allowNull: false, defaultValue: 0 },
      status: { type: DataTypes.ENUM("available", "allocated", "consumed", "returned"), defaultValue: "available" },
      allocations: { type: DataTypes.JSONB, defaultValue: [] },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    });

    // 22. Accounts (Chart of Accounts)
    await queryInterface.createTable("accounts", {
      id: { type: DataTypes.STRING, primaryKey: true },
      company_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      code: { type: DataTypes.STRING, allowNull: false },
      name: { type: DataTypes.STRING, allowNull: false },
      name_ar: { type: DataTypes.STRING, allowNull: false },
      type: { type: DataTypes.ENUM("asset", "liability", "equity", "revenue", "expense"), allowNull: false },
      nature: { type: DataTypes.ENUM("debit", "credit"), allowNull: false },
      parent_id: { type: DataTypes.STRING },
      balance: { type: DataTypes.DECIMAL(20, 8), allowNull: false, defaultValue: 0 },
      is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
      level: { type: DataTypes.INTEGER, defaultValue: 1 },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    });

    // 23. Journal Entries
    await queryInterface.createTable("journal_entries", {
      id: { type: DataTypes.STRING, primaryKey: true },
      company_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      description: { type: DataTypes.STRING, allowNull: false },
      date: { type: DataTypes.STRING, allowNull: false },
      status: { type: DataTypes.ENUM("draft", "balanced", "posted", "pending", "reversed"), defaultValue: "draft" },
      amount: { type: DataTypes.DECIMAL(20, 8), allowNull: false, defaultValue: 0 },
      total_debit: { type: DataTypes.DECIMAL(20, 8), allowNull: false, defaultValue: 0 },
      total_credit: { type: DataTypes.DECIMAL(20, 8), allowNull: false, defaultValue: 0 },
      source_type: { type: DataTypes.STRING },
      source_id: { type: DataTypes.STRING },
      posted_by: { type: DataTypes.STRING },
      posted_at: { type: DataTypes.STRING },
      reversal_of: { type: DataTypes.STRING },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    });

    // 24. Journal Lines
    await queryInterface.createTable("journal_lines", {
      id: { type: DataTypes.STRING, primaryKey: true },
      journal_entry_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "journal_entries", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      account_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "accounts", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      account_code: { type: DataTypes.STRING, allowNull: false },
      account_name: { type: DataTypes.STRING, allowNull: false },
      debit: { type: DataTypes.DECIMAL(20, 8), allowNull: false, defaultValue: 0 },
      credit: { type: DataTypes.DECIMAL(20, 8), allowNull: false, defaultValue: 0 },
      description: { type: DataTypes.STRING },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    });

    // 25. Approval Requests
    await queryInterface.createTable("approval_requests", {
      id: { type: DataTypes.STRING, primaryKey: true },
      company_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      type: {
        type: DataTypes.ENUM("discount", "price-override", "transfer", "adjustment", "cgp", "period-close", "reverse-charge"),
        allowNull: false
      },
      requested_by: { type: DataTypes.STRING, allowNull: false },
      requested_at: { type: DataTypes.STRING, allowNull: false },
      branch: { type: DataTypes.STRING, allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: false },
      amount: { type: DataTypes.DECIMAL(20, 8) },
      status: { type: DataTypes.ENUM("pending", "approved", "rejected", "expired"), defaultValue: "pending" },
      reviewed_by: { type: DataTypes.STRING },
      reviewed_at: { type: DataTypes.STRING },
      reason: { type: DataTypes.STRING },
      related_id: { type: DataTypes.STRING },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    });

    // 26. Settings
    await queryInterface.createTable("settings", {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      company_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      key: { type: DataTypes.STRING, allowNull: false },
      value: { type: DataTypes.JSONB, allowNull: false },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    });

    // 27. Audit Logs
    await queryInterface.createTable("audit_logs", {
      id: { type: DataTypes.STRING, primaryKey: true },
      company_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      action: { type: DataTypes.STRING, allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: false },
      user: { type: DataTypes.STRING, allowNull: false },
      user_id: { type: DataTypes.STRING },
      place: { type: DataTypes.STRING, allowNull: false },
      branch: { type: DataTypes.STRING },
      date: { type: DataTypes.STRING, allowNull: false },
      before: { type: DataTypes.TEXT },
      after: { type: DataTypes.TEXT },
      device: { type: DataTypes.STRING },
      correlation_id: { type: DataTypes.STRING },
      source_document: { type: DataTypes.STRING },
      severity: { type: DataTypes.ENUM("info", "warning", "critical"), defaultValue: "info" },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    });

    // 28. Gold Price Snapshots
    await queryInterface.createTable("gold_prices", {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      karat: { type: DataTypes.INTEGER, allowNull: false },
      price_per_gram: { type: DataTypes.DECIMAL(20, 8), allowNull: false },
      currency: { type: DataTypes.STRING, allowNull: false, defaultValue: "AED" },
      updated_by: { type: DataTypes.STRING, defaultValue: "System" },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    });

    // Add indexes for efficient scoping and searching
    await queryInterface.addIndex("users", ["company_id"]);
    await queryInterface.addIndex("employees", ["company_id"]);
    await queryInterface.addIndex("employee_sessions", ["employee_id"]);
    await queryInterface.addIndex("assets", ["company_id", "barcode"]);
    await queryInterface.addIndex("asset_events", ["asset_id"]);
    await queryInterface.addIndex("customers", ["company_id", "phone"]);
    await queryInterface.addIndex("suppliers", ["company_id"]);
    await queryInterface.addIndex("invoices", ["company_id", "customer_id"]);
    await queryInterface.addIndex("journal_entries", ["company_id"]);
    await queryInterface.addIndex("audit_logs", ["company_id", "correlation_id"]);
  },

  down: async (queryInterface, Sequelize) => {
    // Drop in reverse order of foreign keys
    await queryInterface.dropTable("gold_prices");
    await queryInterface.dropTable("audit_logs");
    await queryInterface.dropTable("settings");
    await queryInterface.dropTable("approval_requests");
    await queryInterface.dropTable("journal_lines");
    await queryInterface.dropTable("journal_entries");
    await queryInterface.dropTable("accounts");
    await queryInterface.dropTable("inventory_gold_pools");
    await queryInterface.dropTable("customer_gold_pools");
    await queryInterface.dropTable("manufacturing_orders");
    await queryInterface.dropTable("transfers");
    await queryInterface.dropTable("reservations");
    await queryInterface.dropTable("invoice_items");
    await queryInterface.dropTable("invoices");
    await queryInterface.dropTable("purchase_order_items");
    await queryInterface.dropTable("purchase_orders");
    await queryInterface.dropTable("supplier_consignments");
    await queryInterface.dropTable("supplier_documents");
    await queryInterface.dropTable("suppliers");
    await queryInterface.dropTable("customers");
    await queryInterface.dropTable("asset_attachments");
    await queryInterface.dropTable("asset_certificates");
    await queryInterface.dropTable("asset_events");
    await queryInterface.dropTable("assets");
    await queryInterface.dropTable("employee_sessions");
    await queryInterface.dropTable("employees");
    await queryInterface.dropTable("users");
    await queryInterface.dropTable("companies");
  }
};
