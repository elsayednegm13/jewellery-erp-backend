const bcrypt = require("bcryptjs");

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const now = new Date();

    // Idempotency check: skip seeder if company CMP-DEMO already exists
    const existingCompanies = await queryInterface.sequelize.query(
      "SELECT id FROM companies WHERE id = 'CMP-DEMO'",
      { type: queryInterface.sequelize.QueryTypes.SELECT }
    );
    if (existingCompanies && existingCompanies.length > 0) {
      console.log("[Seeder] Demo company CMP-DEMO already exists. Skipping seeder execution to prevent errors.");
      return;
    }

    // 1. Companies
    await queryInterface.bulkInsert("companies", [
      {
        id: "CMP-DEMO",
        business_name: "DARFUS Jewellery",
        workspace: "demo",
        company_size: "11-50",
        country: "AE",
        currency: "AED",
        city: "Dubai",
        region: "Dubai",
        address_1: "Main Jewellery District",
        address_2: "",
        postal_code: "00000",
        commercial_register: "CN-2026-001",
        tax_number: "100000000000001",
        logo: "",
        branch_name: "Main Branch",
        created_at: now,
        updated_at: now
      }
    ]);

    // 1b. Branches
    await queryInterface.bulkInsert("branches", [
      {
        id: "BR-DXB",
        company_id: "CMP-DEMO",
        name: "فرع دبي مول",
        code: "DXB-MALL",
        type: "store",
        address: "Dubai Mall",
        phone: "+97140000000",
        is_active: true,
        created_at: now,
        updated_at: now
      },
      {
        id: "BR-AUH",
        company_id: "CMP-DEMO",
        name: "فرع أبوظبي",
        code: "AUH-GALLERY",
        type: "store",
        address: "Abu Dhabi",
        phone: "+97120000000",
        is_active: true,
        created_at: now,
        updated_at: now
      },
      {
        id: "BR-SHJ",
        company_id: "CMP-DEMO",
        name: "فرع الشارقة",
        code: "SHJ-MALL",
        type: "store",
        address: "Sharjah",
        phone: "+97160000000",
        is_active: true,
        created_at: now,
        updated_at: now
      },
      {
        id: "BR-WH",
        company_id: "CMP-DEMO",
        name: "المستودع الرئيسي",
        code: "MAIN-WH",
        type: "warehouse",
        address: "Warehouse District",
        phone: "+97149999999",
        is_active: true,
        created_at: now,
        updated_at: now
      },
      {
        id: "BR-FAC",
        company_id: "CMP-DEMO",
        name: "المصنع",
        code: "GOLD-FACTORY",
        type: "factory",
        address: "Industrial Area",
        phone: "+97148888888",
        is_active: true,
        created_at: now,
        updated_at: now
      }
    ]);

    // 2. Users (Admin Auth credentials)
    const adminPasswordHash = bcrypt.hashSync("123456", 10);
    await queryInterface.bulkInsert("users", [
      {
        id: "USR-ADMIN",
        company_id: "CMP-DEMO",
        first_name: "Admin",
        last_name: "DARFUS",
        email: "admin@admin.com",
        phone: "+20 100 000 0000",
        password: adminPasswordHash,
        job_title: "System Administrator",
        role: "admin",
        created_at: now,
        updated_at: now
      }
    ]);

    // 3. Employees
    await queryInterface.bulkInsert("employees", [
      { id: "EMP-001", company_id: "CMP-DEMO", name: "عمر حسن", role: "Sales", system_role: "sales", branch: "فرع دبي مول", status: "present", email: "omar@darfus.com", phone: "+971 55 001 0001", join_date: "2024-03-01", job_title: "مسؤول مبيعات", approval_limit: 5000, base_salary: 6000, allowances: 1000, created_at: now, updated_at: now },
      { id: "EMP-002", company_id: "CMP-DEMO", name: "ليلى عادل", role: "Cashier", system_role: "sales", branch: "فرع أبوظبي", status: "present", email: "laila@darfus.com", phone: "+971 55 002 0002", join_date: "2024-05-15", job_title: "كاشير", approval_limit: 2000, base_salary: 4500, allowances: 800, created_at: now, updated_at: now },
      { id: "EMP-003", company_id: "CMP-DEMO", name: "سارة أحمد", role: "Inventory", system_role: "manager", branch: "المستودع الرئيسي", status: "present", email: "sara@darfus.com", phone: "+971 55 003 0003", join_date: "2023-11-01", job_title: "مديرة مخزون", approval_limit: 20000, base_salary: 12000, allowances: 2000, created_at: now, updated_at: now },
      { id: "EMP-004", company_id: "CMP-DEMO", name: "محمد سالم", role: "Quality", system_role: "manager", branch: "المصنع", status: "leave", email: "mohammed@darfus.com", phone: "+971 55 004 0004", join_date: "2024-01-10", job_title: "مدير الجودة", approval_limit: 15000, base_salary: 11000, allowances: 2000, created_at: now, updated_at: now },
      { id: "EMP-005", company_id: "CMP-DEMO", name: "نور خالد", role: "Branch Manager", system_role: "manager", branch: "فرع الشارقة", status: "present", email: "nour@darfus.com", phone: "+971 55 005 0005", join_date: "2023-08-01", job_title: "مدير فرع", approval_limit: 50000, base_salary: 18000, allowances: 3000, created_at: now, updated_at: now },
      { id: "EMP-006", company_id: "CMP-DEMO", name: "أحمد يوسف", role: "Logistics", system_role: "sales", branch: "المستودع الرئيسي", status: "present", email: "ahmed@darfus.com", phone: "+971 55 006 0006", join_date: "2025-01-20", job_title: "مسؤول لوجستيك", approval_limit: 3000, base_salary: 5000, allowances: 800, created_at: now, updated_at: now }
    ]);

    // 4. Employee Sessions
    await queryInterface.bulkInsert("employee_sessions", [
      { id: "SES-1001", employee_id: "EMP-001", device_name: "Cashier Desktop", browser: "Chrome/Windows", location: "Dubai Mall", last_active: "2026-06-12 19:22", is_current: false, created_at: now, updated_at: now },
      { id: "SES-1002", employee_id: "EMP-003", device_name: "Inventory PDA", browser: "Safari/iOS", location: "Main Warehouse", last_active: "2026-06-12 17:14", is_current: false, created_at: now, updated_at: now }
    ]);

    // 5. Assets
    await queryInterface.bulkInsert("assets", [
      {
        id: "AST-2026-00184",
        company_id: "CMP-DEMO",
        name: "خاتم ألماس سوليتير",
        type: "diamond",
        category: "خواتم",
        karat: 18,
        purity: 0.75,
        gross_weight: 6.42,
        net_weight: 5.91,
        gold_weight: 2.91,
        price: 12800,
        cost: 8450,
        branch: "فرع دبي مول",
        location: "خزنة A · رف 04",
        status: "available",
        barcode: "6291001840138",
        rfid: "E280-1160-6000-0209-1840",
        source: "مورد: Emirates Diamonds",
        stones: 1,
        stone_details: JSON.stringify([{ type: "diamond", count: 1, totalCaratWeight: 1.2, color: "D", clarity: "VVS1", certificateRef: "GIA-1234567890" }]),
        notes: "سوليتير فاخر",
        created_at: now,
        updated_at: now
      },
      {
        id: "AST-2026-00179",
        company_id: "CMP-DEMO",
        name: "سوار ذهب إيطالي",
        type: "gold-piece",
        category: "أساور",
        karat: 21,
        purity: 0.875,
        gross_weight: 18.75,
        net_weight: 18.75,
        gold_weight: 16.41,
        price: 7350,
        cost: 5620,
        branch: "فرع أبوظبي",
        location: "معرض B · درج 07",
        status: "reserved",
        barcode: "6291001790136",
        source: "تصنيع داخلي MO-122",
        parent_asset_id: "BAR-24K-00018",
        manufacturing_order_id: "MO-122",
        contribution_weight: 19.5,
        process_loss: 0.75,
        created_at: now,
        updated_at: now
      },
      {
        id: "AST-2026-00173",
        company_id: "CMP-DEMO",
        name: "عقد زمرد كولومبي",
        type: "gemstone",
        category: "عقود",
        karat: 18,
        purity: 0.75,
        gross_weight: 31.2,
        net_weight: 26.4,
        gold_weight: 8.1,
        price: 22400,
        cost: 15900,
        branch: "فرع دبي مول",
        location: "خزنة VIP · رف 01",
        status: "available",
        barcode: "6291001730101",
        rfid: "E280-1160-6000-0209-1730",
        source: "مورد: Colombia Gems",
        stones: 14,
        stone_details: JSON.stringify([
          { type: "emerald", count: 1, totalCaratWeight: 8.5, color: "Vivid Green", clarity: "VS", certificateRef: "GIA-9876543210" },
          { type: "diamond", count: 13, totalCaratWeight: 1.8, color: "G", clarity: "VS1" }
        ]),
        created_at: now,
        updated_at: now
      },
      {
        id: "AST-2026-00166",
        company_id: "CMP-DEMO",
        name: "طقم لؤلؤ بحريني",
        type: "pearl",
        category: "أطقم",
        karat: 18,
        purity: 0.75,
        gross_weight: 42.8,
        net_weight: 14.1,
        gold_weight: 10.575,
        price: 9800,
        cost: 6700,
        branch: "فرع الشارقة",
        location: "معرض A · رف 12",
        status: "repair",
        barcode: "6291001660117",
        source: "مورد: Gulf Pearls",
        pearls: 28,
        pearl_details: JSON.stringify([{ type: "natural", count: 28, diameter: 9.5, luster: "Excellent", source: "Bahrain" }]),
        created_at: now,
        updated_at: now
      },
      {
        id: "AST-2026-00152",
        company_id: "CMP-DEMO",
        name: "ساعة ذهب كلاسيكية",
        type: "watch",
        category: "ساعات",
        karat: 18,
        purity: 0.75,
        gross_weight: 88.4,
        net_weight: 54.7,
        gold_weight: 41.025,
        price: 18600,
        cost: 13200,
        branch: "فرع دبي مول",
        location: "واجهة W · 03",
        status: "available",
        barcode: "6291001520107",
        source: "مورد: Swiss Time ME",
        created_at: now,
        updated_at: now
      },
      {
        id: "AST-2026-00144",
        company_id: "CMP-DEMO",
        name: "خاتم ذهب عيار 22",
        type: "gold-piece",
        category: "خواتم",
        karat: 22,
        purity: 0.916,
        gross_weight: 9.85,
        net_weight: 9.85,
        gold_weight: 9.022,
        price: 4290,
        cost: 3350,
        branch: "فرع أبوظبي",
        location: "معرض A · درج 03",
        status: "sold",
        barcode: "6291001440139",
        source: "ذهب مستعمل IGP-050",
        parent_asset_id: "CGP-2026-0050",
        created_at: now,
        updated_at: now
      }
    ]);

    // 6. Asset Events
    await queryInterface.bulkInsert("asset_events", [
      { id: "ae-1", asset_id: "AST-2026-00184", action: "تم إنشاء الأصل", date: "2026-06-10 09:20", user: "سارة أحمد", branch: "المستودع الرئيسي", note: "إدخال فاتورة شراء PO-381", source_document: "PO-381", severity: "info", created_at: now, updated_at: now },
      { id: "ae-2", asset_id: "AST-2026-00184", action: "نقل إلى الفرع", date: "2026-06-11 14:10", user: "أحمد يوسف", branch: "فرع دبي مول", note: "Transfer TR-0901", source_document: "TR-0901", before_state: "branch:المستودع الرئيسي", after_state: "branch:فرع دبي مول", severity: "info", created_at: now, updated_at: now },
      { id: "ae-3", asset_id: "AST-2026-00179", action: "تحويل من سبيكة", date: "2026-06-07 08:35", user: "قسم التصنيع", branch: "المصنع", note: "ناتج أمر تصنيع MO-122", source_document: "MO-122", severity: "info", created_at: now, updated_at: now },
      { id: "ae-4", asset_id: "AST-2026-00179", action: "حجز", date: "2026-06-12 17:05", user: "ليلى عادل", branch: "فرع أبوظبي", note: "حجز للعميلة مريم سالم حتى 15 يونيو", before_state: "status:available", after_state: "status:reserved", severity: "info", created_at: now, updated_at: now }
    ]);

    // 7. Customers
    await queryInterface.bulkInsert("customers", [
      { id: "CUS-0012", company_id: "CMP-DEMO", name: "مريم سالم", phone: "+971 50 123 8890", email: "mariam@example.com", tier: "VIP", balance: 0, purchases: 68400, last_visit: "2026-06-12", nationality: "UAE", id_type: "national-id", id_number: "784-1985-1234567-1", kyc_status: "verified", aml_status: "clear", credit_limit: 100000, loyalty_points: 6840, addresses: JSON.stringify([{ line1: "Villa 12, Al Barsha", city: "Dubai", country: "AE" }]), created_at: now, updated_at: now },
      { id: "CUS-0026", company_id: "CMP-DEMO", name: "خالد المنصوري", phone: "+971 55 740 2211", email: "khaled@example.com", tier: "Gold", balance: 4200, purchases: 38150, last_visit: "2026-06-11", nationality: "UAE", kyc_status: "verified", aml_status: "clear", credit_limit: 50000, loyalty_points: 3815, created_at: now, updated_at: now },
      { id: "CUS-0034", company_id: "CMP-DEMO", name: "دانة العتيبي", phone: "+971 52 668 0091", email: "dana@example.com", tier: "Gold", balance: 0, purchases: 29700, last_visit: "2026-06-10", nationality: "KW", kyc_status: "verified", aml_status: "clear", credit_limit: 40000, loyalty_points: 2970, created_at: now, updated_at: now },
      { id: "CUS-0041", company_id: "CMP-DEMO", name: "يوسف إبراهيم", phone: "+971 56 411 2033", email: "yousef@example.com", tier: "Standard", balance: 1550, purchases: 12600, last_visit: "2026-06-08", nationality: "SA", kyc_status: "pending", aml_status: "clear", credit_limit: 20000, loyalty_points: 1260, created_at: now, updated_at: now },
      { id: "CUS-0058", company_id: "CMP-DEMO", name: "نورا الهاشمي", phone: "+971 54 980 7712", email: "noura@example.com", tier: "VIP", balance: 0, purchases: 91200, last_visit: "2026-06-12", nationality: "AE", kyc_status: "verified", aml_status: "clear", credit_limit: 150000, loyalty_points: 9120, created_at: now, updated_at: now }
    ]);

    // 8. Suppliers
    await queryInterface.bulkInsert("suppliers", [
      { id: "SUP-011", company_id: "CMP-DEMO", name: "Emirates Diamonds", category: "ألماس", phone: "+971 4 555 8011", email: "sales@emiratesdiamonds.ae", due: 154000, last_order: "2026-06-10", rating: 4.9, country: "AE", payment_terms: "net-30", created_at: now, updated_at: now },
      { id: "SUP-017", company_id: "CMP-DEMO", name: "Gulf Pearls", category: "لؤلؤ", phone: "+973 17 448 910", email: "info@gulfpearls.bh", due: 28600, last_order: "2026-05-27", rating: 4.7, country: "BH", payment_terms: "net-60", created_at: now, updated_at: now },
      { id: "SUP-023", company_id: "CMP-DEMO", name: "Swiss Time ME", category: "ساعات", phone: "+971 4 338 9022", email: "me@swisstime.com", due: 72000, last_order: "2026-05-19", rating: 4.8, country: "CH", payment_terms: "net-30", created_at: now, updated_at: now },
      { id: "SUP-031", company_id: "CMP-DEMO", name: "Colombia Gems", category: "أحجار كريمة", phone: "+57 601 440 118", email: "export@colombiagems.co", due: 46800, last_order: "2026-06-04", rating: 4.6, country: "CO", payment_terms: "net-45", created_at: now, updated_at: now }
    ]);

    // 9. Purchase Orders
    await queryInterface.bulkInsert("purchase_orders", [
      { id: "PO-381", company_id: "CMP-DEMO", supplier_id: "SUP-011", supplier_name: "Emirates Diamonds", status: "received", date: "2026-06-08", expected_date: "2026-06-10", received_date: "2026-06-10", total: 84500, branch: "المستودع الرئيسي", created_at: now, updated_at: now },
      { id: "PO-GP77", company_id: "CMP-DEMO", supplier_id: "SUP-017", supplier_name: "Gulf Pearls", status: "received", date: "2026-05-25", received_date: "2026-05-27", total: 28600, branch: "المستودع الرئيسي", created_at: now, updated_at: now }
    ]);

    // 10. Purchase Order Items
    await queryInterface.bulkInsert("purchase_order_items", [
      { id: "poi-1", purchase_order_id: "PO-381", description: "خاتم ألماس سوليتير 1.2 قيراط", quantity: 1, unit: "قطعة", unit_price: 84500, total: 84500, received_quantity: 1, created_at: now, updated_at: now },
      { id: "poi-2", purchase_order_id: "PO-GP77", description: "طقم لؤلؤ بحريني طبيعي", quantity: 1, unit: "طقم", unit_price: 28600, total: 28600, received_quantity: 1, created_at: now, updated_at: now }
    ]);

    // 11. Invoices
    await queryInterface.bulkInsert("invoices", [
      { id: "INV-10486", company_id: "CMP-DEMO", type: "sale", customer_id: "CUS-0012", customer_name: "مريم سالم", date: "2026-06-12 19:22", subtotal: 4086, total: 4290, tax: 204, status: "paid", payment_method: "بطاقة", branch: "فرع أبوظبي", posted_at: "2026-06-12 19:22", paid_amount: 4290, remaining_amount: 0, created_at: now, updated_at: now },
      { id: "INV-10485", company_id: "CMP-DEMO", type: "sale", customer_id: "CUS-0058", customer_name: "نورا الهاشمي", date: "2026-06-12 18:45", subtotal: 16000, total: 16800, tax: 800, status: "paid", payment_method: "تحويل بنكي", branch: "فرع دبي مول", posted_at: "2026-06-12 18:45", paid_amount: 16800, remaining_amount: 0, created_at: now, updated_at: now },
      { id: "INV-10484", company_id: "CMP-DEMO", type: "sale", customer_id: "CUS-0026", customer_name: "خالد المنصوري", date: "2026-06-12 16:18", subtotal: 10714, total: 11250, tax: 536, status: "partial", payment_method: "تقسيط", branch: "فرع الشارقة", paid_amount: 5000, remaining_amount: 6250, created_at: now, updated_at: now },
      { id: "INV-10483", company_id: "CMP-DEMO", type: "sale", customer_id: "CUS-0034", customer_name: "دانة العتيبي", date: "2026-06-12 13:05", subtotal: 7524, total: 7900, tax: 376, status: "paid", payment_method: "نقدي", branch: "فرع دبي مول", posted_at: "2026-06-12 13:05", paid_amount: 7900, remaining_amount: 0, created_at: now, updated_at: now },
      { id: "INV-10482", company_id: "CMP-DEMO", type: "sale", customer_id: "CUS-0041", customer_name: "يوسف إبراهيم", date: "2026-06-11 20:40", subtotal: 6000, total: 6300, tax: 300, status: "due", payment_method: "عربون", branch: "فرع أبوظبي", paid_amount: 1000, remaining_amount: 5300, created_at: now, updated_at: now }
    ]);

    // 12. Invoice Items
    await queryInterface.bulkInsert("invoice_items", [
      { invoice_id: "INV-10486", asset_id: "AST-2026-00144", name: "خاتم ذهب عيار 22", quantity: 1, price: 4290, cost: 3350, weight: 9.85, karat: 22, created_at: now, updated_at: now },
      { invoice_id: "INV-10485", asset_id: "AST-2026-00120", name: "عقد ألماس", quantity: 1, price: 16800, cost: 12000, weight: 15.2, karat: 18, created_at: now, updated_at: now }
    ]);

    // 13. Reservations
    await queryInterface.bulkInsert("reservations", [
      { id: "RES-0045", company_id: "CMP-DEMO", asset_id: "AST-2026-00179", asset_name: "سوار ذهب إيطالي", customer_id: "CUS-0012", customer_name: "مريم سالم", branch: "فرع أبوظبي", deposit: 1000, expires_at: "2026-06-15", status: "active", notes: "العميلة ستتواصل لاستكمال الشراء", created_at: now, updated_at: now }
    ]);

    // 14. Transfers
    await queryInterface.bulkInsert("transfers", [
      { id: "TR-0901", company_id: "CMP-DEMO", asset_ids: JSON.stringify(["AST-2026-00184"]), from_branch: "المستودع الرئيسي", to_branch: "فرع دبي مول", requested_by: "سارة أحمد", requested_at: "2026-06-11 12:00", approved_by: "نور خالد", approved_at: "2026-06-11 13:30", received_by: "عمر حسن", received_at: "2026-06-11 14:10", status: "received", notes: "لعرض VIP", created_at: now, updated_at: now },
      { id: "TR-0905", company_id: "CMP-DEMO", asset_ids: JSON.stringify(["AST-2026-00152"]), from_branch: "فرع دبي مول", to_branch: "فرع الشارقة", requested_by: "عمر حسن", requested_at: "2026-06-14 09:00", status: "pending", notes: "طلب عميل", created_at: now, updated_at: now }
    ]);

    // 15. Manufacturing Orders
    await queryInterface.bulkInsert("manufacturing_orders", [
      {
        id: "MO-122",
        company_id: "CMP-DEMO",
        status: "completed",
        type: "manufacturing",
        input_assets: JSON.stringify([{ assetId: "BAR-24K-00018", assetName: "سبيكة ذهب 24K", grossWeight: 19.5, contributionWeight: 19.5 }]),
        output_assets: JSON.stringify([{ assetId: "AST-2026-00179", assetName: "سوار ذهب إيطالي", grossWeight: 18.75, isExpected: true }]),
        expected_output_weight: 18.75,
        actual_output_weight: 18.75,
        process_loss: 0.75,
        wastage: 0,
        branch: "المصنع",
        started_at: "2026-06-05 08:00",
        completed_at: "2026-06-07 08:35",
        created_by: "محمد سالم",
        approved_by: "Admin DARFUS",
        created_at: now,
        updated_at: now
      }
    ]);

    // 16. Customer Gold Pools (CGP)
    await queryInterface.bulkInsert("customer_gold_pools", [
      {
        id: "CGP-2026-0050",
        company_id: "CMP-DEMO",
        customer_id: "CUS-0012",
        customer_name: "مريم سالم",
        status: "approved",
        gross_weight: 48.0,
        purity: 0.75,
        fine_weight: 36.0,
        assay_result: 0.752,
        assay_date: "2026-05-12",
        assayed_by: "محمد سالم",
        received_at: "2026-05-10 10:30",
        approved_at: "2026-05-13 14:00",
        approved_by: "Admin DARFUS",
        notes: "ذهب مستعمل من ميراث عائلي",
        transferred_to_igp: true,
        igp_id: "IGP-2026-050",
        created_at: now,
        updated_at: now
      }
    ]);

    // 17. Inventory Gold Pools (IGP)
    await queryInterface.bulkInsert("inventory_gold_pools", [
      {
        id: "IGP-2026-050",
        company_id: "CMP-DEMO",
        source: "CGP-2026-0050",
        cgp_id: "CGP-2026-0050",
        gross_weight: 48.0,
        purity: 0.752,
        fine_weight: 36.096,
        available_weight: 28.5,
        allocated_weight: 19.5,
        status: "available",
        allocations: JSON.stringify([
          { id: "ALLOC-001", igpId: "IGP-2026-050", manufacturingOrderId: "MO-122", allocatedWeight: 19.5, allocatedAt: "2026-06-04 14:00" }
        ]),
        created_at: now,
        updated_at: now
      }
    ]);

    // 18. Accounts
    await queryInterface.bulkInsert("accounts", [
      { id: "ACC-1000", company_id: "CMP-DEMO", code: "1000", name: "Assets", name_ar: "الأصول", type: "asset", nature: "debit", balance: 4286250, is_active: true, level: 1, created_at: now, updated_at: now },
      { id: "ACC-1100", company_id: "CMP-DEMO", code: "1100", name: "Cash & Bank", name_ar: "النقد والبنوك", type: "asset", nature: "debit", parent_id: "ACC-1000", balance: 486250, is_active: true, level: 2, created_at: now, updated_at: now },
      { id: "ACC-1110", company_id: "CMP-DEMO", code: "1110", name: "Cash on Hand", name_ar: "نقد في الخزنة", type: "asset", nature: "debit", parent_id: "ACC-1100", balance: 186250, is_active: true, level: 3, created_at: now, updated_at: now },
      { id: "ACC-1120", company_id: "CMP-DEMO", code: "1120", name: "Bank Accounts", name_ar: "الحسابات البنكية", type: "asset", nature: "debit", parent_id: "ACC-1100", balance: 300000, is_active: true, level: 3, created_at: now, updated_at: now },
      { id: "ACC-1200", company_id: "CMP-DEMO", code: "1200", name: "Inventory", name_ar: "المخزون", type: "asset", nature: "debit", parent_id: "ACC-1000", balance: 3800000, is_active: true, level: 2, created_at: now, updated_at: now },
      { id: "ACC-2000", company_id: "CMP-DEMO", code: "2000", name: "Liabilities", name_ar: "الخصوم", type: "liability", nature: "credit", balance: 301400, is_active: true, level: 1, created_at: now, updated_at: now },
      { id: "ACC-1300", company_id: "CMP-DEMO", code: "1300", name: "Accounts Receivable", name_ar: "ذمم العملاء", type: "asset", nature: "debit", parent_id: "ACC-1000", balance: 0, is_active: true, level: 2, created_at: now, updated_at: now },
      { id: "ACC-2100", company_id: "CMP-DEMO", code: "2100", name: "Accounts Payable", name_ar: "ذمم الموردين", type: "liability", nature: "credit", parent_id: "ACC-2000", balance: 301400, is_active: true, level: 2, created_at: now, updated_at: now },
      { id: "ACC-2200", company_id: "CMP-DEMO", code: "2200", name: "VAT Payable", name_ar: "ضريبة القيمة المضافة", type: "liability", nature: "credit", parent_id: "ACC-2000", balance: 0, is_active: true, level: 2, created_at: now, updated_at: now },
      { id: "ACC-2300", company_id: "CMP-DEMO", code: "2300", name: "Customer Deposits", name_ar: "عرابين العملاء", type: "liability", nature: "credit", parent_id: "ACC-2000", balance: 0, is_active: true, level: 2, created_at: now, updated_at: now },
      { id: "ACC-2400", company_id: "CMP-DEMO", code: "2400", name: "Gift Voucher Liability", name_ar: "التزام قسائم الهدايا", type: "liability", nature: "credit", parent_id: "ACC-2000", balance: 0, is_active: true, level: 2, created_at: now, updated_at: now },
      { id: "ACC-3000", company_id: "CMP-DEMO", code: "3000", name: "Equity", name_ar: "حقوق الملكية", type: "equity", nature: "credit", balance: 2000000, is_active: true, level: 1, created_at: now, updated_at: now },
      { id: "ACC-4000", company_id: "CMP-DEMO", code: "4000", name: "Revenue", name_ar: "الإيرادات", type: "revenue", nature: "credit", balance: 1284540, is_active: true, level: 1, created_at: now, updated_at: now },
      { id: "ACC-4100", company_id: "CMP-DEMO", code: "4100", name: "Jewelry Sales", name_ar: "مبيعات المجوهرات", type: "revenue", nature: "credit", parent_id: "ACC-4000", balance: 1284540, is_active: true, level: 2, created_at: now, updated_at: now },
      { id: "ACC-4200", company_id: "CMP-DEMO", code: "4200", name: "Gold Profit", name_ar: "أرباح الذهب", type: "revenue", nature: "credit", parent_id: "ACC-4000", balance: 0, is_active: true, level: 2, created_at: now, updated_at: now },
      { id: "ACC-4900", company_id: "CMP-DEMO", code: "4900", name: "Other Income", name_ar: "إيرادات أخرى", type: "revenue", nature: "credit", parent_id: "ACC-4000", balance: 0, is_active: true, level: 2, created_at: now, updated_at: now },
      { id: "ACC-5000", company_id: "CMP-DEMO", code: "5000", name: "Cost of Goods Sold", name_ar: "تكلفة البضاعة المباعة", type: "expense", nature: "debit", balance: 825000, is_active: true, level: 1, created_at: now, updated_at: now },
      { id: "ACC-6000", company_id: "CMP-DEMO", code: "6000", name: "Operating Expenses", name_ar: "المصروفات التشغيلية", type: "expense", nature: "debit", balance: 0, is_active: true, level: 1, created_at: now, updated_at: now }
    ]);

    // 19. Journal Entries
    await queryInterface.bulkInsert("journal_entries", [
      {
        id: "JE-260612-091",
        company_id: "CMP-DEMO",
        description: "مبيعات فرع دبي مول",
        date: "2026-06-12",
        status: "balanced",
        amount: 52780,
        total_debit: 52780,
        total_credit: 52780,
        source_type: "sale",
        posted_at: "2026-06-12 20:00",
        posted_by: "Admin DARFUS",
        created_at: now,
        updated_at: now
      },
      {
        id: "JE-260612-087",
        company_id: "CMP-DEMO",
        description: "استلام دفعة من عميل",
        date: "2026-06-12",
        status: "balanced",
        amount: 18000,
        total_debit: 18000,
        total_credit: 18000,
        source_type: "manual",
        posted_at: "2026-06-12 18:00",
        posted_by: "محمد سالم",
        created_at: now,
        updated_at: now
      }
    ]);

    // 20. Journal Lines
    await queryInterface.bulkInsert("journal_lines", [
      { id: "jl-1", journal_entry_id: "JE-260612-091", account_id: "ACC-1110", account_code: "1110", account_name: "نقد في الخزنة", debit: 52780, credit: 0, created_at: now, updated_at: now },
      { id: "jl-2", journal_entry_id: "JE-260612-091", account_id: "ACC-4100", account_code: "4100", account_name: "مبيعات المجوهرات", debit: 0, credit: 50267, created_at: now, updated_at: now },
      { id: "jl-3", journal_entry_id: "JE-260612-091", account_id: "ACC-2000", account_code: "2000", account_name: "ضريبة القيمة المضافة", debit: 0, credit: 2513, created_at: now, updated_at: now }
    ]);

    // 21. Approval Requests
    await queryInterface.bulkInsert("approval_requests", [
      { id: "APR-001", company_id: "CMP-DEMO", type: "discount", requested_by: "عمر حسن", requested_at: "2026-06-14 09:30", branch: "فرع دبي مول", description: "خصم 15% على طقم لؤلؤ لعميلة VIP", amount: 1470, status: "pending", related_id: "AST-2026-00166", created_at: now, updated_at: now },
      { id: "APR-002", company_id: "CMP-DEMO", type: "price-override", requested_by: "ليلى عادل", requested_at: "2026-06-13 16:00", branch: "فرع أبوظبي", description: "تعديل سعر خاتم ذهب 22 عيار", amount: 4200, status: "approved", reviewed_by: "نور خالد", reviewed_at: "2026-06-13 17:30", related_id: "AST-2026-00144", created_at: now, updated_at: now }
    ]);

    // 22. Audit Logs
    await queryInterface.bulkInsert("audit_logs", [
      { id: "AUD-1001", company_id: "CMP-DEMO", action: "sale", description: "INV-10486 · AST-2026-00144", user: "عمر حسن", user_id: "EMP-001", place: "فرع أبوظبي", branch: "فرع أبوظبي", date: "2026-06-12 19:22", before: "Asset: available", after: "Asset: sold", device: "POS-ABD-01", correlation_id: "COR-INV-10486", source_document: "INV-10486", severity: "info", created_at: now, updated_at: now },
      { id: "AUD-1002", company_id: "CMP-DEMO", action: "permissions", description: "Role: Branch Manager", user: "Admin DARFUS", user_id: "USR-ADMIN", place: "Head Office", branch: "المركز الرئيسي", date: "2026-06-12 17:14", before: "74 permissions", after: "76 permissions", device: "ADMIN-PC-01", severity: "warning", created_at: now, updated_at: now }
    ]);

    // 23. Settings
    await queryInterface.bulkInsert("settings", [
      {
        company_id: "CMP-DEMO",
        key: "vat-config",
        value: JSON.stringify({ rate: 5.0, currency: "AED" }),
        created_at: now,
        updated_at: now
      }
    ]);

    // 24. Gold Prices
    await queryInterface.bulkInsert("gold_prices", [
      { karat: 24, price_per_gram: 476.80, currency: "AED", updated_by: "Admin DARFUS", created_at: now, updated_at: now },
      { karat: 22, price_per_gram: 437.07, currency: "AED", updated_by: "Admin DARFUS", created_at: now, updated_at: now },
      { karat: 21, price_per_gram: 417.20, currency: "AED", updated_by: "Admin DARFUS", created_at: now, updated_at: now },
      { karat: 18, price_per_gram: 357.60, currency: "AED", updated_by: "Admin DARFUS", created_at: now, updated_at: now }
    ]);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete("gold_prices", null, {});
    await queryInterface.bulkDelete("settings", null, {});
    await queryInterface.bulkDelete("audit_logs", null, {});
    await queryInterface.bulkDelete("approval_requests", null, {});
    await queryInterface.bulkDelete("journal_lines", null, {});
    await queryInterface.bulkDelete("journal_entries", null, {});
    await queryInterface.bulkDelete("accounts", null, {});
    await queryInterface.bulkDelete("inventory_gold_pools", null, {});
    await queryInterface.bulkDelete("customer_gold_pools", null, {});
    await queryInterface.bulkDelete("manufacturing_orders", null, {});
    await queryInterface.bulkDelete("transfers", null, {});
    await queryInterface.bulkDelete("reservations", null, {});
    await queryInterface.bulkDelete("invoice_items", null, {});
    await queryInterface.bulkDelete("invoices", null, {});
    await queryInterface.bulkDelete("purchase_order_items", null, {});
    await queryInterface.bulkDelete("purchase_orders", null, {});
    await queryInterface.bulkDelete("suppliers", null, {});
    await queryInterface.bulkDelete("customers", null, {});
    await queryInterface.bulkDelete("asset_events", null, {});
    await queryInterface.bulkDelete("assets", null, {});
    await queryInterface.bulkDelete("employee_sessions", null, {});
    await queryInterface.bulkDelete("employees", null, {});
    await queryInterface.bulkDelete("users", null, {});
    await queryInterface.bulkDelete("companies", null, {});
  }
};
