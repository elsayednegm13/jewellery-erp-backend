"use strict";

const { DataTypes, QueryTypes } = require("sequelize");

async function tableExists(queryInterface, tableName) {
  const tables = await queryInterface.showAllTables();
  return tables.some((table) => {
    if (typeof table === "string") return table === tableName;
    return table.tableName === tableName;
  });
}

async function columnExists(queryInterface, tableName, columnName) {
  try {
    const table = await queryInterface.describeTable(tableName);
    return Boolean(table[columnName]);
  } catch {
    return false;
  }
}

async function addColumnIfNotExists(queryInterface, tableName, columnName, definition) {
  const exists = await columnExists(queryInterface, tableName, columnName);
  if (!exists) {
    await queryInterface.addColumn(tableName, columnName, definition);
  }
}

async function removeColumnIfExists(queryInterface, tableName, columnName) {
  const exists = await columnExists(queryInterface, tableName, columnName);
  if (exists) {
    await queryInterface.removeColumn(tableName, columnName);
  }
}

module.exports = {
  up: async (queryInterface) => {
    const now = new Date();

    // 1. Create branches table if not exists
    const branchesTableExists = await tableExists(queryInterface, "branches");

    if (!branchesTableExists) {
      await queryInterface.createTable("branches", {
        id: {
          type: DataTypes.STRING,
          primaryKey: true,
        },
        company_id: {
          type: DataTypes.STRING,
          allowNull: false,
          references: {
            model: "companies",
            key: "id",
          },
          onUpdate: "CASCADE",
          onDelete: "CASCADE",
        },
        name: {
          type: DataTypes.STRING,
          allowNull: false,
        },
        code: {
          type: DataTypes.STRING,
          allowNull: false,
        },
        type: {
          type: DataTypes.ENUM("store", "warehouse", "factory"),
          allowNull: false,
          defaultValue: "store",
        },
        address: {
          type: DataTypes.STRING,
          allowNull: true,
        },
        phone: {
          type: DataTypes.STRING,
          allowNull: true,
        },
        manager_id: {
          type: DataTypes.STRING,
          allowNull: true,
        },
        is_active: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
        created_at: {
          type: DataTypes.DATE,
          allowNull: false,
        },
        updated_at: {
          type: DataTypes.DATE,
          allowNull: false,
        },
      });
    }

    // 2. Insert demo branches only if CMP-DEMO company already exists.
    // Important: migrations run before seeders, so CMP-DEMO may not exist yet.
    const companies = await queryInterface.sequelize.query(
      "SELECT id FROM companies",
      { type: QueryTypes.SELECT }
    );

    const demoCompany = companies.find((company) => company.id === "CMP-DEMO");

    if (demoCompany) {
      const defaultBranches = [
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
          updated_at: now,
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
          updated_at: now,
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
          updated_at: now,
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
          updated_at: now,
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
          updated_at: now,
        },
      ];

      const existingBranches = await queryInterface.sequelize.query(
        "SELECT id FROM branches WHERE id IN (:ids)",
        {
          replacements: {
            ids: defaultBranches.map((branch) => branch.id),
          },
          type: QueryTypes.SELECT,
        }
      );

      const existingBranchIds = new Set(existingBranches.map((branch) => branch.id));
      const branchesToInsert = defaultBranches.filter((branch) => !existingBranchIds.has(branch.id));

      if (branchesToInsert.length > 0) {
        await queryInterface.bulkInsert("branches", branchesToInsert);
      }
    }

    // 3. Add columns to assets
    await addColumnIfNotExists(queryInterface, "assets", "branch_id", {
      type: DataTypes.STRING,
      allowNull: true,
    });

    // 4. Add columns to invoices
    await addColumnIfNotExists(queryInterface, "invoices", "branch_id", {
      type: DataTypes.STRING,
      allowNull: true,
    });

    await addColumnIfNotExists(queryInterface, "invoices", "down_payment", {
      type: DataTypes.DECIMAL(15, 4),
      defaultValue: 0,
    });

    await addColumnIfNotExists(queryInterface, "invoices", "installment_count", {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    });

    await addColumnIfNotExists(queryInterface, "invoices", "guarantor_name", {
      type: DataTypes.STRING,
      allowNull: true,
    });

    await addColumnIfNotExists(queryInterface, "invoices", "guarantor_phone", {
      type: DataTypes.STRING,
      allowNull: true,
    });

    await addColumnIfNotExists(queryInterface, "invoices", "installment_frequency", {
      type: DataTypes.STRING,
      defaultValue: "monthly",
    });

    // 5. Add columns to employees
    await addColumnIfNotExists(queryInterface, "employees", "branch_id", {
      type: DataTypes.STRING,
      allowNull: true,
    });

    // 6. Add columns to transfers
    await addColumnIfNotExists(queryInterface, "transfers", "from_branch_id", {
      type: DataTypes.STRING,
      allowNull: true,
    });

    await addColumnIfNotExists(queryInterface, "transfers", "to_branch_id", {
      type: DataTypes.STRING,
      allowNull: true,
    });

    // 7. Add columns to audit_logs
    await addColumnIfNotExists(queryInterface, "audit_logs", "branch_id", {
      type: DataTypes.STRING,
      allowNull: true,
    });

    // 8. Migrate names to IDs
    const branchesMap = {
      "فرع دبي مول": "BR-DXB",
      "فرع أبوظبي": "BR-AUH",
      "فرع الشارقة": "BR-SHJ",
      "المستودع الرئيسي": "BR-WH",
      "المصنع": "BR-FAC",
      "Dubai Mall": "BR-DXB",
      "Abu Dhabi": "BR-AUH",
      "Sharjah": "BR-SHJ",
      "Main Warehouse": "BR-WH",
      "Factory": "BR-FAC",
    };

    for (const [name, id] of Object.entries(branchesMap)) {
      await queryInterface.sequelize.query(
        "UPDATE assets SET branch_id = :id WHERE branch = :name",
        {
          replacements: { id, name },
        }
      );

      await queryInterface.sequelize.query(
        "UPDATE employees SET branch_id = :id WHERE branch = :name",
        {
          replacements: { id, name },
        }
      );

      await queryInterface.sequelize.query(
        "UPDATE invoices SET branch_id = :id WHERE branch = :name",
        {
          replacements: { id, name },
        }
      );

      await queryInterface.sequelize.query(
        "UPDATE audit_logs SET branch_id = :id WHERE branch = :name",
        {
          replacements: { id, name },
        }
      );
    }

    // 9. Set fallback branch IDs for old records
    await queryInterface.sequelize.query(
      "UPDATE assets SET branch_id = 'BR-WH' WHERE branch_id IS NULL"
    );

    await queryInterface.sequelize.query(
      "UPDATE employees SET branch_id = 'BR-WH' WHERE branch_id IS NULL"
    );

    await queryInterface.sequelize.query(
      "UPDATE invoices SET branch_id = 'BR-DXB' WHERE branch_id IS NULL"
    );

    // 10. Migrate transfers
    await queryInterface.sequelize.query(
      "UPDATE transfers SET from_branch_id = 'BR-WH' WHERE from_branch = 'المستودع الرئيسي' OR from_branch = 'Main Warehouse'"
    );

    await queryInterface.sequelize.query(
      "UPDATE transfers SET from_branch_id = 'BR-DXB' WHERE from_branch = 'فرع دبي مول' OR from_branch = 'Dubai Mall'"
    );

    await queryInterface.sequelize.query(
      "UPDATE transfers SET to_branch_id = 'BR-DXB' WHERE to_branch = 'فرع دبي مول' OR to_branch = 'Dubai Mall'"
    );

    await queryInterface.sequelize.query(
      "UPDATE transfers SET to_branch_id = 'BR-SHJ' WHERE to_branch = 'فرع الشارقة' OR to_branch = 'Sharjah'"
    );
  },

  down: async (queryInterface) => {
    await removeColumnIfExists(queryInterface, "audit_logs", "branch_id");

    await removeColumnIfExists(queryInterface, "transfers", "to_branch_id");
    await removeColumnIfExists(queryInterface, "transfers", "from_branch_id");

    await removeColumnIfExists(queryInterface, "employees", "branch_id");

    await removeColumnIfExists(queryInterface, "invoices", "installment_frequency");
    await removeColumnIfExists(queryInterface, "invoices", "guarantor_phone");
    await removeColumnIfExists(queryInterface, "invoices", "guarantor_name");
    await removeColumnIfExists(queryInterface, "invoices", "installment_count");
    await removeColumnIfExists(queryInterface, "invoices", "down_payment");
    await removeColumnIfExists(queryInterface, "invoices", "branch_id");

    await removeColumnIfExists(queryInterface, "assets", "branch_id");

    const branchesTableExists = await tableExists(queryInterface, "branches");
    if (branchesTableExists) {
      await queryInterface.dropTable("branches");
    }

    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_branches_type";');
  },
};