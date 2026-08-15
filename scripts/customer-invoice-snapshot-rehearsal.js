"use strict";

// Disposable-clone-only proof for CUSTOMER-INVOICE-SNAPSHOT-IMPLEMENTATION-01.
// This script never connects a writable ORM process to Persistent or Acceptance.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { Client } = require("pg");
const { Sequelize } = require("sequelize");
const Umzug = require("umzug");

const ACCEPTANCE = "darfus_erp_inventory_rehearsal_20260804_160500z";
const PERSISTENT = "darfus_erp";
const MIGRATION = "20260814010000-customer-invoice-contact-snapshots.js";
const CLONE = `darfus_erp_invoice_snapshot_rehearsal_${Date.now()}`;
const PG_BIN = "C:\\Program Files\\PostgreSQL\\18\\bin";
const pgEnv = { ...process.env, PGHOST: "localhost", PGPORT: "5432", PGUSER: "postgres", PGPASSWORD: "postgres" };

function run(bin, args) {
  execFileSync(path.join(PG_BIN, bin), args, { env: pgEnv, stdio: "pipe" });
}

async function query(database, text, values = []) {
  const client = new Client({ host: "localhost", port: 5432, user: "postgres", password: "postgres", database });
  await client.connect();
  try { return await client.query(text, values); } finally { await client.end(); }
}

function assertClone() {
  if (!CLONE.startsWith("darfus_erp_invoice_snapshot_rehearsal_") || CLONE === ACCEPTANCE || CLONE === PERSISTENT) {
    throw new Error("SNAPSHOT_CLONE_TARGET_REJECTED");
  }
}

async function main() {
  assertClone();
  const dumpDir = fs.mkdtempSync(path.join(os.tmpdir(), "invoice-snapshot-"));
  const dump = path.join(dumpDir, "acceptance.dump");
  try {
    const source = await query(ACCEPTANCE, "SELECT current_database() AS db");
    if (source.rows[0].db !== ACCEPTANCE) throw new Error("ACCEPTANCE_SOURCE_TARGET_MISMATCH");
    run("pg_dump.exe", ["--format=custom", "--no-owner", "--no-privileges", `--file=${dump}`, ACCEPTANCE]);
    run("dropdb.exe", ["--if-exists", CLONE]);
    run("createdb.exe", [CLONE]);
    run("pg_restore.exe", ["--no-owner", "--no-privileges", "--exit-on-error", "--dbname", CLONE, dump]);

    const before = await query(CLONE, "SELECT current_database() AS db, (SELECT count(*)::int FROM invoices) AS invoices");
    if (before.rows[0].db !== CLONE) throw new Error("CLONE_TARGET_MISMATCH");
    const sequelize = new Sequelize(CLONE, "postgres", "postgres", { host: "localhost", port: 5432, dialect: "postgres", logging: false });
    try {
      const migrator = new Umzug({
        migrations: { path: path.join(__dirname, "../migrations"), params: [sequelize.getQueryInterface(), Sequelize] },
        storage: "sequelize",
        storageOptions: { sequelize, tableName: "SequelizeMeta" },
        logging: false,
      });
      const pending = (await migrator.pending()).map((entry) => path.basename(entry.file));
      if (pending.length !== 1 || pending[0] !== MIGRATION) throw new Error(`UNEXPECTED_PENDING:${pending.join(",")}`);
      await migrator.up({ migrations: [MIGRATION] });

      const cols = await query(CLONE, `SELECT column_name, data_type, is_nullable, character_maximum_length
        FROM information_schema.columns
        WHERE table_name = 'invoices' AND column_name IN ('customer_phone_snapshot','customer_address_snapshot')
        ORDER BY column_name`);
      if (cols.rowCount !== 2 || cols.rows.some((row) => row.is_nullable !== "YES")) throw new Error("SNAPSHOT_SCHEMA_INVALID");
      const after = await query(CLONE, "SELECT count(*)::int AS invoices, count(*) FILTER (WHERE customer_phone_snapshot IS NULL AND customer_address_snapshot IS NULL)::int AS old_nulls FROM invoices");
      if (Number(after.rows[0].invoices) !== Number(before.rows[0].invoices) || Number(after.rows[0].old_nulls) !== Number(after.rows[0].invoices)) throw new Error("OLD_INVOICE_ROWS_CHANGED");

      process.env.NODE_ENV = "development";
      process.env.DATABASE_URL = "";
      process.env.DB_NAME = CLONE;
      const models = require("../src/models");
      const { buildCustomerContactSnapshot, copyInvoiceContactSnapshot } = require("../src/services/invoice-contact-snapshot.service");
      const company = (await models.Company.findOne({ order: [["createdAt", "ASC"]] })).toJSON();
      const marker = `SNAP-${Date.now()}`;
      const customer = await models.Customer.create({ id: `${marker}-CUS`, companyId: company.id, name: "N1", phone: "P1", addresses: [{ line1: "A1", city: "C1", country: "U1", isPrimary: true }] });
      const c1 = buildCustomerContactSnapshot(customer);
      const i1 = await models.Invoice.create({ id: `${marker}-I1`, companyId: company.id, customerId: customer.id, customerName: customer.name, ...c1, type: "sale", date: "2026-08-14", total: 10, tax: 0, status: "paid", paymentMethod: "cash", branch: "Clone" });
      await customer.update({ name: "N2", phone: "P2", addresses: [{ line1: "A2", city: "C2", country: "U2", isPrimary: true }] });
      const c2 = buildCustomerContactSnapshot(customer);
      const i2 = await models.Invoice.create({ id: `${marker}-I2`, companyId: company.id, customerId: customer.id, customerName: customer.name, ...c2, type: "sale", date: "2026-08-14", total: 10, tax: 0, status: "paid", paymentMethod: "cash", branch: "Clone" });
      const copied = copyInvoiceContactSnapshot(i1);
      const derived = await models.Invoice.create({ id: `${marker}-DERIVED`, companyId: company.id, customerId: customer.id, customerName: i1.customerName, ...copied, type: "return", date: "2026-08-14", total: -10, tax: 0, status: "returned", paymentMethod: "cash", branch: "Clone", relatedInvoiceId: i1.id });
      const rows = [i1, i2, derived].map((row) => row.toJSON());
      if (rows[0].customerName !== "N1" || rows[0].customerPhoneSnapshot !== "P1" || rows[0].customerAddressSnapshot.line1 !== "A1") throw new Error("I1_CAPTURE_FAILED");
      if (rows[1].customerName !== "N2" || rows[1].customerPhoneSnapshot !== "P2" || rows[1].customerAddressSnapshot.line1 !== "A2") throw new Error("I2_CAPTURE_FAILED");
      if (rows[2].customerPhoneSnapshot !== "P1" || rows[2].customerAddressSnapshot.line1 !== "A1") throw new Error("DERIVED_COPY_FAILED");
      const fake = { customerPhoneSnapshot: "FAKE", customerAddressSnapshot: { line1: "FAKE", isPrimary: true } };
      const serverSnapshot = buildCustomerContactSnapshot(customer);
      if (fake.customerPhoneSnapshot === serverSnapshot.customerPhoneSnapshot || serverSnapshot.customerAddressSnapshot.line1 !== "A2") throw new Error("CLIENT_OVERRIDE_PROOF_FAILED");
      console.log(JSON.stringify({ database: CLONE, migration: MIGRATION, columns: cols.rows, invoiceCountBefore: Number(before.rows[0].invoices), invoiceCountAfterMigration: Number(after.rows[0].invoices), oldNullSnapshots: Number(after.rows[0].old_nulls), i1: { name: rows[0].customerName, phone: rows[0].customerPhoneSnapshot, address: rows[0].customerAddressSnapshot }, i2: { name: rows[1].customerName, phone: rows[1].customerPhoneSnapshot, address: rows[1].customerAddressSnapshot }, derived: { phone: rows[2].customerPhoneSnapshot, address: rows[2].customerAddressSnapshot }, clientOverride: "BLOCKED_BY_SERVER_MAPPER" }));
      await models.sequelize.close();
    } finally {
      await sequelize.close();
    }
  } finally {
    try { run("dropdb.exe", ["--if-exists", CLONE]); } finally { fs.rmSync(dumpDir, { recursive: true, force: true }); }
  }
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
