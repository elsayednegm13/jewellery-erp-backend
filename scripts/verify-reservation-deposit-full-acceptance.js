"use strict";

// CONT13 fully fixture-owned local acceptance verifier. All final financial effects
// are created through reservationService transactions, never by direct insert.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..", "..");
const { assertAdoptedLocalDatabase } = require(root + "/scripts/lib/verify-local-database-guard");
require(root + "/backend/node_modules/dotenv").config({ path: root + "/backend/.env" });
const models = require(root + "/backend/src/models");
const reservationService = require(root + "/backend/src/services/reservation.service");
const postingService = require(root + "/backend/src/services/posting.service");
const depositReceiptService = require(root + "/backend/src/services/reservation-deposit-receipt.service");
const idempotencyService = require(root + "/backend/src/services/idempotency.service");
models.sequelize.options.logging = false;
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const ns = process.argv.find(x => x.startsWith("--namespace="))?.slice(12) || `ACC-DEPOSIT-CONT5-C13-${stamp}`;
const id = suffix => `${ns}-${suffix}`;
const actor = { id: id("USER"), firstName: "Acceptance", lastName: "C13", name: "Acceptance C13", role: "admin", accountType: "legacy" };
const A = id("CMP-A"), B = id("CMP-B");
const q = (sql, bind = []) => models.sequelize.query(sql, { bind });
const out = (name, value = {}) => console.log(`MARKER ${name} ${JSON.stringify(value)}`);
const money = n => Number(n).toFixed(4);
const code = e => e?.errorCode || e?.code || e?.original?.code || "ERROR";
const importOnly = process.argv.includes("--import-only");
const c16C1 = ns.startsWith("ACC-DEPOSIT-CONT5-C16-C1-");
const c16C2 = ns.startsWith("ACC-DEPOSIT-CONT5-C16-C2-");
const c16C3 = ns.startsWith("ACC-DEPOSIT-CONT5-C16-C3-");
const c16C4 = ns.startsWith("ACC-DEPOSIT-CONT5-C16-C4-");
const c16C5 = ns.startsWith("ACC-DEPOSIT-CONT5-C16-C5-");
const c16C6 = ns.startsWith("ACC-DEPOSIT-CONT5-C16-C6-");
const c16C7 = ns.startsWith("ACC-DEPOSIT-CONT5-C16-C7-");
const c16C8 = ns.startsWith("ACC-DEPOSIT-CONT5-C16-C8-");
const c16C9 = ns.startsWith("ACC-DEPOSIT-CONT5-C16-C9-");
const c16C10 = ns.startsWith("ACC-DEPOSIT-CONT5-C16-C10-");
const c16C11 = ns.startsWith("ACC-DEPOSIT-CONT5-C16-C11-");
const c16C12 = ns.startsWith("ACC-DEPOSIT-CONT5-C16-C12-");
const c16C13 = ns.startsWith("ACC-DEPOSIT-CONT5-C16-C13-");
const c16C14 = ns.startsWith("ACC-DEPOSIT-CONT5-C16-C14-");
const c16C15 = /^ACC-DEPOSIT-CONT5-C16-C15-RUN[12]-/.test(ns);
const evidenceOut = process.argv.find(x => x.startsWith("--evidence-out="))?.slice(15);
const compareEvidence = process.argv.find(x => x.startsWith("--compare-evidence="))?.slice(19);
const cells = [];
const isAllowedNamespace = value => /^ACC-DEPOSIT-CONT5-C1(3|4|6-C(?:[123456789]|1[0-4]|15-RUN[12]))-[A-Za-z0-9-]+$/.test(value);
async function runMandatoryCell(spec) { const r={id:spec.id,title:spec.title,status:"FAIL",expected:spec.expected}; try { await spec.run(r); r.status="PASS"; } catch(e){r.actual=e.message;r.errorCode=code(e);throw e;} finally {cells.push(r);out("MANDATORY_CELL",r);} return r; }
async function runConfigurationCell(matrix, spec) { const r={id:spec.id,operation:spec.operation,scenario:spec.scenario,expected:spec.expected,status:"FAIL"}; try { r.before=await spec.before(); await spec.execute(); r.after=await spec.after(); if(spec.assert) await spec.assert(r); r.writesDelta=JSON.stringify(r.after)===JSON.stringify(r.before)?"zero":"changed";r.actual=spec.actual||"proved";r.status="PASS"; } catch(e) { r.actual=e.message;r.errorCode=code(e);r.status="FAIL";throw e; } finally { matrix.cells.push(r);out("CONFIGURATION_CELL",r); } return r; }

// PostgreSQL NUMERIC values are compared in fixed-point units.  Acceptance
// equations must never depend on JavaScript binary floating-point arithmetic.
function decimalUnits(value, scale = 8) {
  const raw = String(value ?? 0).trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(raw);
  assert.ok(match, `invalid decimal value: ${raw}`);
  const [, negative, whole, fraction = ""] = match;
  assert.ok(fraction.length <= scale || /^0+$/.test(fraction.slice(scale)), `decimal precision exceeds ${scale}: ${raw}`);
  const normalizedFraction = fraction.slice(0, scale).padEnd(scale, "0");
  const units = BigInt(whole) * (10n ** BigInt(scale)) + BigInt(normalizedFraction || "0");
  return negative ? -units : units;
}
function assertUnitsEqual(actual, expected, message) {
  assert.equal(decimalUnits(actual), decimalUnits(expected), message);
}
function signedLineMovement(line, nature) {
  const debit = decimalUnits(line.debit);
  const credit = decimalUnits(line.credit);
  return nature === "debit" ? debit - credit : credit - debit;
}
function assertJournalBalance(journal) {
  assert.ok(journal.lines.length > 0, `journal ${journal.id} must have lines`);
  const debits = journal.lines.reduce((sum, line) => sum + decimalUnits(line.debit), 0n);
  const credits = journal.lines.reduce((sum, line) => sum + decimalUnits(line.credit), 0n);
  assert.equal(debits, credits, `journal ${journal.id} must balance from its lines`);
  assert.equal(debits, decimalUnits(journal.totalDebit), `journal ${journal.id} debit header must reconcile`);
  assert.equal(credits, decimalUnits(journal.totalCredit), `journal ${journal.id} credit header must reconcile`);
  for (const line of journal.lines) {
    const debit = decimalUnits(line.debit), credit = decimalUnits(line.credit);
    assert.ok(debit >= 0n && credit >= 0n, `journal ${journal.id} has a negative line`);
    assert.ok(debit > 0n || credit > 0n, `journal ${journal.id} has an empty line`);
    assert.ok(!(debit > 0n && credit > 0n), `journal ${journal.id} line ${line.id} has both debit and credit`);
  }
}
async function withScopedFailure({target,method,errorCode,verifyArgs,run}) { const original=target[method]; let transaction; target[method]=async (...args)=>{ const opts=args.at(-1); transaction=opts?.transaction; assert.ok(transaction && typeof transaction.rollback === "function","scoped failure requires the real transaction object"); if (verifyArgs) verifyArgs(...args); const e=new Error(errorCode);e.errorCode=errorCode;throw e; }; try{return await run(()=>({present:Boolean(transaction),finished:transaction?.finished||null}));} finally {target[method]=original; assert.equal(target[method],original,"scoped failure restored");} }

function assertWriteGuard() {
  if (importOnly) return;
  assert.ok(isAllowedNamespace(ns), "write namespace must be C13/C14/C16-C1 through C16-C12-owned");
  assert.equal(process.env.VERIFY_RESERVATION_DEPOSIT_FULL_ACCEPTANCE, "true", "explicit full-acceptance write confirmation is required");
  assert.equal(process.env.VERIFY_FULLY_OWNED_FIXTURES, "true", "explicit fully-owned-fixture confirmation is required");
  assertAdoptedLocalDatabase({ riskClass: "V3_WRITE_CLEANUP" });
}

async function target() {
  const [r] = await q('select current_database() db,current_schema() schema,inet_server_addr()::text host,inet_server_port() port,(select count(*)::int from "SequelizeMeta") migrations');
  assert.equal(process.env.NODE_ENV || "development", "development");
  assert.equal(r[0].db, "darfus_erp"); assert.equal(r[0].schema, "public"); assert.equal(Number(r[0].port), 5432); assert.equal(r[0].migrations, 50);
  out("DB_TARGET_PASS", r[0]);
}
async function tableCounts(companyIds) {
  const [r] = await q(`select
 (select count(*)::int from companies where id=any($1::text[])) companies,
 (select count(*)::int from reservations where company_id=any($1::text[])) reservations,
 (select count(*)::int from reservation_items where company_id=any($1::text[])) reservation_items,
 (select count(*)::int from reservation_payments where company_id=any($1::text[])) payments,
 (select count(*)::int from reservation_deposit_receipt_documents where company_id=any($1::text[])) receipts,
 (select count(*)::int from reservation_refunds where company_id=any($1::text[])) refunds,
 (select count(*)::int from reservation_refund_allocations where company_id=any($1::text[])) refund_allocations,
 (select count(*)::int from reservation_payment_applications where company_id=any($1::text[])) applications,
 (select count(*)::int from cash_transactions where company_id=any($1::text[])) cash_transactions,
 (select count(*)::int from journal_entries where company_id=any($1::text[])) journals,
 (select count(*)::int from journal_lines where journal_entry_id in (select id from journal_entries where company_id=any($1::text[]))) journal_lines,
 (select count(*)::int from invoices where company_id=any($1::text[])) invoices,
 (select count(*)::int from stock_movements where company_id=any($1::text[])) stock_movements,
 (select count(*)::int from accounts where company_id=any($1::text[])) accounts,
 (select count(*)::int from system_account_roles where company_id=any($1::text[])) system_account_roles,
 (select count(*)::int from branch_financial_mappings where company_id=any($1::text[])) branch_financial_mappings,
 (select count(*)::int from cash_register_sessions where company_id=any($1::text[])) cash_register_sessions,
 (select count(*)::int from idempotency_requests where company_id=any($1::text[])) idempotency,
 (select count(*)::int from audit_logs where company_id=any($1::text[])) audit_logs`, [companyIds]);
  return r[0];
}
async function expectFail(name, fn, expected) {
  let error; try { await fn(); } catch (e) { error = e; }
  assert.ok(error, name + " must fail");
  if (expected) assert.equal(code(error), expected, name + " code");
  out("FAIL_CLOSED_PASS", { name, code: code(error) });
}
async function companyBranch(companyId, suffix) {
  const branchId = id("BR-" + suffix);
  if (!await models.Company.findByPk(companyId)) {
    await models.Company.create({ id: companyId, businessName: "C13 " + suffix, workspace: id("WS-" + suffix).toLowerCase(), currency: "AED", branchName: "C13 " + suffix });
  }
  await models.Branch.create({ id: branchId, companyId, name: "C13 " + suffix, code: "C13" + suffix, type: "store", isActive: true });
  return branchId;
}
async function accounts(companyId, branchId) {
  const def = [["2300","Reservation Advance","liability","credit"],["1110","Cash Treasury","asset","debit"],["1300","Accounts Receivable","asset","debit"],["4100","Sales Revenue","revenue","credit"],["2200","VAT Payable","liability","credit"],["1200","Inventory Asset","asset","debit"],["5000","Cost of Goods Sold","expense","debit"]];
  const result = {};
  for (const [accountCode,name,type,nature] of def) {
    const row = await models.Account.create({ id:id("ACC-"+branchId.slice(-7)+"-"+accountCode),companyId,branchId,code:accountCode,name,nameAr:name,type,nature,balance:0,isActive:true,level:2 });
    result[accountCode] = row;
  }
  for (const [mappingType, account] of [["RESERVATION_ADVANCE_LIABILITY",result["2300"]],["CASH_TREASURY",result["1110"]]]) {
    await models.BranchFinancialMapping.create({id:id("MAP-"+branchId.slice(-7)+"-"+mappingType),companyId,branchId,mappingType,channel:null,accountId:account.id,isActive:true,createdBy:actor.id,updatedBy:actor.id});
  }
  const finalSaleRoles = { accountsReceivable: "ACCOUNTS_RECEIVABLE", salesRevenue: "SALES_REVENUE", vatPayable: "VAT_PAYABLE", inventoryAsset: "INVENTORY_ASSET", costOfGoodsSold: "COST_OF_GOODS_SOLD", reservationAdvanceLiability: "CUSTOMER_DEPOSIT_LIABILITY" };
  const finalSale = {};
  const accountForRole = { accountsReceivable: result["1300"], salesRevenue: result["4100"], vatPayable: result["2200"], inventoryAsset: result["1200"], costOfGoodsSold: result["5000"], reservationAdvanceLiability: result["2300"] };
  for (const [key, roleCode] of Object.entries(finalSaleRoles)) {
    const account = accountForRole[key];
    const role = await models.SystemAccountRole.create({ id:id("SAR-"+branchId.slice(-7)+"-"+roleCode),companyId,branchId,roleCode,accountId:account.id,createdBy:actor.id,updatedBy:actor.id });
    finalSale[key] = { account, role };
  }
  const session = await models.CashRegisterSession.create({id:id("SESSION-"+branchId.slice(-7)),companyId,branchId,cashAccountCode:"1110",status:"OPEN",openedAt:new Date(),openedByUserId:actor.id,openedByName:actor.name,openingCountedAmount:0});
  return { ...result, session, finalSale };
}
async function reservation(companyId, branchId, tag, total, initial = 1) {
  const customerId=id("CUS-"+tag),assetId=id("AST-"+tag),reservationId=id("RES-"+tag);
  await models.Customer.create({id:customerId,companyId,name:"C13 "+tag,phone:"055"+String(tag).replace(/\\D/g,"").slice(-7).padStart(7,"0"),status:"active"});
  await models.BranchCustomer.create({id:id("BC-"+tag),companyId,branchId,customerId,isActive:true});
  await models.Asset.create({id:assetId,companyId,name:"C13 "+tag,type:"gold-piece",category:"Acceptance",karat:21,grossWeight:1,netWeight:1,goldWeight:1,price:total,cost:10,branch:"C13",branchId,location:"Acceptance",status:"available",barcode:id("BAR-"+tag)});
  const r = await reservationService.createReservation({companyId,branchId,user:actor,idempotencyKey:id("CREATE-"+tag),body:{id:reservationId,customerId,items:[{assetId,agreedPrice:money(total)}],expiresAt:"2027-12-31",initialPayment:{amount:money(initial),paymentMethod:"cash"}}});
  assert.equal(r.statusCode,201); return {reservationId,customerId,assetId};
}
async function pay(companyId,branchId,reservationId,amount,key,body={}) {
  const r=await reservationService.addPayment({companyId,branchId,user:actor,reservationId,idempotencyKey:id(key),body:{amount:money(amount),paymentMethod:"cash",...body}});
  assert.equal(r.statusCode,201); return r;
}
async function countsFor(companyId,reservationId) {
  const [r]=await q(`select
 (select coalesce(sum(amount),0)::numeric from reservation_payments where company_id=$1 and reservation_id=$2 and status='posted') received,
 (select coalesce(sum(amount),0)::numeric from reservation_refunds where company_id=$1 and reservation_id=$2 and status='executed') refunded,
 (select coalesce(sum(applied_amount),0)::numeric from reservation_payment_applications where company_id=$1 and reservation_id=$2) applied,
 (select count(*)::int from reservation_deposit_receipt_documents where company_id=$1 and reservation_id=$2) receipts,
 (select count(*)::int from cash_transactions where company_id=$1 and (reference in (select id from reservation_payments where company_id=$1 and reservation_id=$2) or reference in (select id from reservation_refunds where company_id=$1 and reservation_id=$2))) cash`,[companyId,reservationId]);
  return Object.fromEntries(Object.entries(r[0]).map(([k,v])=>[k,Number(v)]));
}
async function rollbackSnapshot(companyId,reservationId,key) {
  const [r]=await q(`select
 (select count(*)::int from reservation_payments where company_id=$1 and reservation_id=$2) payments,
 (select count(*)::int from reservation_deposit_receipt_documents where company_id=$1 and reservation_id=$2) receipts,
 (select count(*)::int from cash_transactions where company_id=$1 and reference in (select id from reservation_payments where company_id=$1 and reservation_id=$2)) cash_transactions,
 (select count(*)::int from journal_entries where company_id=$1 and source_type='reservation_payment' and source_id in (select id from reservation_payments where company_id=$1 and reservation_id=$2)) journals,
 (select count(*)::int from journal_lines where journal_entry_id in (select id from journal_entries where company_id=$1 and source_type='reservation_payment' and source_id in (select id from reservation_payments where company_id=$1 and reservation_id=$2))) journal_lines,
 (select count(*)::int from idempotency_requests where company_id=$1 and key=$3 and status='succeeded') success_idempotency,
 (select count(*)::int from idempotency_requests where company_id=$1 and key=$3) idempotency_rows,
 (select max(status) from idempotency_requests where company_id=$1 and key=$3) idempotency_status,
 (select coalesce(bool_or(response_body is not null),false) from idempotency_requests where company_id=$1 and key=$3) idempotency_response_present,
 (select count(*)::int from audit_logs where company_id=$1 and source_document=$2) success_audit,
 (select count(*)::int from reservation_deposit_receipt_sequences where company_id=$1) receipt_sequences,
 (select status from reservations where company_id=$1 and id=$2) reservation_status`,[companyId,reservationId,id(key)]);
  return r[0];
}
async function refundSnapshot(companyId,reservationId,refundId,key) {
  const [r]=await q(`select
 (select status from reservation_refunds where id=$3 and company_id=$1) refund_status,
 (select executed_at is not null from reservation_refunds where id=$3 and company_id=$1) refund_executed_at,
 (select cash_transaction_id from reservation_refunds where id=$3 and company_id=$1) refund_cash_transaction_id,
 (select journal_entry_id from reservation_refunds where id=$3 and company_id=$1) refund_journal_entry_id,
 (select count(*)::int from reservation_refund_allocations where reservation_refund_id=$3) refund_allocations,
 (select count(*)::int from cash_transactions where company_id=$1 and reference=$3) refund_cash_transactions,
 (select count(*)::int from journal_entries where company_id=$1 and source_type='reservation_refund' and source_id=$3) refund_journals,
 (select count(*)::int from journal_lines where journal_entry_id in (select id from journal_entries where company_id=$1 and source_type='reservation_refund' and source_id=$3)) refund_journal_lines,
 (select count(*)::int from idempotency_requests where company_id=$1 and key=$4 and status='succeeded') success_idempotency,
 (select count(*)::int from idempotency_requests where company_id=$1 and key=$4) idempotency_rows,
 (select max(status) from idempotency_requests where company_id=$1 and key=$4) idempotency_status,
 (select count(*)::int from audit_logs where company_id=$1 and source_document=$2) success_audit,
 (select status from reservations where company_id=$1 and id=$2) reservation_status,
 (select refund_status from reservations where company_id=$1 and id=$2) reservation_refund_status,
 (select coalesce(sum(amount),0)::numeric from reservation_payments where company_id=$1 and reservation_id=$2 and status='posted') received,
 (select coalesce(sum(rf.amount),0)::numeric from reservation_refunds rf where rf.company_id=$1 and rf.reservation_id=$2 and rf.status='executed') refunded,
 (select count(*)::int from reservation_deposit_receipt_documents where company_id=$1 and reservation_id=$2) receipts,
 (select md5(coalesce(string_agg(snapshot::text,'' order by id),'')) from reservation_deposit_receipt_documents where company_id=$1 and reservation_id=$2) receipt_snapshot_digest`,[companyId,reservationId,refundId,id(key)]);
  return r[0];
}
async function refundJournalSnapshot(companyId,branchId,reservationId,refundId,key) {
  const base=await refundSnapshot(companyId,reservationId,refundId,key);
  const [r]=await q(`select
 (select coalesce(sum(jl.debit),0)::numeric from journal_lines jl join journal_entries je on je.id=jl.journal_entry_id where je.company_id=$1 and je.source_type='reservation_refund' and je.source_id=$3) refund_journal_debits,
 (select coalesce(sum(jl.credit),0)::numeric from journal_lines jl join journal_entries je on je.id=jl.journal_entry_id where je.company_id=$1 and je.source_type='reservation_refund' and je.source_id=$3) refund_journal_credits,
 (select coalesce(sum(jl.debit),0)::numeric from journal_lines jl join journal_entries je on je.id=jl.journal_entry_id where je.company_id=$1 and je.source_type='reservation_refund' and je.source_id=$3 and jl.account_code='2300') liability_debits,
 (select coalesce(sum(jl.credit),0)::numeric from journal_lines jl join journal_entries je on je.id=jl.journal_entry_id where je.company_id=$1 and je.source_type='reservation_refund' and je.source_id=$3 and jl.account_code='1110') treasury_credits,
 (select max(company_id) from journal_entries where company_id=$1 and source_type='reservation_refund' and source_id=$3) refund_journal_company,
 (select max(branch_id) from journal_entries where company_id=$1 and source_type='reservation_refund' and source_id=$3) refund_journal_branch,
 (select balance::numeric from accounts where company_id=$1 and branch_id=$2 and code='2300') liability_balance,
 (select balance::numeric from accounts where company_id=$1 and branch_id=$2 and code='1110') treasury_balance,
 (select system_expected_amount::numeric from cash_register_sessions where company_id=$1 and branch_id=$2 order by opened_at desc limit 1) session_expected_amount,
 (select final_invoice_id from reservations where company_id=$1 and id=$4) final_invoice_id,
 (select count(*)::int from stock_movements where company_id=$1 and asset_id in (select asset_id from reservation_items where company_id=$1 and reservation_id=$4)) stock_movements`,[companyId,branchId,refundId,reservationId]);
  return {...base,...r[0]};
}
async function refundAllocationSnapshot(companyId,branchId,reservationId,refundId,key) {
  const base=await refundJournalSnapshot(companyId,branchId,reservationId,refundId,key);
  const [r]=await q(`select
 (select coalesce(sum(allocated_amount),0)::numeric from reservation_refund_allocations where company_id=$1 and reservation_refund_id=$4) allocation_total,
 (select count(*)::int from reservation_refund_allocations where company_id=$1 and reservation_refund_id=$4 and allocated_amount<=0) non_positive_allocations,
 (select count(*)::int from reservation_refund_allocations a left join reservation_payments p on p.id=a.reservation_payment_id and p.company_id=a.company_id left join reservation_refunds rf on rf.id=a.reservation_refund_id and rf.company_id=a.company_id where a.company_id=$1 and a.reservation_refund_id=$4 and (p.id is null or p.reservation_id<>$3 or rf.reservation_id<>$3 or rf.branch_id<>$2)) invalid_scope_allocations,
 (select coalesce(string_agg(reservation_payment_id || ':' || allocated_amount::text,',' order by reservation_payment_id),'') from reservation_refund_allocations where company_id=$1 and reservation_refund_id=$4) allocation_links,
 (select coalesce(sum(amount),0)::numeric from reservation_payments where company_id=$1 and reservation_id=$3 and status='posted') total_received,
 (select coalesce(sum(amount),0)::numeric from reservation_refunds where company_id=$1 and reservation_id=$3 and status='executed') total_executed_refunds`,[companyId,branchId,reservationId,refundId]);
  return {...base,...r[0],refundable_balance:Number(r[0].total_received)-Number(r[0].total_executed_refunds),remaining_liability:Number(r[0].total_received)-Number(r[0].total_executed_refunds)};
}
async function refundIdempotencySnapshot(companyId,branchId,reservationId,refundId,key) {
  const base=await refundAllocationSnapshot(companyId,branchId,reservationId,refundId,key);
  const [r]=await q(`select
 (select coalesce(bool_or(response_body is not null),false) from idempotency_requests where company_id=$1 and key=$3 and scope='reservation.refund.execute') idempotency_response_present,
 (select max(response_body #>> '{data,refund,id}') from idempotency_requests where company_id=$1 and key=$3 and scope='reservation.refund.execute') idempotency_refund_id,
 (select count(*)::int from idempotency_requests where company_id=$1 and key=$3 and scope='reservation.refund.execute' and status='succeeded') succeeded_refund_idempotency,
 (select count(*)::int from audit_logs where company_id=$1 and source_document=$2 and action='reservation.refund_executed') refund_execution_audit`,[companyId,reservationId,id(key)]);
  return {...base,...r[0]};
}
async function completeSaleSnapshot(companyId,branchId,reservationId,assetId,key) {
  const [r]=await q(`select
 (select count(*)::int from branches where company_id=$1 and id=$2) scoped_branch,
 (select status from reservations where company_id=$1 and id=$3) reservation_status,
 (select completed_at is not null from reservations where company_id=$1 and id=$3) reservation_completed_at,
 (select final_invoice_id from reservations where company_id=$1 and id=$3) final_invoice_id,
 (select paid_total::numeric from reservations where company_id=$1 and id=$3) reservation_paid_total,
 (select remaining_total::numeric from reservations where company_id=$1 and id=$3) reservation_remaining_total,
 (select count(*)::int from invoices where company_id=$1 and related_invoice_id=$3) invoices,
 (select max(id) from invoices where company_id=$1 and related_invoice_id=$3) invoice_id,
 (select max(invoice_number) from invoices where company_id=$1 and related_invoice_id=$3) invoice_number,
 (select coalesce(sum(total),0)::numeric from invoices where company_id=$1 and related_invoice_id=$3) invoice_total,
 (select coalesce(sum(tax),0)::numeric from invoices where company_id=$1 and related_invoice_id=$3) invoice_tax,
 (select coalesce(sum(paid_amount),0)::numeric from invoices where company_id=$1 and related_invoice_id=$3) invoice_paid,
 (select coalesce(sum(remaining_amount),0)::numeric from invoices where company_id=$1 and related_invoice_id=$3) invoice_remaining,
 (select count(*)::int from invoice_items where invoice_id in (select id from invoices where company_id=$1 and related_invoice_id=$3)) invoice_items,
 (select count(*)::int from reservation_payment_applications where company_id=$1 and reservation_id=$3) applications,
 (select coalesce(sum(applied_amount),0)::numeric from reservation_payment_applications where company_id=$1 and reservation_id=$3) application_total,
 (select count(*)::int from stock_movements where company_id=$1 and asset_id=$4 and reference_type='reservation_final_sale') stock_movements,
 (select count(*)::int from asset_events where asset_id=$4 and action='SALE') sale_asset_events,
 (select status from assets where company_id=$1 and id=$4) asset_status,
 (select status from reservation_items where company_id=$1 and reservation_id=$3 and asset_id=$4) reservation_item_status,
 (select count(*)::int from journal_entries where company_id=$1 and ((source_type='invoice' and source_id in (select id from invoices where company_id=$1 and related_invoice_id=$3)) or (source_type='reservation_settlement' and source_id=$3))) sale_journals,
 (select count(*)::int from journal_lines where journal_entry_id in (select id from journal_entries where company_id=$1 and ((source_type='invoice' and source_id in (select id from invoices where company_id=$1 and related_invoice_id=$3)) or (source_type='reservation_settlement' and source_id=$3)))) sale_journal_lines,
 (select coalesce(sum(total_debit),0)::numeric from journal_entries where company_id=$1 and ((source_type='invoice' and source_id in (select id from invoices where company_id=$1 and related_invoice_id=$3)) or (source_type='reservation_settlement' and source_id=$3))) sale_journal_debits,
 (select coalesce(sum(total_credit),0)::numeric from journal_entries where company_id=$1 and ((source_type='invoice' and source_id in (select id from invoices where company_id=$1 and related_invoice_id=$3)) or (source_type='reservation_settlement' and source_id=$3))) sale_journal_credits,
 (select count(*)::int from journal_entries where company_id=$1 and ((source_type='invoice' and source_id in (select id from invoices where company_id=$1 and related_invoice_id=$3)) or (source_type='reservation_settlement' and source_id=$3)) and total_debit<>total_credit) unbalanced_sale_journals,
 (select coalesce(sum(balance),0)::numeric from accounts where company_id=$1 and code='1300') ar_balance,
 (select coalesce(sum(balance),0)::numeric from accounts where company_id=$1 and code='2300') liability_balance,
 (select coalesce(sum(balance),0)::numeric from accounts where company_id=$1 and code='4100') revenue_balance,
 (select coalesce(sum(balance),0)::numeric from accounts where company_id=$1 and code='2200') vat_balance,
 (select coalesce(sum(balance),0)::numeric from accounts where company_id=$1 and code='5000') cogs_balance,
 (select coalesce(sum(balance),0)::numeric from accounts where company_id=$1 and code='1200') inventory_balance,
 (select count(*)::int from idempotency_requests where company_id=$1 and key=$5 and scope='reservation.complete') idempotency_rows,
 (select count(*)::int from idempotency_requests where company_id=$1 and key=$5 and scope='reservation.complete' and status='succeeded') success_idempotency,
 (select max(status) from idempotency_requests where company_id=$1 and key=$5 and scope='reservation.complete') idempotency_status,
 (select coalesce(bool_or(response_body is not null),false) from idempotency_requests where company_id=$1 and key=$5 and scope='reservation.complete') idempotency_response_present,
 (select max(response_body #>> '{data,invoice,id}') from idempotency_requests where company_id=$1 and key=$5 and scope='reservation.complete') idempotency_invoice_id,
 (select count(*)::int from audit_logs where company_id=$1 and source_document=$3 and action='reservation.completed') completion_audit,
 (select count(*)::int from reservation_deposit_receipt_documents where company_id=$1 and reservation_id=$3) receipts,
 (select md5(coalesce(string_agg(snapshot::text,'' order by id),'')) from reservation_deposit_receipt_documents where company_id=$1 and reservation_id=$3) receipt_snapshot_digest`,[companyId,branchId,reservationId,assetId,id(key)]);
  return r[0];
}
async function noRowsCase(name, companyId, reservationId, fn, expected) {
  const before=await countsFor(companyId,reservationId); await expectFail(name,fn,expected); const after=await countsFor(companyId,reservationId);
  assert.deepEqual(after,before,name+" must not create financial rows"); out("ZERO_ROW_PASS",{name,before,after});
}
async function configurationSnapshot(companyId,reservationId) {
  const [r]=await q(`select
 (select status from reservations where company_id=$1 and id=$2) reservation_status,
 (select count(*)::int from reservation_payments where company_id=$1 and reservation_id=$2) payments,
 (select count(*)::int from reservation_deposit_receipt_documents where company_id=$1 and reservation_id=$2) receipts,
 (select count(*)::int from reservation_refunds where company_id=$1 and reservation_id=$2) refunds,
 (select count(*)::int from reservation_refund_allocations where company_id=$1 and reservation_refund_id in (select id from reservation_refunds where company_id=$1 and reservation_id=$2)) refund_allocations,
 (select count(*)::int from invoices where company_id=$1 and related_invoice_id=$2) invoices,
 (select count(*)::int from reservation_payment_applications where company_id=$1 and reservation_id=$2) applications,
 (select count(*)::int from cash_transactions where company_id=$1 and (reference in (select id from reservation_payments where company_id=$1 and reservation_id=$2) or reference in (select id from reservation_refunds where company_id=$1 and reservation_id=$2))) cash_transactions,
 (select count(*)::int from journal_entries where company_id=$1 and (source_id=$2 or source_id in (select id from reservation_payments where company_id=$1 and reservation_id=$2) or source_id in (select id from reservation_refunds where company_id=$1 and reservation_id=$2) or source_id in (select id from invoices where company_id=$1 and related_invoice_id=$2))) journals,
 (select count(*)::int from stock_movements where company_id=$1 and asset_id in (select asset_id from reservation_items where company_id=$1 and reservation_id=$2)) stock_movements,
 (select count(*)::int from audit_logs where company_id=$1 and source_document=$2) audit_logs,
 (select count(*)::int from accounts where company_id=$1) accounts,
 (select count(*)::int from system_account_roles where company_id=$1) system_account_roles,
 (select coalesce(sum(balance),0)::numeric from accounts where company_id=$1) account_balance`,[companyId,reservationId]);
  return r[0];
}
async function configurationAndNoFallbackMatrix(A1,A2,B1,a1,a2,b1) {
  const matrix={id:"CONFIGURATION_AND_NO_FALLBACK_MATRIX",title:"Configuration and no-fallback matrix",status:"FAIL",total:0,passed:0,failed:0,skipped:0,cells:[],notes:"All cells use only the C16-C12 owned topology."};
  await runMandatoryCell({id:matrix.id,title:matrix.title,expected:"branch-scoped Deposit and Refund guards reject missing, invalid and cross-scope configuration without writes; Complete-sale must not silently select posting accounts",run:async result=>{try{
    const deposit=await reservation(A,A1,"C12-D",20,1);
    const snap=()=>configurationSnapshot(A,deposit.reservationId);
    await runConfigurationCell(matrix,{id:"D-M1",operation:"Deposit",scenario:"valid A1 cash method/channel/session and mappings",expected:"one owned payment succeeds",before:snap,execute:async()=>{await pay(A,A1,deposit.reservationId,1,"C12-D-VALID");},after:snap,assert:r=>{assert.equal(r.after.payments,r.before.payments+1);assert.equal(r.after.receipts,r.before.receipts+1);assert.equal(r.after.cash_transactions,r.before.cash_transactions+1);assert.equal(r.after.journals,r.before.journals+1);},actual:"A1-scoped Deposit posted with its own liability, treasury and open cash session"});
    await runConfigurationCell(matrix,{id:"D-S3",operation:"Deposit",scenario:"closed authoritative A1 cash session",expected:"CASH_REGISTER_SESSION_REQUIRED and zero writes",before:snap,execute:async()=>{await a1.session.update({status:"CLOSED"});try{await expectFail("C12_CLOSED_SESSION",()=>pay(A,A1,deposit.reservationId,1,"C12-D-CLOSED"),"CASH_REGISTER_SESSION_REQUIRED");}finally{await a1.session.update({status:"OPEN"});}},after:snap,assert:r=>assert.deepEqual(r.after,r.before),actual:"closed A1 session failed closed; no sibling/default session was selected"});
    const liability=await models.BranchFinancialMapping.findOne({where:{companyId:A,branchId:A1,mappingType:"RESERVATION_ADVANCE_LIABILITY"}});
    await runConfigurationCell(matrix,{id:"D-A2-D-A10",operation:"Deposit",scenario:"missing active A1 liability mapping while A2/B1 mappings exist",expected:"DEPOSIT_LIABILITY_MAPPING_MISSING and zero writes; no Company or sibling-Branch fallback",before:snap,execute:async()=>{await liability.update({isActive:false});try{await expectFail("C12_MISSING_A1_LIABILITY",()=>pay(A,A1,deposit.reservationId,1,"C12-D-NOLIAB"),"DEPOSIT_LIABILITY_MAPPING_MISSING");}finally{await liability.update({isActive:true});}},after:snap,assert:r=>assert.deepEqual(r.after,r.before),actual:"missing A1 mapping failed closed despite owned A2 and B1 accounts"});
    await runConfigurationCell(matrix,{id:"D-M3-D-M4-D-M10",operation:"Deposit",scenario:"A2 branch and raw client financial authority against A1 Reservation",expected:"RESOURCE_NOT_FOUND / RAW_FINANCIAL_AUTHORITY_FORBIDDEN and zero writes",before:snap,execute:async()=>{await expectFail("C12_CROSS_BRANCH",()=>pay(A,A2,deposit.reservationId,1,"C12-D-A2"),"RESOURCE_NOT_FOUND");await expectFail("C12_RAW_AUTHORITY",()=>pay(A,A1,deposit.reservationId,1,"C12-D-RAW",{cashSessionId:id("FOREIGN")}),"RAW_FINANCIAL_AUTHORITY_FORBIDDEN");},after:snap,assert:r=>assert.deepEqual(r.after,r.before),actual:"branch context and server-derived financial authority rejected cross-scope/client authority"});
    const refundable=await reservation(A,A1,"C12-R",20,5);const requested=await reservationService.requestRefund({companyId:A,branchId:A1,user:actor,reservationId:refundable.reservationId,idempotencyKey:id("C12-R-REQ"),body:{amount:money(1),reason:"C12",refundMethod:"cash"}});const refundId=requested.responseBody.data.refund.id;await reservationService.approveRefund({companyId:A,branchId:A1,user:actor,refundId,body:{}});const refundSnap=()=>configurationSnapshot(A,refundable.reservationId);
    await runConfigurationCell(matrix,{id:"R-S2-R-A2",operation:"Refund",scenario:"closed A1 session at real Refund execution",expected:"CASH_REGISTER_SESSION_REQUIRED and zero execution writes",before:refundSnap,execute:async()=>{await a1.session.update({status:"CLOSED"});try{await expectFail("C12_REFUND_CLOSED",()=>reservationService.executeRefund({companyId:A,branchId:A1,user:actor,refundId,idempotencyKey:id("C12-R-CLOSED"),body:{}}),"CASH_REGISTER_SESSION_REQUIRED");}finally{await a1.session.update({status:"OPEN"});}},after:refundSnap,assert:r=>assert.deepEqual(r.after,r.before),actual:"Refund execution did not select an arbitrary open session"});
    await runConfigurationCell(matrix,{id:"R-M1-R-A1",operation:"Refund",scenario:"valid approved A1 cash Refund",expected:"one scoped execution succeeds",before:refundSnap,execute:async()=>{const r=await reservationService.executeRefund({companyId:A,branchId:A1,user:actor,refundId,idempotencyKey:id("C12-R-VALID"),body:{}});assert.equal(r.statusCode,200);},after:refundSnap,assert:r=>{assert.equal(r.after.refunds,r.before.refunds);assert.equal(r.after.refund_allocations,r.before.refund_allocations+1);assert.equal(r.after.cash_transactions,r.before.cash_transactions+1);assert.equal(r.after.journals,r.before.journals+1);},actual:"approved Refund used A1 liability, treasury and session exactly once"});
    const role = key => a1.finalSale[key].role;
    const restoreRole = async (row, accountId) => row.update({accountId}, {transaction:null});
    const completeSnapshot = fixture => configurationSnapshot(A,fixture.reservationId);
    const missing = await reservation(A,A1,"C12-C-MISSING",20,10);
    const missingRole = role("accountsReceivable"); const missingAccountId = missingRole.accountId;
    await runConfigurationCell(matrix,{id:"C-M2",operation:"Complete-sale",scenario:"missing A1 Accounts Receivable role mapping",expected:"BRANCH_FINANCIAL_MAPPING_REQUIRED and zero account/financial writes",before:()=>completeSnapshot(missing),execute:async()=>{await missingRole.destroy();try{await expectFail("C12_COMPLETE_MISSING_ROLE",()=>reservationService.completeSale({companyId:A,branchId:A1,user:actor,reservationId:missing.reservationId,idempotencyKey:id("C12-C-MISSING"),body:{}}),"BRANCH_FINANCIAL_MAPPING_REQUIRED");}finally{await models.SystemAccountRole.create({id:missingRole.id,companyId:A,branchId:A1,roleCode:missingRole.roleCode,accountId:missingAccountId,createdBy:actor.id,updatedBy:actor.id});}},after:()=>completeSnapshot(missing),assert:r=>assert.deepEqual(r.after,r.before),actual:"missing role failed before Invoice creation and did not auto-create an account"});
    const companyCandidate = await models.Account.create({id:id("ACC-COMPANY-AR"),companyId:A,branchId:null,code:"1300",name:"Company AR",nameAr:"ذمم شركة",type:"asset",nature:"debit",balance:0,isActive:true,level:2});
    const companyFallback = await reservation(A,A1,"C12-C-COMPANY",20,10);
    await runConfigurationCell(matrix,{id:"C-M12",operation:"Complete-sale",scenario:"Company-level AR candidate with missing A1 role mapping",expected:"BRANCH_FINANCIAL_MAPPING_REQUIRED and zero writes; no Company fallback",before:()=>completeSnapshot(companyFallback),execute:async()=>{await missingRole.destroy();try{await expectFail("C12_COMPLETE_COMPANY_FALLBACK",()=>reservationService.completeSale({companyId:A,branchId:A1,user:actor,reservationId:companyFallback.reservationId,idempotencyKey:id("C12-C-COMPANY"),body:{}}),"BRANCH_FINANCIAL_MAPPING_REQUIRED");}finally{await models.SystemAccountRole.create({id:missingRole.id,companyId:A,branchId:A1,roleCode:missingRole.roleCode,accountId:missingAccountId,createdBy:actor.id,updatedBy:actor.id});}},after:()=>completeSnapshot(companyFallback),assert:r=>{assert.deepEqual(r.after,r.before);assert.equal(companyCandidate.branchId,null);},actual:"company code candidate was never selected"});
    const crossBranch = await reservation(A,A1,"C12-C-A2",20,10); const a2Account = a2.finalSale.accountsReceivable.account;
    await runConfigurationCell(matrix,{id:"C-M10",operation:"Complete-sale",scenario:"A2 account mapped to A1 Accounts Receivable role",expected:"BRANCH_FINANCIAL_ACCOUNT_SCOPE_INVALID and zero writes",before:()=>completeSnapshot(crossBranch),execute:async()=>{await missingRole.update({accountId:a2Account.id});try{await expectFail("C12_COMPLETE_CROSS_BRANCH",()=>reservationService.completeSale({companyId:A,branchId:A1,user:actor,reservationId:crossBranch.reservationId,idempotencyKey:id("C12-C-A2"),body:{}}),"BRANCH_FINANCIAL_ACCOUNT_SCOPE_INVALID");}finally{await restoreRole(missingRole,missingAccountId);}},after:()=>completeSnapshot(crossBranch),assert:r=>assert.deepEqual(r.after,r.before),actual:"sibling Branch account was rejected"});
    const crossCompany = await reservation(A,A1,"C12-C-B1",20,10); const b1Account = b1.finalSale.accountsReceivable.account;
    await runConfigurationCell(matrix,{id:"C-M11",operation:"Complete-sale",scenario:"B1 account mapped to A1 Accounts Receivable role",expected:"BRANCH_FINANCIAL_ACCOUNT_SCOPE_INVALID and zero writes",before:()=>completeSnapshot(crossCompany),execute:async()=>{await missingRole.update({accountId:b1Account.id});try{await expectFail("C12_COMPLETE_CROSS_COMPANY",()=>reservationService.completeSale({companyId:A,branchId:A1,user:actor,reservationId:crossCompany.reservationId,idempotencyKey:id("C12-C-B1"),body:{}}),"BRANCH_FINANCIAL_ACCOUNT_SCOPE_INVALID");}finally{await restoreRole(missingRole,missingAccountId);}},after:()=>completeSnapshot(crossCompany),assert:r=>assert.deepEqual(r.after,r.before),actual:"other Company account was rejected"});
    const inactive = await reservation(A,A1,"C12-C-INACTIVE",20,10); const inactiveAccount = a1.finalSale.salesRevenue.account;
    await runConfigurationCell(matrix,{id:"C-M8",operation:"Complete-sale",scenario:"inactive mapped A1 Sales Revenue account",expected:"BRANCH_FINANCIAL_ACCOUNT_INACTIVE and zero writes",before:()=>completeSnapshot(inactive),execute:async()=>{await inactiveAccount.update({isActive:false});try{await expectFail("C12_COMPLETE_INACTIVE",()=>reservationService.completeSale({companyId:A,branchId:A1,user:actor,reservationId:inactive.reservationId,idempotencyKey:id("C12-C-INACTIVE"),body:{}}),"BRANCH_FINANCIAL_ACCOUNT_INACTIVE");}finally{await inactiveAccount.update({isActive:true});}},after:()=>completeSnapshot(inactive),assert:r=>assert.deepEqual(r.after,r.before),actual:"inactive account was not replaced or selected"});
    const wrongRole = await reservation(A,A1,"C12-C-ROLE",20,10); const revenueRole = role("salesRevenue"); const revenueAccountId = revenueRole.accountId;
    await runConfigurationCell(matrix,{id:"C-M9",operation:"Complete-sale",scenario:"A1 Accounts Receivable account mapped as Sales Revenue",expected:"BRANCH_FINANCIAL_ACCOUNT_ROLE_INVALID and zero writes",before:()=>completeSnapshot(wrongRole),execute:async()=>{await revenueRole.update({accountId:missingAccountId});try{await expectFail("C12_COMPLETE_WRONG_ROLE",()=>reservationService.completeSale({companyId:A,branchId:A1,user:actor,reservationId:wrongRole.reservationId,idempotencyKey:id("C12-C-ROLE"),body:{}}),"BRANCH_FINANCIAL_ACCOUNT_ROLE_INVALID");}finally{await restoreRole(revenueRole,revenueAccountId);}},after:()=>completeSnapshot(wrongRole),assert:r=>assert.deepEqual(r.after,r.before),actual:"wrong account role was rejected without fallback"});
    matrix.cells.push({id:"C-M13",operation:"Complete-sale",scenario:"ambiguous active role mapping",expected:"unique company/branch/role constraint prevents ambiguous candidates",actual:"NOT_APPLICABLE: system_account_roles_company_branch_role_uq prevents duplicate active role rows",status:"NOT_APPLICABLE",writesDelta:"zero",notes:"Schema uniqueness is the deterministic ambiguity guard."});matrix.skipped++;out("CONFIGURATION_CELL",matrix.cells.at(-1));
    const completion=await reservation(A,A1,"C12-C-VALID",20,10); const beforeComplete=await completeSaleSnapshot(A,A1,completion.reservationId,completion.assetId,"C12-COMP"); const beforeAccounts=await models.Account.count({where:{companyId:A}});
    await runConfigurationCell(matrix,{id:"C-M1",operation:"Complete-sale",scenario:"valid explicit A1 final-sale role mappings",expected:"one Complete-sale succeeds without account creation; replay has no duplicates",before:()=>completeSnapshot(completion),execute:async()=>{const completed=await reservationService.completeSale({companyId:A,branchId:A1,user:actor,reservationId:completion.reservationId,idempotencyKey:id("C12-COMP"),body:{}});assert.equal(completed.statusCode,201);const replay=await reservationService.completeSale({companyId:A,branchId:A1,user:actor,reservationId:completion.reservationId,idempotencyKey:id("C12-COMP"),body:{}});assert.equal(replay.statusCode,201);},after:()=>completeSnapshot(completion),assert:async r=>{assert.equal(r.after.accounts,r.before.accounts);assert.equal(r.after.invoices,r.before.invoices+1);assert.equal(r.after.applications,r.before.applications+1);assert.equal(r.after.stock_movements,r.before.stock_movements+1);assert.equal(r.after.reservation_status,"completed");assert.equal(await models.Account.count({where:{companyId:A}}),beforeAccounts);},actual:"explicit A1 roles produced one invoice, application, balanced journals and stock movement without auto-create"});
    const afterComplete=await completeSaleSnapshot(A,A1,completion.reservationId,completion.assetId,"C12-COMP");assert.equal(afterComplete.sale_journals,2);assert.equal(Number(afterComplete.sale_journal_debits),Number(afterComplete.sale_journal_credits));assert.equal(afterComplete.receipt_snapshot_digest,beforeComplete.receipt_snapshot_digest);
    matrix.failed=matrix.cells.filter(c=>c.status==="FAIL").length;matrix.passed=matrix.cells.filter(c=>c.status==="PASS").length;matrix.total=matrix.cells.length;matrix.status="PASS";result.total=matrix.total;result.passed=matrix.passed;result.failed=matrix.failed;result.skipped=matrix.skipped;result.cells=matrix.cells;result.notes="C12 affected Complete-sale mapping cells and six prior Deposit/Refund cells passed; explicit administrative mapping API remains a later setup gap.";
  } catch(error) {matrix.failed=matrix.cells.filter(c=>c.status==="FAIL").length;matrix.passed=matrix.cells.filter(c=>c.status==="PASS").length;matrix.total=matrix.cells.length;matrix.status="FAIL";result.total=matrix.total;result.passed=matrix.passed;result.failed=matrix.failed;result.skipped=matrix.skipped;result.cells=matrix.cells;result.notes=matrix.notes;throw error;}}});
}
async function configuration(A1,A2,B1, a1) {
  const f=await reservation(A,A1,"CFG",20,1);
  const liability=await models.BranchFinancialMapping.findOne({where:{companyId:A,branchId:A1,mappingType:"RESERVATION_ADVANCE_LIABILITY"}});
  await liability.update({isActive:false});
  await noRowsCase("MISSING_LIABILITY",A,f.reservationId,()=>pay(A,A1,f.reservationId,1,"CFG-MISSING-LIAB"),"DEPOSIT_LIABILITY_MAPPING_MISSING");
  await liability.update({isActive:true});
  const treasury=await models.BranchFinancialMapping.findOne({where:{companyId:A,branchId:A1,mappingType:"CASH_TREASURY"}});
  await treasury.update({isActive:false});
  await noRowsCase("MISSING_TREASURY",A,f.reservationId,()=>pay(A,A1,f.reservationId,1,"CFG-MISSING-TREAS"),"TREASURY_MAPPING_MISSING");
  await treasury.update({isActive:true});
  await noRowsCase("UNAUTHORIZED_CHANNEL",A,f.reservationId,()=>reservationService.addPayment({companyId:A,branchId:A1,user:actor,reservationId:f.reservationId,idempotencyKey:id("CFG-BANK"),body:{amount:money(1),paymentMethod:"bank"}}),"PAYMENT_CHANNEL_UNAUTHORIZED");
  await a1.session.update({status:"CLOSED"});
  await noRowsCase("CLOSED_SESSION",A,f.reservationId,()=>pay(A,A1,f.reservationId,1,"CFG-CLOSED"),"CASH_REGISTER_SESSION_REQUIRED");
  await a1.session.update({status:"OPEN"});
  await noRowsCase("RAW_FOREIGN_AUTHORITY",A,f.reservationId,()=>pay(A,A1,f.reservationId,1,"CFG-RAW",{liabilityAccountId:id("FOREIGN")}),"RAW_FINANCIAL_AUTHORITY_FORBIDDEN");
  const liabilityAccount=a1["2300"]; await liabilityAccount.update({type:"asset"});
  await noRowsCase("INELIGIBLE_LIABILITY",A,f.reservationId,()=>pay(A,A1,f.reservationId,1,"CFG-BAD-LIAB"),"DEPOSIT_LIABILITY_MAPPING_MISSING");
  await liabilityAccount.update({type:"liability"});
  // A2 has no own mapping.  A1's valid mapping must not be used by A2.
  const f2=await reservation(A,A2,"NOFALLBACK",20,1).catch(async e=>{ out("NO_FALLBACK_CREATE", {code:code(e)}); return null; });
  assert.equal(f2,null,"reservation creation must fail with no branch-local mapping");
  // Cross-scope read/write is rejected by the real service before a new payment.
  await noRowsCase("CROSS_BRANCH",A,f.reservationId,()=>pay(A,A2,f.reservationId,1,"CFG-CROSS-BRANCH"),"RESOURCE_NOT_FOUND");
  await noRowsCase("CROSS_COMPANY",A,f.reservationId,()=>pay(B,B1,f.reservationId,1,"CFG-CROSS-COMPANY"),"RESOURCE_NOT_FOUND");
  out("CONFIGURATION_MATRIX_PASS",{reservationId:f.reservationId});
}
async function financialScenario(A1) {
  const f=await reservation(A,A1,"RECON",40,10);
  await pay(A,A1,f.reservationId,12,"RECON-P2"); await pay(A,A1,f.reservationId,8,"RECON-P3");
  const req=await reservationService.requestRefund({companyId:A,branchId:A1,user:actor,reservationId:f.reservationId,idempotencyKey:id("RECON-REFREQ"),body:{amount:money(8),reason:"C13",refundMethod:"cash"}});
  const refundId=req.responseBody.data.refund.id;
  await reservationService.approveRefund({companyId:A,branchId:A1,user:actor,refundId,body:{}});
  const executed=await reservationService.executeRefund({companyId:A,branchId:A1,user:actor,refundId,idempotencyKey:id("RECON-REFEXEC"),body:{}});
  assert.equal(executed.statusCode,200);
  const completion=await reservationService.completeSale({companyId:A,branchId:A1,user:actor,reservationId:f.reservationId,idempotencyKey:id("RECON-COMP"),body:{}});
  assert.equal(completion.statusCode,201); const invoiceId=completion.responseBody.data.invoice.id;
  const totals=await countsFor(A,f.reservationId); assert.deepEqual(totals,{received:30,refunded:8,applied:22,receipts:3,cash:4});
  assert.equal(totals.received-totals.refunded-totals.applied,0);
  const invoice=await models.Invoice.findByPk(invoiceId); assert.equal(Number(invoice.paidAmount),22); assert.equal(Number(invoice.remainingAmount),18);
  const [rows]=await q(`select
   (select count(*)::int from reservation_deposit_receipt_documents where company_id=$1 and reservation_id=$2) receipt_count,
   (select count(distinct reservation_payment_id)::int from reservation_deposit_receipt_documents where company_id=$1 and reservation_id=$2) receipt_payments,
   (select count(*)::int from reservation_refund_allocations a join reservation_refunds r on r.id=a.reservation_refund_id where r.company_id=$1 and r.reservation_id=$2) refund_allocations,
   (select coalesce(sum(a.applied_amount),0)::numeric from reservation_payment_applications a where a.company_id=$1 and a.reservation_id=$2) application_total,
   (select count(*)::int from invoices where id=$3 and company_id=$1) invoices,
   (select count(*)::int from stock_movements where company_id=$1 and asset_id=$4) stock_moves`,[A,f.reservationId,invoiceId,f.assetId]);
  assert.equal(rows[0].receipt_count,3); assert.equal(rows[0].receipt_payments,3); assert.equal(Number(rows[0].application_total),22); assert.equal(rows[0].invoices,1); assert.equal(rows[0].stock_moves,1);
  out("RECONCILIATION_PASS",{reservationId:f.reservationId,refundId,invoiceId,...totals,invoice:{total:Number(invoice.total),paid:Number(invoice.paidAmount),remaining:Number(invoice.remainingAmount),tax:Number(invoice.tax||0),vatRate:Number(invoice.vatRate||0)},allocations:rows[0]});
  return { f, refundId, invoiceId };
}

async function financialState(companyId, branchId, reservationId, assetId) {
  const [reservationRows] = await q(`select id,status,paid_total,remaining_total,final_invoice_id,refund_status from reservations where company_id=$1 and id=$2`, [companyId, reservationId]);
  const [payments] = await q(`select id,amount,status,journal_entry_id,cash_transaction_id,cash_register_session_id from reservation_payments where company_id=$1 and reservation_id=$2 order by id`, [companyId, reservationId]);
  const paymentIds = payments.map(row => row.id);
  const [receipts] = await q(`select id,reservation_payment_id,receipt_number,snapshot::text as snapshot from reservation_deposit_receipt_documents where company_id=$1 and reservation_id=$2 order by id`, [companyId, reservationId]);
  const [refunds] = await q(`select id,amount,status,journal_entry_id,cash_transaction_id from reservation_refunds where company_id=$1 and reservation_id=$2 order by id`, [companyId, reservationId]);
  const refundIds = refunds.map(row => row.id);
  const [allocations] = await q(`select id,reservation_refund_id,reservation_payment_id,allocated_amount from reservation_refund_allocations where company_id=$1 and reservation_refund_id=any($2::text[]) order by id`, [companyId, refundIds]);
  const [invoices] = await q(`select id,invoice_number,subtotal,tax,total,paid_amount,remaining_amount,status from invoices where company_id=$1 and related_invoice_id=$2 order by id`, [companyId, reservationId]);
  const invoiceIds = invoices.map(row => row.id);
  const [applications] = await q(`select id,reservation_payment_id,final_invoice_id,applied_amount,source_reference from reservation_payment_applications where company_id=$1 and reservation_id=$2 order by id`, [companyId, reservationId]);
  const [cash] = await q(`select id,type,account,amount,counter_account_code,reference,journal_entry_id from cash_transactions where company_id=$1 and reference=any($2::text[]) order by id`, [companyId, [...paymentIds, ...refundIds]]);
  const [journalRows] = await q(`select je.id,je.source_type,je.source_id,je.branch_id,je.total_debit,je.total_credit,jl.id as line_id,jl.account_id,jl.account_code,jl.debit,jl.credit from journal_entries je join journal_lines jl on jl.journal_entry_id=je.id where je.company_id=$1 and ((je.source_type='reservation_payment' and je.source_id=any($2::text[])) or (je.source_type='reservation_refund' and je.source_id=any($3::text[])) or (je.source_type='invoice' and je.source_id=any($4::text[])) or (je.source_type='reservation_settlement' and je.source_id=$5)) order by je.id,jl.id`, [companyId, paymentIds, refundIds, invoiceIds, reservationId]);
  const journalsById = new Map();
  for (const row of journalRows) {
    if (!journalsById.has(row.id)) journalsById.set(row.id, { id: row.id, sourceType: row.source_type, sourceId: row.source_id, branchId: row.branch_id, totalDebit: row.total_debit, totalCredit: row.total_credit, lines: [] });
    journalsById.get(row.id).lines.push({ id: row.line_id, accountId: row.account_id, accountCode: row.account_code, debit: row.debit, credit: row.credit });
  }
  const [accountRows] = await q(`select id,branch_id as "branchId",code,nature,balance from accounts where company_id=$1 and branch_id=$2 and code=any($3::text[]) order by code`, [companyId, branchId, ["1110", "1200", "1300", "2200", "2300", "4100", "5000"]]);
  const [stock] = await q(`select id,reference_id,quantity_out,total_cost,type from stock_movements where company_id=$1 and asset_id=$2 and reference_type='reservation_final_sale' order by id`, [companyId, assetId]);
  const [idempotency] = await q(`select scope,key,status from idempotency_requests where company_id=$1 and (key like $2 or key like $3) order by scope,key`, [companyId, `${ns}%`, `${reservationId}%`]);
  return { reservation: reservationRows[0], payments, receipts, refunds, allocations, invoices, applications, cash, journals: [...journalsById.values()], accounts: accountRows, stock, idempotency };
}

function unitsSum(rows, field, predicate = () => true) {
  return rows.filter(predicate).reduce((sum, row) => sum + decimalUnits(row[field]), 0n);
}
function accountMap(state) { return new Map(state.accounts.map(row => [row.code, row])); }
function accountOpening(state) { return Object.fromEntries(state.accounts.map(row => [row.code, decimalUnits(row.balance)])); }
function lineTotals(state, code) {
  return state.journals.flatMap(journal => journal.lines).filter(line => line.accountCode === code).reduce((totals, line) => ({ debit: totals.debit + decimalUnits(line.debit), credit: totals.credit + decimalUnits(line.credit) }), { debit: 0n, credit: 0n });
}
function assertBranchJournalIntegrity(state, branchId, expectedAccounts) {
  for (const journal of state.journals) {
    assert.equal(journal.branchId, branchId, `journal ${journal.id} branch scope`);
    assertJournalBalance(journal);
    for (const line of journal.lines) {
      const account = expectedAccounts.get(line.accountCode);
      assert.ok(account, `journal ${journal.id} used unexpected account ${line.accountCode}`);
      assert.equal(line.accountId, account.id, `journal ${journal.id} must use mapped ${line.accountCode}`);
    }
  }
}
function assertAccountDeltas(state, openingBalances) {
  const byCode = accountMap(state);
  for (const [code, account] of byCode) {
    const movement = state.journals.flatMap(journal => journal.lines).filter(line => line.accountCode === code).reduce((sum, line) => sum + signedLineMovement(line, account.nature), 0n);
    const delta = decimalUnits(account.balance) - openingBalances[code];
    assert.equal(delta, movement, `account ${code} balance delta must equal owned journal movement`);
  }
}
function receiptFingerprint(state) { return JSON.stringify(state.receipts.map(row => [row.id, row.reservation_payment_id, row.receipt_number, row.snapshot])); }
function replayFingerprint(state) {
  return JSON.stringify({ reservation: state.reservation, payments: state.payments, receipts: state.receipts, refunds: state.refunds, allocations: state.allocations, invoices: state.invoices, applications: state.applications, cash: state.cash, journals: state.journals, stock: state.stock, idempotency: state.idempotency, accounts: state.accounts });
}
function assertNoRecognition(state, operation) {
  for (const code of ["1300", "4100", "2200", "5000", "1200"]) {
    const total = lineTotals(state, code);
    assert.equal(total.debit, 0n, `${operation} must not debit ${code}`);
    assert.equal(total.credit, 0n, `${operation} must not credit ${code}`);
  }
}
function assertDepositReconciliation(state, openingBalances, accounts, expectedDeposit) {
  const deposit = decimalUnits(expectedDeposit);
  assert.equal(unitsSum(state.payments, "amount", row => row.status === "posted"), deposit, "Deposit total");
  assert.equal(state.receipts.length, state.payments.length, "one immutable receipt per Deposit payment");
  assert.equal(new Set(state.receipts.map(row => row.reservation_payment_id)).size, state.payments.length, "receipt/payment identity is unique");
  assert.equal(new Set(state.receipts.map(row => row.receipt_number)).size, state.receipts.length, "receipt numbers are unique");
  assert.equal(unitsSum(state.cash, "amount", row => row.type === "cash_in"), deposit, "Deposit treasury inflow");
  assert.equal(state.cash.filter(row => row.type === "cash_out").length, 0, "Deposit has no cash outflow");
  assert.equal(state.journals.filter(row => row.sourceType === "reservation_payment").length, state.payments.length, "one Deposit journal per payment");
  assertBranchJournalIntegrity(state, accounts.get("1110").branchId, accounts);
  const treasury = lineTotals(state, "1110"), liability = lineTotals(state, "2300");
  assert.equal(treasury.debit, deposit, "Deposit debit treasury"); assert.equal(treasury.credit, 0n, "Deposit no treasury credit");
  assert.equal(liability.credit, deposit, "Deposit credit liability"); assert.equal(liability.debit, 0n, "Deposit no liability debit");
  assertNoRecognition(state, "Deposit");
  assertAccountDeltas(state, openingBalances);
  return { D: deposit, R: 0n, A: 0n, L: deposit };
}
function assertRefundReconciliation(state, openingBalances, accounts, expectedDeposit, expectedRefund, immutableReceipts) {
  const D = decimalUnits(expectedDeposit), R = decimalUnits(expectedRefund);
  assert.equal(unitsSum(state.payments, "amount", row => row.status === "posted"), D, "Refund source Deposit total");
  assert.equal(unitsSum(state.refunds, "amount", row => row.status === "executed"), R, "Refund execution total");
  assert.equal(unitsSum(state.allocations, "allocated_amount"), R, "Refund allocations total");
  assert.equal(state.allocations.length, 1, "one partial Refund allocation");
  assert.equal(unitsSum(state.cash, "amount", row => row.type === "cash_in"), D, "Refund scenario Deposit inflow");
  assert.equal(unitsSum(state.cash, "amount", row => row.type === "cash_out"), R, "Refund treasury outflow");
  assert.equal(receiptFingerprint(state), immutableReceipts, "Refund must not mutate Deposit receipt snapshot");
  assertBranchJournalIntegrity(state, accounts.get("1110").branchId, accounts);
  const treasury = lineTotals(state, "1110"), liability = lineTotals(state, "2300");
  assert.equal(treasury.debit, D); assert.equal(treasury.credit, R);
  assert.equal(liability.credit, D); assert.equal(liability.debit, R);
  assertNoRecognition(state, "Refund");
  assertAccountDeltas(state, openingBalances);
  assert.equal(decimalUnits(accounts.get("1110").balance) - openingBalances["1110"], D - R, "treasury net equation");
  assert.equal(decimalUnits(accounts.get("2300").balance) - openingBalances["2300"], D - R, "liability before-sale equation");
  return { D, R, A: 0n, L: D - R };
}
function assertCompleteSaleReconciliation(state, openingBalances, accounts, expectedDeposit, expectedRefund, immutableReceipts) {
  const D = decimalUnits(expectedDeposit), R = decimalUnits(expectedRefund);
  assert.equal(state.invoices.length, 1, "one final Invoice");
  assert.equal(state.stock.length, 1, "one final stock movement");
  assert.equal(state.applications.length, 1, "one Deposit application");
  assert.equal(state.reservation.status, "completed", "Reservation final state");
  assert.equal(receiptFingerprint(state), immutableReceipts, "Complete-sale must not mutate Deposit receipt snapshot");
  const invoice = state.invoices[0], AUnits = unitsSum(state.applications, "applied_amount"), total = decimalUnits(invoice.total), net = decimalUnits(invoice.subtotal), vat = decimalUnits(invoice.tax), cost = decimalUnits(state.stock[0].total_cost);
  assert.equal(total, net + vat, "Invoice gross = net + VAT");
  assert.equal(AUnits, D - R, "only unrefunded Deposit is applied");
  assert.ok(AUnits <= total, "Deposit application cannot exceed Invoice gross");
  assert.equal(decimalUnits(invoice.paid_amount), AUnits, "Invoice paid amount equals application total");
  assert.equal(decimalUnits(invoice.remaining_amount), total - AUnits, "Invoice due equals gross minus Deposit application");
  assert.equal(state.applications[0].final_invoice_id, invoice.id, "application points to final Invoice");
  const paymentAmounts = new Map(state.payments.map(row => [row.id, decimalUnits(row.amount)]));
  for (const application of state.applications) {
    const paymentAmount = paymentAmounts.get(application.reservation_payment_id);
    const refunded = unitsSum(state.allocations.filter(row => row.reservation_payment_id === application.reservation_payment_id), "allocated_amount");
    assert.ok(paymentAmount != null && decimalUnits(application.applied_amount) > 0n, "application has eligible positive source payment");
    assert.ok(decimalUnits(application.applied_amount) + refunded <= paymentAmount, "refunded Deposit cannot be reapplied");
  }
  assertBranchJournalIntegrity(state, accounts.get("1110").branchId, accounts);
  const treasury = lineTotals(state, "1110"), liability = lineTotals(state, "2300"), ar = lineTotals(state, "1300"), revenue = lineTotals(state, "4100"), vatLine = lineTotals(state, "2200"), cogs = lineTotals(state, "5000"), inventory = lineTotals(state, "1200");
  assert.equal(treasury.debit, D); assert.equal(treasury.credit, R);
  assert.equal(liability.credit, D); assert.equal(liability.debit, R + AUnits);
  assert.equal(ar.debit, total); assert.equal(ar.credit, AUnits);
  assert.equal(revenue.debit, 0n); assert.equal(revenue.credit, net);
  assert.equal(vatLine.debit, 0n); assert.equal(vatLine.credit, vat);
  assert.equal(cogs.debit, cost); assert.equal(cogs.credit, 0n);
  assert.equal(inventory.debit, 0n); assert.equal(inventory.credit, cost);
  assertAccountDeltas(state, openingBalances);
  assert.equal(decimalUnits(accounts.get("1110").balance) - openingBalances["1110"], D - R, "treasury balance equation");
  assert.equal(decimalUnits(accounts.get("2300").balance) - openingBalances["2300"], D - R - AUnits, "liability equation");
  assert.equal(decimalUnits(accounts.get("1300").balance) - openingBalances["1300"], total - AUnits, "AR/due equation");
  assert.equal(decimalUnits(accounts.get("4100").balance) - openingBalances["4100"], net, "Revenue once");
  assert.equal(decimalUnits(accounts.get("2200").balance) - openingBalances["2200"], vat, "VAT once");
  assert.equal(decimalUnits(accounts.get("5000").balance) - openingBalances["5000"], cost, "COGS once");
  assert.equal(decimalUnits(accounts.get("1200").balance) - openingBalances["1200"], -cost, "Inventory Asset decrease once");
  return { D, R, A: AUnits, L: D - R - AUnits, I: total, N: net, V: vat, C: cost, Q: total - AUnits };
}
async function runFinancialReconciliationCell(matrix, spec) {
  const result = { id: spec.id, operation: spec.operation, scenario: spec.scenario, expected: spec.expected, status: "FAIL" };
  try { await spec.run(result); result.status = "PASS"; matrix.passed++; } catch (error) { result.actual = error.message; result.errorCode = code(error); matrix.failed++; throw error; } finally { matrix.cells.push(result); matrix.total++; out("FINANCIAL_RECONCILIATION_CELL", result); }
}
async function financialReconciliationMatrix(A1, a1) {
  const matrix = { id: "FINANCIAL_RECONCILIATION_MATRIX", title: "Deposit lifecycle financial reconciliation", status: "FAIL", total: 0, passed: 0, failed: 0, skipped: 0, equations: { precision: "PostgreSQL NUMERIC compared in fixed eight-decimal units; no binary floating-point equality", deposit: "T_in=D; L=D-R-A", invoice: "I=N+V; Q=I-A", inventory: "COGS=C; Inventory=-C" }, cells: [], notes: "Each cell uses an independent owned Reservation and compares account-balance deltas with its own source-document journal lines." };
  await runMandatoryCell({ id: matrix.id, title: matrix.title, expected: "Deposit, Refund and Complete-sale documents, journals and persisted account balances satisfy exact lifecycle equations with replay producing no additional movement", run: async result => {
    const opening = async () => accountOpening(await financialState(A, A1, id("NONE"), id("NONE")));
    await runFinancialReconciliationCell(matrix, { id: "RECON_DEPOSIT_RECEIPT", operation: "Deposit", scenario: "fixture initial Deposit 1.0000 plus one real 9.0000 Deposit and same-key replay", expected: "Dr Treasury 10.0000 / Cr Reservation Advance Liability 10.0000; no AR/VAT/Revenue/COGS/Inventory", run: async cell => {
      const before = await opening(); const fixture = await reservation(A, A1, "C13-D", 20, 1); const receiptBefore = receiptFingerprint(await financialState(A, A1, fixture.reservationId, fixture.assetId));
      const posted = await pay(A, A1, fixture.reservationId, 9, "C13-D-PAY"); assert.equal(posted.statusCode, 201);
      const state = await financialState(A, A1, fixture.reservationId, fixture.assetId); const accounts = accountMap(state); const equations = assertDepositReconciliation(state, before, accounts, "10.0000");
      const replay = await pay(A, A1, fixture.reservationId, 9, "C13-D-PAY"); const afterReplay = await financialState(A, A1, fixture.reservationId, fixture.assetId); assert.equal(replay.responseBody.replay, true); assert.equal(replayFingerprint(afterReplay), replayFingerprint(state), "Deposit replay has no financial movement"); assert.ok(receiptFingerprint(state).includes(receiptBefore.slice(1, -1)), "initial immutable receipt retained");
      cell.documents = { payments: state.payments.length, receipts: state.receipts.length, receiptSnapshot: "fixture receipt retained; later Deposit created its own immutable snapshot" }; cell.journals = state.journals.map(row => ({ id: row.id, sourceType: row.sourceType, debit: row.totalDebit, credit: row.totalCredit })); cell.balances = Object.fromEntries(state.accounts.map(row => [row.code, row.balance])); cell.equations = Object.fromEntries(Object.entries(equations).map(([key, value]) => [key, value.toString()])); cell.replay = "PASS"; cell.actual = "Deposit treasury, liability, receipts, balanced journals and account deltas reconcile exactly; replay added no movement.";
    }});
    await runFinancialReconciliationCell(matrix, { id: "RECON_REFUND_EXECUTION", operation: "Refund", scenario: "Deposit 10.0000, partial Refund 5.0000 and same-key replay", expected: "Dr Reservation Advance Liability 5.0000 / Cr Treasury 5.0000; no AR/VAT/Revenue/COGS/Inventory", run: async cell => {
      const before = await opening(); const fixture = await reservation(A, A1, "C13-R", 20, 10); const beforeRefund = await financialState(A, A1, fixture.reservationId, fixture.assetId); const immutable = receiptFingerprint(beforeRefund);
      const requested = await reservationService.requestRefund({ companyId: A, branchId: A1, user: actor, reservationId: fixture.reservationId, idempotencyKey: id("C13-R-REQ"), body: { amount: money(5), reason: "C13 reconciliation", refundMethod: "cash" } }); const refundId = requested.responseBody.data.refund.id; await reservationService.approveRefund({ companyId: A, branchId: A1, user: actor, refundId, body: {} });
      const executed = await reservationService.executeRefund({ companyId: A, branchId: A1, user: actor, refundId, idempotencyKey: id("C13-R-EXEC"), body: {} }); assert.equal(executed.statusCode, 200);
      const state = await financialState(A, A1, fixture.reservationId, fixture.assetId); const accounts = accountMap(state); const equations = assertRefundReconciliation(state, before, accounts, "10.0000", "5.0000", immutable);
      const replay = await reservationService.executeRefund({ companyId: A, branchId: A1, user: actor, refundId, idempotencyKey: id("C13-R-EXEC"), body: {} }); const afterReplay = await financialState(A, A1, fixture.reservationId, fixture.assetId); assert.equal(replay.statusCode, 200); assert.equal(replayFingerprint(afterReplay), replayFingerprint(state), "Refund replay has no financial movement");
      cell.documents = { refundId, payments: state.payments.length, allocations: state.allocations.length, cash: state.cash.length }; cell.journals = state.journals.map(row => ({ id: row.id, sourceType: row.sourceType, debit: row.totalDebit, credit: row.totalCredit })); cell.balances = Object.fromEntries(state.accounts.map(row => [row.code, row.balance])); cell.equations = Object.fromEntries(Object.entries(equations).map(([key, value]) => [key, value.toString()])); cell.replay = "PASS"; cell.actual = "Refund allocation, cash-out, liability reversal, treasury net movement and receipt immutability reconcile exactly; replay added no movement.";
    }});
    await runFinancialReconciliationCell(matrix, { id: "RECON_COMPLETE_SALE_NO_REFUND", operation: "Complete-sale", scenario: "Deposit 10.0000 applied to final Invoice 20.0000 without a Refund", expected: "Invoice/AR/application, VAT/Revenue, COGS/Inventory and liability settlement reconcile exactly once", run: async cell => {
      const before = await opening(); const fixture = await reservation(A, A1, "C13-C0", 20, 10); const immutable = receiptFingerprint(await financialState(A, A1, fixture.reservationId, fixture.assetId));
      const completed = await reservationService.completeSale({ companyId: A, branchId: A1, user: actor, reservationId: fixture.reservationId, idempotencyKey: id("C13-C0-COMP"), body: {} }); assert.equal(completed.statusCode, 201);
      const state = await financialState(A, A1, fixture.reservationId, fixture.assetId); const accounts = accountMap(state); const equations = assertCompleteSaleReconciliation(state, before, accounts, "10.0000", "0.0000", immutable);
      const replay = await reservationService.completeSale({ companyId: A, branchId: A1, user: actor, reservationId: fixture.reservationId, idempotencyKey: id("C13-C0-COMP"), body: {} }); const afterReplay = await financialState(A, A1, fixture.reservationId, fixture.assetId); assert.equal(replay.statusCode, 201); assert.equal(replayFingerprint(afterReplay), replayFingerprint(state), "Complete-sale replay has no financial movement");
      cell.documents = { invoiceId: state.invoices[0].id, invoiceNumber: state.invoices[0].invoice_number, applications: state.applications.length, stock: state.stock.length }; cell.journals = state.journals.map(row => ({ id: row.id, sourceType: row.sourceType, debit: row.totalDebit, credit: row.totalCredit })); cell.balances = Object.fromEntries(state.accounts.map(row => [row.code, row.balance])); cell.equations = Object.fromEntries(Object.entries(equations).map(([key, value]) => [key, value.toString()])); cell.replay = "PASS"; cell.actual = "Final sale recognized AR, Revenue, VAT, COGS and Inventory once; Deposit application settled liability/AR once; replay added no movement.";
    }});
    await runFinancialReconciliationCell(matrix, { id: "RECON_COMPLETE_SALE_AFTER_REFUND", operation: "Complete-sale", scenario: "Deposit 10.0000, Refund 5.0000, then apply only the remaining Deposit", expected: "application is limited to 5.0000 and all final-sale equations reconcile without reapplying refunded value", run: async cell => {
      const before = await opening(); const fixture = await reservation(A, A1, "C13-CR", 20, 10); const initial = await financialState(A, A1, fixture.reservationId, fixture.assetId); const immutable = receiptFingerprint(initial);
      const requested = await reservationService.requestRefund({ companyId: A, branchId: A1, user: actor, reservationId: fixture.reservationId, idempotencyKey: id("C13-CR-REQ"), body: { amount: money(5), reason: "C13 lifecycle reconciliation", refundMethod: "cash" } }); const refundId = requested.responseBody.data.refund.id; await reservationService.approveRefund({ companyId: A, branchId: A1, user: actor, refundId, body: {} }); await reservationService.executeRefund({ companyId: A, branchId: A1, user: actor, refundId, idempotencyKey: id("C13-CR-EXEC"), body: {} });
      const completed = await reservationService.completeSale({ companyId: A, branchId: A1, user: actor, reservationId: fixture.reservationId, idempotencyKey: id("C13-CR-COMP"), body: {} }); assert.equal(completed.statusCode, 201);
      const state = await financialState(A, A1, fixture.reservationId, fixture.assetId); const accounts = accountMap(state); const equations = assertCompleteSaleReconciliation(state, before, accounts, "10.0000", "5.0000", immutable);
      const replay = await reservationService.completeSale({ companyId: A, branchId: A1, user: actor, reservationId: fixture.reservationId, idempotencyKey: id("C13-CR-COMP"), body: {} }); const afterReplay = await financialState(A, A1, fixture.reservationId, fixture.assetId); assert.equal(replay.statusCode, 201); assert.equal(replayFingerprint(afterReplay), replayFingerprint(state), "Refund/Complete-sale replay has no financial movement");
      cell.documents = { refundId, invoiceId: state.invoices[0].id, applications: state.applications.length, stock: state.stock.length }; cell.journals = state.journals.map(row => ({ id: row.id, sourceType: row.sourceType, debit: row.totalDebit, credit: row.totalCredit })); cell.balances = Object.fromEntries(state.accounts.map(row => [row.code, row.balance])); cell.equations = Object.fromEntries(Object.entries(equations).map(([key, value]) => [key, value.toString()])); cell.replay = "PASS"; cell.actual = "Only the unrefunded Deposit was applied; Treasury, liability, AR, VAT, Revenue, COGS and Inventory reconcile exactly; replay added no movement.";
    }});
    matrix.status = "PASS"; result.total = matrix.total; result.passed = matrix.passed; result.failed = matrix.failed; result.skipped = matrix.skipped; result.equations = matrix.equations; result.cells = matrix.cells; result.notes = matrix.notes;
  }});
}
async function integrityCounts(companyId, branchId, reservationId, assetId) {
  const [rows] = await q(`select
 (select count(*)::int from reservation_payments p left join reservations r on r.id=p.reservation_id and r.company_id=p.company_id left join customers c on c.id=p.customer_id and c.company_id=p.company_id where p.company_id=$1 and p.reservation_id=$2 and (r.id is null or p.branch_id<>r.branch_id or p.customer_id<>r.customer_id)) payment_scope_orphans,
 (select count(*)::int from reservation_deposit_receipt_documents d left join reservation_payments p on p.id=d.reservation_payment_id and p.company_id=d.company_id where d.company_id=$1 and d.reservation_id=$2 and (p.id is null or p.reservation_id<>d.reservation_id or d.snapshot is null)) receipt_orphans,
 (select count(*)::int from (select reservation_payment_id from reservation_deposit_receipt_documents where company_id=$1 and reservation_id=$2 group by reservation_payment_id having count(*)<>1) x) duplicate_payment_receipts,
 (select count(*)::int from (select receipt_number from reservation_deposit_receipt_documents where company_id=$1 and reservation_id=$2 group by receipt_number having count(*)>1) x) duplicate_receipt_numbers,
 (select count(*)::int from cash_transactions c left join reservation_payments p on p.id=c.reference and p.company_id=c.company_id where c.company_id=$1 and c.type='cash_in' and p.reservation_id=$2 and (c.journal_entry_id is null or c.branch_id<>p.branch_id)) deposit_cash_orphans,
 (select count(*)::int from reservation_refunds rf left join reservations r on r.id=rf.reservation_id and r.company_id=rf.company_id where rf.company_id=$1 and rf.reservation_id=$2 and (r.id is null or rf.branch_id<>r.branch_id)) refund_scope_orphans,
 (select count(*)::int from reservation_refund_allocations a left join reservation_refunds rf on rf.id=a.reservation_refund_id and rf.company_id=a.company_id left join reservation_payments p on p.id=a.reservation_payment_id and p.company_id=a.company_id where a.company_id=$1 and rf.reservation_id=$2 and (rf.id is null or p.id is null or p.reservation_id<>rf.reservation_id or p.branch_id<>rf.branch_id)) refund_allocation_orphans,
 (select count(*)::int from (select reference from cash_transactions where company_id=$1 and type='cash_out' and reference in (select id from reservation_refunds where company_id=$1 and reservation_id=$2) group by reference having count(*)>1) x) duplicate_refund_cash,
 (select count(*)::int from invoices i left join reservations r on r.id=i.related_invoice_id and r.company_id=i.company_id where i.company_id=$1 and i.related_invoice_id=$2 and (r.id is null or i.branch_id<>r.branch_id or i.customer_id<>r.customer_id)) invoice_scope_orphans,
 (select count(*)::int from invoices i left join invoice_items ii on ii.invoice_id=i.id where i.company_id=$1 and i.related_invoice_id=$2 and ii.invoice_id is null) invoice_item_orphans,
 (select count(*)::int from reservation_payment_applications a left join invoices i on i.id=a.final_invoice_id and i.company_id=a.company_id left join reservation_payments p on p.id=a.reservation_payment_id and p.company_id=a.company_id where a.company_id=$1 and a.reservation_id=$2 and (i.id is null or p.id is null or p.reservation_id<>a.reservation_id or i.related_invoice_id<>a.reservation_id)) application_orphans,
 (select count(*)::int from (select reservation_payment_id,final_invoice_id from reservation_payment_applications where company_id=$1 and reservation_id=$2 group by reservation_payment_id,final_invoice_id having count(*)>1) x) duplicate_applications,
 (select count(*)::int from stock_movements s left join invoices i on i.id=s.reference_id and i.company_id=s.company_id left join assets a on a.id=s.asset_id and a.company_id=s.company_id where s.company_id=$1 and s.asset_id=$3 and s.reference_type='reservation_final_sale' and (i.id is null or a.id is null or s.branch_id<>i.branch_id)) stock_orphans,
 (select count(*)::int from journal_lines l left join journal_entries j on j.id=l.journal_entry_id left join accounts a on a.id=l.account_id where j.company_id=$1 and (j.branch_id<>a.branch_id or a.company_id<>j.company_id)) cross_scope_journal_lines,
 (select count(*)::int from journal_lines l left join journal_entries j on j.id=l.journal_entry_id where j.company_id=$1 and l.journal_entry_id is null) orphan_journal_lines,
 (select count(*)::int from (select source_type,source_id from journal_entries where company_id=$1 and ((source_type='reservation_payment' and source_id in (select id from reservation_payments where company_id=$1 and reservation_id=$2)) or (source_type='reservation_refund' and source_id in (select id from reservation_refunds where company_id=$1 and reservation_id=$2)) or (source_type='invoice' and source_id in (select id from invoices where company_id=$1 and related_invoice_id=$2)) or (source_type='reservation_settlement' and source_id=$2)) group by source_type,source_id having count(*)>1) x) duplicate_semantic_journals,
 (select count(*)::int from (select scope,key from idempotency_requests where company_id=$1 and key like $4 group by scope,key having count(*)>1) x) duplicate_idempotency,
 (select count(*)::int from idempotency_requests i where i.company_id=$1 and i.key like $4 and i.status='succeeded' and i.response_body is null) false_success_idempotency,
 (select count(*)::int from (select action,source_document from audit_logs where company_id=$1 and source_document=$2 and action in ('reservation.refund_executed','reservation.completed') group by action,source_document having count(*)>1) x) duplicate_success_audit`, [companyId, reservationId, assetId, `${ns}%`]);
  return rows[0];
}
function assertNoIntegrityCounts(counts, label) { for (const [key, value] of Object.entries(counts)) assert.equal(Number(value), 0, `${label}: ${key}`); }
async function runIntegrityCell(matrix, spec) { const result={id:spec.id,domain:spec.domain,scenario:spec.scenario,expected:spec.expected,status:"FAIL"}; try { await spec.run(result); result.status="PASS"; matrix.passed++; } catch(error) { result.actual=error.message;result.errorCode=code(error);matrix.failed++;throw error; } finally { matrix.cells.push(result);matrix.total++;out("INTEGRITY_AUDIT_CELL",result); } }
async function orphanDuplicateCrossScopeAuditMatrix(A1,A2,B1,a1) {
  const matrix={id:"ORPHAN_DUPLICATE_CROSS_SCOPE_AUDIT_MATRIX",title:"Owned Deposit lifecycle orphan, duplicate and cross-scope audit",status:"FAIL",total:0,passed:0,failed:0,skipped:0,cells:[],historicalReadOnlySummary:{status:"NOT_RUN",notes:"Optional non-owned historical scan was deliberately omitted; owned runtime evidence is isolated and no existing data was touched."},notes:"One owned partial-refund Complete-sale graph plus replay and rejected sibling/cross-company probes; all checks use exact source links."};
  await runMandatoryCell({id:matrix.id,title:matrix.title,expected:"owned Deposit, Refund and Complete-sale graphs have no orphan, duplicate or cross-scope artifacts and rejected scope probes write nothing",run:async result=>{
    const fixture=await reservation(A,A1,"C14-GRAPH",20,10);
    const payment=await pay(A,A1,fixture.reservationId,1,"C14-DEP"); const paymentId=payment.responseBody.data.payment.id; const afterDeposit=await financialState(A,A1,fixture.reservationId,fixture.assetId);
    await runIntegrityCell(matrix,{id:"AUDIT_DEPOSIT_ORPHANS",domain:"Deposit",scenario:"owned payment/receipt/cash/journal graph",expected:"all mandatory Deposit parents, scope and immutable snapshots exist",run:async cell=>{const counts=await integrityCounts(A,A1,fixture.reservationId,fixture.assetId); for(const key of ["payment_scope_orphans","receipt_orphans","deposit_cash_orphans","orphan_journal_lines"])assert.equal(Number(counts[key]),0,key);assert.ok(afterDeposit.receipts.every(row=>row.snapshot));cell.artifactCounts={payments:afterDeposit.payments.length,receipts:afterDeposit.receipts.length,cash:afterDeposit.cash.length,journals:afterDeposit.journals.length};cell.orphanChecks=counts;cell.actual="owned Deposit payment, immutable receipt, cash-in and journal links are complete.";}});
    await runIntegrityCell(matrix,{id:"AUDIT_DEPOSIT_DUPLICATES",domain:"Deposit",scenario:"same-key replay",expected:"one payment/receipt/cash/journal/idempotency result per operation",run:async cell=>{const replay=await pay(A,A1,fixture.reservationId,1,"C14-DEP");assert.equal(replay.responseBody.replay,true);assert.equal(replay.responseBody.data.payment.id,paymentId);const state=await financialState(A,A1,fixture.reservationId,fixture.assetId);const counts=await integrityCounts(A,A1,fixture.reservationId,fixture.assetId);for(const key of ["duplicate_payment_receipts","duplicate_receipt_numbers","duplicate_idempotency","duplicate_success_audit"])assert.equal(Number(counts[key]),0,key);cell.duplicateChecks=counts;cell.replay="PASS";cell.actual="replay returned the original Deposit identity without a duplicate artifact.";}});
    await runIntegrityCell(matrix,{id:"AUDIT_DEPOSIT_CROSS_SCOPE",domain:"Deposit",scenario:"A2/B1 branches against owned A1 Reservation",expected:"scope rejection and zero new writes",run:async cell=>{const before=await configurationSnapshot(A,fixture.reservationId);await expectFail("C14_DEPOSIT_A2",()=>pay(A,A2,fixture.reservationId,1,"C14-A2"),"RESOURCE_NOT_FOUND");await expectFail("C14_DEPOSIT_B1",()=>pay(B,B1,fixture.reservationId,1,"C14-B1"),"RESOURCE_NOT_FOUND");const after=await configurationSnapshot(A,fixture.reservationId);assert.deepEqual(after,before);cell.scopeChecks={A2:"RESOURCE_NOT_FOUND",B1:"RESOURCE_NOT_FOUND"};cell.actual="sibling and cross-company Deposit attempts made zero writes.";}});
    const requested=await reservationService.requestRefund({companyId:A,branchId:A1,user:actor,reservationId:fixture.reservationId,idempotencyKey:id("C14-R-REQ"),body:{amount:money(5),reason:"C14",refundMethod:"cash"}});const refundId=requested.responseBody.data.refund.id;await reservationService.approveRefund({companyId:A,branchId:A1,user:actor,refundId,body:{}});
    await runIntegrityCell(matrix,{id:"AUDIT_REFUND_CROSS_SCOPE",domain:"Refund",scenario:"A2/B1 execution attempts before the owned Refund executes",expected:"scope rejection and zero writes",run:async cell=>{const before=await refundSnapshot(A,fixture.reservationId,refundId,"C14-R-A2");await expectFail("C14_REFUND_A2",()=>reservationService.executeRefund({companyId:A,branchId:A2,user:actor,refundId,idempotencyKey:id("C14-R-A2"),body:{}}),"RESOURCE_NOT_FOUND");await expectFail("C14_REFUND_B1",()=>reservationService.executeRefund({companyId:B,branchId:B1,user:actor,refundId,idempotencyKey:id("C14-R-B1"),body:{}}),"RESOURCE_NOT_FOUND");const after=await refundSnapshot(A,fixture.reservationId,refundId,"C14-R-A2");assert.deepEqual(after,before);cell.scopeChecks={A2:"RESOURCE_NOT_FOUND",B1:"RESOURCE_NOT_FOUND"};cell.actual="cross-scope Refund attempts made zero writes before execution-state validation.";}});
    const executed=await reservationService.executeRefund({companyId:A,branchId:A1,user:actor,refundId,idempotencyKey:id("C14-R-EXEC"),body:{}});assert.equal(executed.statusCode,200);const afterRefund=await financialState(A,A1,fixture.reservationId,fixture.assetId);
    await runIntegrityCell(matrix,{id:"AUDIT_REFUND_ORPHANS",domain:"Refund",scenario:"approved then executed owned partial Refund",expected:"allocation/cash/journal/source links are complete",run:async cell=>{const counts=await integrityCounts(A,A1,fixture.reservationId,fixture.assetId);for(const key of ["refund_scope_orphans","refund_allocation_orphans","deposit_cash_orphans","orphan_journal_lines"])assert.equal(Number(counts[key]),0,key);assert.equal(afterRefund.allocations.length,1);cell.artifactCounts={refunds:afterRefund.refunds.length,allocations:afterRefund.allocations.length,cashOut:afterRefund.cash.filter(row=>row.type==='cash_out').length};cell.orphanChecks=counts;cell.actual="Refund allocation, cash-out and journal all point to the owned Refund/source payment.";}});
    await runIntegrityCell(matrix,{id:"AUDIT_REFUND_DUPLICATES",domain:"Refund",scenario:"same-key Refund replay",expected:"one execution/allocation/cash/journal set",run:async cell=>{const replay=await reservationService.executeRefund({companyId:A,branchId:A1,user:actor,refundId,idempotencyKey:id("C14-R-EXEC"),body:{}});assert.equal(replay.responseBody.data.refund.id,refundId);const state=await financialState(A,A1,fixture.reservationId,fixture.assetId);assert.equal(state.allocations.length,1);assert.equal(state.cash.filter(row=>row.type==='cash_out').length,1);const counts=await integrityCounts(A,A1,fixture.reservationId,fixture.assetId);assert.equal(Number(counts.duplicate_refund_cash),0);cell.duplicateChecks=counts;cell.replay="PASS";cell.actual="Refund replay created no second execution artifact.";}});
    const completed=await reservationService.completeSale({companyId:A,branchId:A1,user:actor,reservationId:fixture.reservationId,idempotencyKey:id("C14-COMP"),body:{}});assert.equal(completed.statusCode,201);const invoiceId=completed.responseBody.data.invoice.id;const afterSale=await financialState(A,A1,fixture.reservationId,fixture.assetId);
    await runIntegrityCell(matrix,{id:"AUDIT_COMPLETE_SALE_ORPHANS",domain:"Complete-sale",scenario:"owned final Invoice/application/stock graph",expected:"Invoice, application, journals and stock link to the completed Reservation",run:async cell=>{const counts=await integrityCounts(A,A1,fixture.reservationId,fixture.assetId);for(const key of ["invoice_scope_orphans","invoice_item_orphans","application_orphans","stock_orphans","orphan_journal_lines"])assert.equal(Number(counts[key]),0,key);assert.equal(afterSale.reservation.final_invoice_id,invoiceId);cell.artifactCounts={invoices:afterSale.invoices.length,applications:afterSale.applications.length,stock:afterSale.stock.length};cell.orphanChecks=counts;cell.actual="final Invoice, item, application, journals and stock movement have complete owned links.";}});
    await runIntegrityCell(matrix,{id:"AUDIT_COMPLETE_SALE_DUPLICATES",domain:"Complete-sale",scenario:"same-key Complete-sale replay",expected:"one Invoice and unchanged contract-correct application/stock/journal/status set",run:async cell=>{const expectedApplications=afterSale.applications.length;const replay=await reservationService.completeSale({companyId:A,branchId:A1,user:actor,reservationId:fixture.reservationId,idempotencyKey:id("C14-COMP"),body:{}});assert.equal(replay.responseBody.data.invoice.id,invoiceId);const state=await financialState(A,A1,fixture.reservationId,fixture.assetId);assert.equal(state.invoices.length,1);assert.equal(state.applications.length,expectedApplications);assert.equal(state.stock.length,1);const counts=await integrityCounts(A,A1,fixture.reservationId,fixture.assetId);for(const key of ["duplicate_applications","duplicate_semantic_journals","duplicate_idempotency","duplicate_success_audit"])assert.equal(Number(counts[key]),0,key);cell.duplicateChecks=counts;cell.applicationCount=expectedApplications;cell.replay="PASS";cell.actual="Complete-sale replay returned the same Invoice with no duplicate operational or financial artifact.";}});
    await runIntegrityCell(matrix,{id:"AUDIT_COMPLETE_SALE_CROSS_SCOPE",domain:"Complete-sale",scenario:"A2/B1 completion attempts after owned completion",expected:"scope rejection and zero writes",run:async cell=>{const before=await completeSaleSnapshot(A,A1,fixture.reservationId,fixture.assetId,"C14-COMP");await expectFail("C14_SALE_A2",()=>reservationService.completeSale({companyId:A,branchId:A2,user:actor,reservationId:fixture.reservationId,idempotencyKey:id("C14-C-A2"),body:{}}),"RESOURCE_NOT_FOUND");await expectFail("C14_SALE_B1",()=>reservationService.completeSale({companyId:B,branchId:B1,user:actor,reservationId:fixture.reservationId,idempotencyKey:id("C14-C-B1"),body:{}}),"RESOURCE_NOT_FOUND");const after=await completeSaleSnapshot(A,A1,fixture.reservationId,fixture.assetId,"C14-COMP");assert.deepEqual(after,before);cell.scopeChecks={A2:"RESOURCE_NOT_FOUND",B1:"RESOURCE_NOT_FOUND"};cell.actual="cross-scope Complete-sale attempts made zero writes.";}});
    await runIntegrityCell(matrix,{id:"AUDIT_IDEMPOTENCY_INTEGRITY",domain:"Idempotency",scenario:"Deposit/Refund/Complete-sale successful keys",expected:"unique succeeded response identities and stable replay",run:async cell=>{const counts=await integrityCounts(A,A1,fixture.reservationId,fixture.assetId);for(const key of ["duplicate_idempotency","false_success_idempotency"])assert.equal(Number(counts[key]),0,key);cell.references=afterSale.idempotency;cell.actual="owned successful idempotency rows are unique and retain their source identities.";}});
    await runIntegrityCell(matrix,{id:"AUDIT_OPERATION_AUDIT_LINKAGE",domain:"Audit",scenario:"committed Deposit/Refund/Complete-sale audits",expected:"one source-linked success audit per audited operation",run:async cell=>{const counts=await integrityCounts(A,A1,fixture.reservationId,fixture.assetId);assert.equal(Number(counts.duplicate_success_audit),0);cell.references={sourceDocument:fixture.reservationId,duplicateSuccessAudit:0};cell.actual="success audit rows are source-linked and replay did not duplicate them.";}});
    await runIntegrityCell(matrix,{id:"AUDIT_JOURNAL_REFERENCE_INTEGRITY",domain:"Journal",scenario:"all owned lifecycle journals",expected:"valid source, branch-mapped accounts, lines and no semantic duplicate",run:async cell=>{const accounts=accountMap(afterSale);assertBranchJournalIntegrity(afterSale,A1,accounts);const counts=await integrityCounts(A,A1,fixture.reservationId,fixture.assetId);for(const key of ["cross_scope_journal_lines","orphan_journal_lines","duplicate_semantic_journals"])assert.equal(Number(counts[key]),0,key);cell.references=afterSale.journals.map(j=>({id:j.id,sourceType:j.sourceType,sourceId:j.sourceId}));cell.actual="journal headers, lines, accounts and source references are in owned A1 scope.";}});
    await runIntegrityCell(matrix,{id:"AUDIT_CASH_SESSION_INTEGRITY",domain:"Cash/session",scenario:"Deposit cash-in and Refund cash-out",expected:"correct owned source/reference and Deposit session link",run:async cell=>{assert.ok(afterSale.cash.every(row=>row.journal_entry_id));const depositPayment=afterSale.payments.find(row=>row.id===paymentId);assert.equal(depositPayment.cash_register_session_id,a1.session.id);assert.equal(afterSale.cash.filter(row=>row.type==='cash_in').length,2);assert.equal(afterSale.cash.filter(row=>row.type==='cash_out').length,1);cell.references={sessionId:a1.session.id,refundSessionPersistedLink:"NOT_APPLICABLE: current Refund CashTransaction schema has no CashRegisterSession foreign key"};cell.actual="cash rows reference their owned payment/Refund and journals; Deposit session is authoritative.";}});
    await runIntegrityCell(matrix,{id:"AUDIT_INVENTORY_LINKAGE",domain:"Inventory",scenario:"final sold asset",expected:"one A1 stock movement linked to the owned Invoice/asset",run:async cell=>{assert.equal(afterSale.stock.length,1);assert.equal(afterSale.stock[0].reference_id,invoiceId);assert.equal(afterSale.stock[0].type,'sale');cell.references={assetId:fixture.assetId,invoiceId,stockMovementId:afterSale.stock[0].id};cell.actual="Deposit/Refund added no stock movement; Complete-sale added one scoped sold-asset movement.";}});
    matrix.status="PASS";result.total=matrix.total;result.passed=matrix.passed;result.failed=matrix.failed;result.skipped=matrix.skipped;result.cells=matrix.cells;result.historicalReadOnlySummary=matrix.historicalReadOnlySummary;result.notes=matrix.notes;
  }});
}
async function orphanAudit(scenario) {
  const { f, refundId, invoiceId }=scenario;
  const [r]=await q(`select
  (select count(*)::int from reservation_payments p left join reservation_deposit_receipt_documents d on d.reservation_payment_id=p.id where p.company_id=$1 and p.reservation_id=$2 and p.status='posted' and d.id is null) payment_without_receipt,
  (select count(*)::int from (select reservation_payment_id from reservation_deposit_receipt_documents where company_id=$1 and reservation_id=$2 group by reservation_payment_id having count(*)>1) z) duplicate_receipt,
  (select count(*)::int from reservation_deposit_receipt_documents d left join reservation_payments p on p.id=d.reservation_payment_id where d.company_id=$1 and d.reservation_id=$2 and p.id is null) receipt_without_payment,
  (select count(*)::int from reservation_payment_applications a left join invoices i on i.id=a.final_invoice_id where a.company_id=$1 and a.reservation_id=$2 and i.id is null) application_without_invoice,
  (select count(*)::int from (select reservation_payment_id,final_invoice_id from reservation_payment_applications where company_id=$1 and reservation_id=$2 group by reservation_payment_id,final_invoice_id having count(*)>1) z) duplicate_application,
  (select count(*)::int from journal_lines l left join journal_entries j on j.id=l.journal_entry_id where j.company_id=$1 and j.id is null) orphan_journal_line,
  (select count(*)::int from invoices where id=$3 and company_id=$1) scoped_invoice`,[A,f.reservationId,invoiceId]);
  for (const [k,v] of Object.entries(r[0])) if(k!=="scoped_invoice") assert.equal(v,0,k);
  assert.equal(r[0].scoped_invoice,1); out("ORPHAN_DUPLICATE_CROSS_SCOPE_PASS",r[0]);
}
async function depositJournalRollback(A1) {
  const f=await reservation(A,A1,"RBJ",20,1); const before=await rollbackSnapshot(A,f.reservationId,"RBJ-FAIL");
  await runMandatoryCell({id:"DEPOSIT_ROLLBACK_JOURNAL_PERSISTENCE",title:"Deposit journal rollback",expected:"journal failure leaves no payment side effects and retry succeeds",run:async r=>{
    const transactionProof=await withScopedFailure({target:postingService,method:"postReservationPaymentEntry",errorCode:"ACC_C16_C1_DEPOSIT_JOURNAL_PERSISTENCE_FAILURE",run:async observed=>{
      let err;try{await pay(A,A1,f.reservationId,1,"RBJ-FAIL");}catch(e){err=e;}assert.equal(code(err),"ACC_C16_C1_DEPOSIT_JOURNAL_PERSISTENCE_FAILURE");return observed();}});
    assert.deepEqual(transactionProof,{present:true,finished:"rollback"});r.transaction=transactionProof;
    const afterFailure=await rollbackSnapshot(A,f.reservationId,"RBJ-FAIL");assert.deepEqual(afterFailure,before);r.before=before;r.afterFailure=afterFailure;
    await pay(A,A1,f.reservationId,1,"RBJ-RETRY");const afterRetry=await rollbackSnapshot(A,f.reservationId,"RBJ-RETRY");
    assert.equal(afterRetry.payments,before.payments+1);assert.equal(afterRetry.receipts,before.receipts+1);assert.equal(afterRetry.cash_transactions,before.cash_transactions+1);assert.equal(afterRetry.journals,before.journals+1);assert.equal(afterRetry.journal_lines,before.journal_lines+2);assert.equal(afterRetry.success_idempotency,1);assert.equal(afterRetry.success_audit,before.success_audit+1);assert.equal(afterRetry.reservation_status,before.reservation_status);r.retry=afterRetry;
  }});
}
async function depositReceiptRollback(A1) {
  const f=await reservation(A,A1,"RBR",20,1); const before=await rollbackSnapshot(A,f.reservationId,"RBR-FAIL");
  await runMandatoryCell({id:"DEPOSIT_ROLLBACK_RECEIPT_PERSISTENCE",title:"Deposit receipt rollback",expected:"receipt persistence failure leaves no Deposit side effects and retry succeeds",run:async r=>{
    const transactionProof=await withScopedFailure({target:depositReceiptService,method:"createImmutableDocument",errorCode:"ACC_C16_C2_DEPOSIT_RECEIPT_PERSISTENCE_FAILURE",run:async observed=>{
      let err;try{await pay(A,A1,f.reservationId,1,"RBR-FAIL");}catch(e){err=e;}assert.equal(code(err),"ACC_C16_C2_DEPOSIT_RECEIPT_PERSISTENCE_FAILURE");return observed();}});
    assert.deepEqual(transactionProof,{present:true,finished:"rollback"});r.transaction=transactionProof;
    const afterFailure=await rollbackSnapshot(A,f.reservationId,"RBR-FAIL");assert.deepEqual(afterFailure,before);r.before=before;r.afterFailure=afterFailure;
    await pay(A,A1,f.reservationId,1,"RBR-RETRY");const afterRetry=await rollbackSnapshot(A,f.reservationId,"RBR-RETRY");
    assert.equal(afterRetry.payments,before.payments+1);assert.equal(afterRetry.receipts,before.receipts+1);assert.equal(afterRetry.cash_transactions,before.cash_transactions+1);assert.equal(afterRetry.journals,before.journals+1);assert.equal(afterRetry.journal_lines,before.journal_lines+2);assert.equal(afterRetry.success_idempotency,1);assert.equal(afterRetry.success_audit,before.success_audit+1);assert.equal(afterRetry.reservation_status,before.reservation_status);
    const [rows]=await q(`select count(*)::int receipts,count(distinct reservation_payment_id)::int payment_receipts,count(distinct receipt_number)::int receipt_numbers,bool_and(snapshot->'notices'->>'ar' is not null and snapshot->'notices'->>'en' is not null) notices from reservation_deposit_receipt_documents where company_id=$1 and reservation_id=$2`,[A,f.reservationId]);
    assert.deepEqual(rows[0],{receipts:2,payment_receipts:2,receipt_numbers:2,notices:true});r.actual="zero committed failure rows; restored retry created one payment and immutable receipt";r.errorCode="ACC_C16_C2_DEPOSIT_RECEIPT_PERSISTENCE_FAILURE";r.retry=afterRetry;r.receipts=rows[0];r.ownedIds={reservationId:f.reservationId};
  }});
}
async function depositIdempotencyRollback(A1) {
  const f=await reservation(A,A1,"RBI",20,1); const before=await rollbackSnapshot(A,f.reservationId,"RBI-FAIL");
  await runMandatoryCell({id:"DEPOSIT_ROLLBACK_IDEMPOTENCY_SUCCESS_PERSISTENCE",title:"Deposit idempotency success rollback",expected:"idempotency success failure leaves no committed Deposit side effects and same-key retry succeeds once",run:async r=>{
    const transactionProof=await withScopedFailure({target:idempotencyService,method:"succeed",errorCode:"ACC_C16_C3_DEPOSIT_IDEMPOTENCY_SUCCESS_PERSISTENCE_FAILURE",verifyArgs:({request})=>assert.equal(request.key,id("RBI-FAIL"),"injected idempotency key must be owned"),run:async observed=>{
      let err;try{await pay(A,A1,f.reservationId,1,"RBI-FAIL");}catch(e){err=e;}assert.equal(code(err),"ACC_C16_C3_DEPOSIT_IDEMPOTENCY_SUCCESS_PERSISTENCE_FAILURE");return observed();}});
    assert.deepEqual(transactionProof,{present:true,finished:"rollback"});r.transactionBoundary="idempotency succeed received the same Sequelize transaction before commit";r.transaction=transactionProof;
    const afterFailure=await rollbackSnapshot(A,f.reservationId,"RBI-FAIL");assert.deepEqual(afterFailure,before);r.before=before;r.afterFailure=afterFailure;
    const retryResponse=await pay(A,A1,f.reservationId,1,"RBI-FAIL");const afterRetry=await rollbackSnapshot(A,f.reservationId,"RBI-FAIL");
    assert.equal(afterRetry.payments,before.payments+1);assert.equal(afterRetry.receipts,before.receipts+1);assert.equal(afterRetry.cash_transactions,before.cash_transactions+1);assert.equal(afterRetry.journals,before.journals+1);assert.equal(afterRetry.journal_lines,before.journal_lines+2);assert.equal(afterRetry.success_idempotency,1);assert.equal(afterRetry.idempotency_rows,1);assert.equal(afterRetry.idempotency_status,"succeeded");assert.equal(afterRetry.idempotency_response_present,true);assert.equal(afterRetry.success_audit,before.success_audit+1);
    const replay=await pay(A,A1,f.reservationId,1,"RBI-FAIL");const afterReplay=await rollbackSnapshot(A,f.reservationId,"RBI-FAIL");assert.equal(replay.responseBody.replay,true);assert.equal(replay.responseBody.data.payment.id,retryResponse.responseBody.data.payment.id);assert.deepEqual(afterReplay,afterRetry);
    r.actual="zero committed business/financial delta; failed key was absent after rollback, then same-key retry and replay succeeded once";r.errorCode="ACC_C16_C3_DEPOSIT_IDEMPOTENCY_SUCCESS_PERSISTENCE_FAILURE";r.retry={key:"same key",state:"PASS",afterRetry};r.replay={state:"PASS",afterReplay};r.ownedIds={reservationId:f.reservationId};
  }});
}
async function refundCashOutRollback(A1) {
  const f=await reservation(A,A1,"RBC",20,10);
  const requested=await reservationService.requestRefund({companyId:A,branchId:A1,user:actor,reservationId:f.reservationId,idempotencyKey:id("RBC-REQUEST"),body:{amount:money(5),reason:"C16 C4",refundMethod:"cash"}});
  const refundId=requested.responseBody.data.refund.id;
  await reservationService.approveRefund({companyId:A,branchId:A1,user:actor,refundId,body:{}});
  const before=await refundSnapshot(A,f.reservationId,refundId,"RBC-EXEC");
  assert.equal(before.refund_status,"approved");assert.equal(before.refund_executed_at,false);assert.equal(before.refund_allocations,0);assert.equal(before.refund_cash_transactions,0);assert.equal(before.refund_journals,0);
  await runMandatoryCell({id:"REFUND_ROLLBACK_CASH_OUT_PERSISTENCE",title:"Refund cash-out rollback",expected:"cash-out failure leaves the approved refund and all financial side effects uncommitted",run:async r=>{
    const transactionProof=await withScopedFailure({target:models.CashTransaction,method:"create",errorCode:"ACC_C16_C4_REFUND_CASH_OUT_PERSISTENCE_FAILURE",verifyArgs:(values,opts)=>{assert.equal(values.reference,refundId,"cash-out must belong to owned refund");assert.equal(values.type,"cash_out");assert.equal(values.branchId,A1);assert.ok(opts.transaction);},run:async observed=>{
      let err;try{await reservationService.executeRefund({companyId:A,branchId:A1,user:actor,refundId,idempotencyKey:id("RBC-EXEC"),body:{}});}catch(e){err=e;}assert.equal(code(err),"ACC_C16_C4_REFUND_CASH_OUT_PERSISTENCE_FAILURE");return observed();}});
    assert.deepEqual(transactionProof,{present:true,finished:"rollback"});r.transactionBoundary="CashTransaction.create received the real executeRefund transaction after refund journal posting and before allocations";r.transaction=transactionProof;
    const afterFailure=await refundSnapshot(A,f.reservationId,refundId,"RBC-EXEC");assert.deepEqual(afterFailure,before);r.before=before;r.afterFailure=afterFailure;
    const retry=await reservationService.executeRefund({companyId:A,branchId:A1,user:actor,refundId,idempotencyKey:id("RBC-EXEC"),body:{}});assert.equal(retry.statusCode,200);
    const afterRetry=await refundSnapshot(A,f.reservationId,refundId,"RBC-EXEC");assert.equal(afterRetry.refund_status,"executed");assert.equal(afterRetry.refund_executed_at,true);assert.equal(afterRetry.refund_allocations,1);assert.equal(afterRetry.refund_cash_transactions,1);assert.equal(afterRetry.refund_journals,1);assert.equal(afterRetry.refund_journal_lines,2);assert.equal(afterRetry.success_idempotency,1);assert.equal(afterRetry.idempotency_rows,1);assert.equal(afterRetry.idempotency_status,"succeeded");assert.equal(Number(afterRetry.refunded),5);assert.equal(afterRetry.receipts,before.receipts);assert.equal(afterRetry.receipt_snapshot_digest,before.receipt_snapshot_digest);
    const replay=await reservationService.executeRefund({companyId:A,branchId:A1,user:actor,refundId,idempotencyKey:id("RBC-EXEC"),body:{}});const afterReplay=await refundSnapshot(A,f.reservationId,refundId,"RBC-EXEC");assert.equal(replay.statusCode,200);assert.equal(replay.responseBody.data.refund.id,retry.responseBody.data.refund.id);assert.deepEqual(afterReplay,afterRetry);
    r.actual="zero committed failure delta; same-key retry executed once; replay created no duplicate refund artifacts";r.errorCode="ACC_C16_C4_REFUND_CASH_OUT_PERSISTENCE_FAILURE";r.retry={key:"same key",state:"PASS",afterRetry};r.replay={state:"PASS",afterReplay};r.ownedIds={reservationId:f.reservationId,refundId};
  }});
}
async function refundJournalRollback(A1) {
  const f=await reservation(A,A1,"RFJ",20,10);
  const requested=await reservationService.requestRefund({companyId:A,branchId:A1,user:actor,reservationId:f.reservationId,idempotencyKey:id("RBJ-REQUEST"),body:{amount:money(5),reason:"C16 C5",refundMethod:"cash"}});
  const refundId=requested.responseBody.data.refund.id;
  await reservationService.approveRefund({companyId:A,branchId:A1,user:actor,refundId,body:{}});
  const before=await refundJournalSnapshot(A,A1,f.reservationId,refundId,"RBJ-EXEC");
  assert.equal(before.refund_status,"approved");assert.equal(before.refund_executed_at,false);assert.equal(before.refund_allocations,0);assert.equal(before.refund_cash_transactions,0);assert.equal(before.refund_journals,0);assert.equal(before.refund_journal_lines,0);
  await runMandatoryCell({id:"REFUND_ROLLBACK_JOURNAL_PERSISTENCE",title:"Refund journal persistence rollback",expected:"journal-header persistence failure rolls back the approved Refund execution with no cash, allocation, accounting, or idempotency side effects",run:async r=>{
    const transactionProof=await withScopedFailure({target:models.JournalEntry,method:"create",errorCode:"ACC_C16_C5_REFUND_JOURNAL_PERSISTENCE_FAILURE",verifyArgs:(values,opts)=>{assert.equal(values.sourceType,"reservation_refund","journal must be the owned Refund journal");assert.equal(values.sourceId,refundId,"journal must belong to owned refund");assert.equal(values.companyId,A);assert.equal(values.branchId,A1);assert.ok(opts.transaction);},run:async observed=>{
      let err;try{await reservationService.executeRefund({companyId:A,branchId:A1,user:actor,refundId,idempotencyKey:id("RBJ-EXEC"),body:{}});}catch(e){err=e;}assert.equal(code(err),"ACC_C16_C5_REFUND_JOURNAL_PERSISTENCE_FAILURE");return observed();}});
    assert.deepEqual(transactionProof,{present:true,finished:"rollback"});r.transactionBoundary="JournalEntry.create received the real executeRefund transaction. Source order is refund metadata update, journal header/lines, cash-out, allocations, final status update, then idempotency success/commit.";r.transaction=transactionProof;
    const afterFailure=await refundJournalSnapshot(A,A1,f.reservationId,refundId,"RBJ-EXEC");assert.deepEqual(afterFailure,before);r.before=before;r.afterFailure=afterFailure;
    const retry=await reservationService.executeRefund({companyId:A,branchId:A1,user:actor,refundId,idempotencyKey:id("RBJ-EXEC"),body:{}});assert.equal(retry.statusCode,200);
    const afterRetry=await refundJournalSnapshot(A,A1,f.reservationId,refundId,"RBJ-EXEC");assert.equal(afterRetry.refund_status,"executed");assert.equal(afterRetry.refund_executed_at,true);assert.equal(afterRetry.refund_allocations,1);assert.equal(afterRetry.refund_cash_transactions,1);assert.equal(afterRetry.refund_journals,1);assert.equal(afterRetry.refund_journal_lines,2);assert.equal(afterRetry.success_idempotency,1);assert.equal(afterRetry.idempotency_rows,1);assert.equal(afterRetry.idempotency_status,"succeeded");assert.equal(Number(afterRetry.refunded),5);assert.equal(Number(afterRetry.refund_journal_debits),5);assert.equal(Number(afterRetry.refund_journal_credits),5);assert.equal(Number(afterRetry.liability_debits),5);assert.equal(Number(afterRetry.treasury_credits),5);assert.equal(afterRetry.refund_journal_company,A);assert.equal(afterRetry.refund_journal_branch,A1);assert.equal(Number(afterRetry.liability_balance),Number(before.liability_balance)-5);assert.equal(Number(afterRetry.treasury_balance),Number(before.treasury_balance)-5);assert.equal(afterRetry.final_invoice_id,null);assert.equal(Number(afterRetry.stock_movements),0);assert.equal(afterRetry.receipts,before.receipts);assert.equal(afterRetry.receipt_snapshot_digest,before.receipt_snapshot_digest);
    const replay=await reservationService.executeRefund({companyId:A,branchId:A1,user:actor,refundId,idempotencyKey:id("RBJ-EXEC"),body:{}});const afterReplay=await refundJournalSnapshot(A,A1,f.reservationId,refundId,"RBJ-EXEC");assert.equal(replay.statusCode,200);assert.equal(replay.responseBody.data.refund.id,retry.responseBody.data.refund.id);assert.deepEqual(afterReplay,afterRetry);
    r.actual="zero committed failure delta; same-key retry created one balanced Refund journal, cash-out, allocation and execution; replay created no duplicate artifacts";r.errorCode="ACC_C16_C5_REFUND_JOURNAL_PERSISTENCE_FAILURE";r.retry={key:"same key (no failed idempotency row after rollback)",state:"PASS",afterRetry};r.replay={state:"PASS",afterReplay};r.ownedIds={reservationId:f.reservationId,refundId};r.notes="CashRegisterSession has no persisted refund execution movement/link in the Product contract; its expected amount remained unchanged. Refund creates no VAT, revenue, COGS, inventory movement, or final invoice.";
  }});
}
async function refundAllocationRollback(A1) {
  const f=await reservation(A,A1,"RBA",20,10);
  const payment=await models.ReservationPayment.findOne({where:{companyId:A,reservationId:f.reservationId,status:"posted"},order:[["createdAt","ASC"]]});assert.ok(payment,"owned source Deposit payment is required");
  const requested=await reservationService.requestRefund({companyId:A,branchId:A1,user:actor,reservationId:f.reservationId,idempotencyKey:id("RBA-REQUEST"),body:{amount:money(5),reason:"C16 C6",refundMethod:"cash"}});
  const refundId=requested.responseBody.data.refund.id;
  await reservationService.approveRefund({companyId:A,branchId:A1,user:actor,refundId,body:{}});
  const before=await refundAllocationSnapshot(A,A1,f.reservationId,refundId,"RBA-EXEC");
  assert.equal(before.refund_status,"approved");assert.equal(before.refund_executed_at,false);assert.equal(before.refund_allocations,0);assert.equal(Number(before.allocation_total),0);assert.equal(before.refund_cash_transactions,0);assert.equal(before.refund_journals,0);
  await runMandatoryCell({id:"REFUND_ROLLBACK_ALLOCATION_PERSISTENCE",title:"Refund allocation persistence rollback",expected:"allocation persistence failure rolls back the staged Refund journal, cash-out, status and every financial side effect",run:async r=>{
    const transactionProof=await withScopedFailure({target:models.ReservationRefundAllocation,method:"create",errorCode:"ACC_C16_C6_REFUND_ALLOCATION_PERSISTENCE_FAILURE",verifyArgs:(values,opts)=>{assert.equal(values.companyId,A);assert.equal(values.reservationRefundId,refundId,"allocation must belong to owned Refund");assert.equal(values.reservationPaymentId,payment.id,"allocation must use the owned source Deposit payment");assert.equal(Number(values.allocatedAmount),5);assert.ok(opts.transaction);},run:async observed=>{
      let err;try{await reservationService.executeRefund({companyId:A,branchId:A1,user:actor,refundId,idempotencyKey:id("RBA-EXEC"),body:{}});}catch(e){err=e;}assert.equal(code(err),"ACC_C16_C6_REFUND_ALLOCATION_PERSISTENCE_FAILURE");return observed();}});
    assert.deepEqual(transactionProof,{present:true,finished:"rollback"});r.transactionBoundary="ReservationRefundAllocation.create received the real executeRefund transaction after Refund journal/header-lines and CashTransaction.create, before final executed status and idempotency success.";r.sourceOrder="refund metadata update → journal header/lines → cash-out → allocation create → final status → idempotency success → commit";r.transaction=transactionProof;
    const afterFailure=await refundAllocationSnapshot(A,A1,f.reservationId,refundId,"RBA-EXEC");assert.deepEqual(afterFailure,before);r.before=before;r.afterFailure=afterFailure;
    const retry=await reservationService.executeRefund({companyId:A,branchId:A1,user:actor,refundId,idempotencyKey:id("RBA-EXEC"),body:{}});assert.equal(retry.statusCode,200);
    const afterRetry=await refundAllocationSnapshot(A,A1,f.reservationId,refundId,"RBA-EXEC");assert.equal(afterRetry.refund_status,"executed");assert.equal(afterRetry.refund_executed_at,true);assert.equal(afterRetry.refund_allocations,1);assert.equal(Number(afterRetry.allocation_total),5);assert.equal(afterRetry.non_positive_allocations,0);assert.equal(afterRetry.invalid_scope_allocations,0);assert.equal(afterRetry.allocation_links,`${payment.id}:5.00000000`);assert.equal(afterRetry.refund_cash_transactions,1);assert.equal(afterRetry.refund_journals,1);assert.equal(afterRetry.refund_journal_lines,2);assert.equal(afterRetry.success_idempotency,1);assert.equal(afterRetry.idempotency_rows,1);assert.equal(afterRetry.idempotency_status,"succeeded");assert.equal(Number(afterRetry.refunded),5);assert.equal(Number(afterRetry.refundable_balance),5);assert.equal(Number(afterRetry.remaining_liability),5);assert.equal(Number(afterRetry.liability_balance),Number(before.liability_balance)-5);assert.equal(Number(afterRetry.treasury_balance),Number(before.treasury_balance)-5);assert.equal(afterRetry.receipts,before.receipts);assert.equal(afterRetry.receipt_snapshot_digest,before.receipt_snapshot_digest);
    const replay=await reservationService.executeRefund({companyId:A,branchId:A1,user:actor,refundId,idempotencyKey:id("RBA-EXEC"),body:{}});const afterReplay=await refundAllocationSnapshot(A,A1,f.reservationId,refundId,"RBA-EXEC");assert.equal(replay.statusCode,200);assert.equal(replay.responseBody.data.refund.id,retry.responseBody.data.refund.id);assert.deepEqual(afterReplay,afterRetry);
    r.actual="zero committed failure delta after staged journal/cash work; same-key retry executed one correctly scoped allocation, journal and cash-out; replay created no duplicates";r.errorCode="ACC_C16_C6_REFUND_ALLOCATION_PERSISTENCE_FAILURE";r.retry={key:"same key (no failed idempotency row after rollback)",state:"PASS",afterRetry};r.replay={state:"PASS",afterReplay};r.ownedIds={reservationId:f.reservationId,refundId,sourcePaymentId:payment.id};r.notes="One source payment is selected by this narrow fixture. CashRegisterSession has no persisted Refund execution movement/link; its stored expected amount remained unchanged.";
  }});
}
async function refundIdempotencyRollback(A1) {
  const f=await reservation(A,A1,"RFI",20,10);
  const requested=await reservationService.requestRefund({companyId:A,branchId:A1,user:actor,reservationId:f.reservationId,idempotencyKey:id("RBI-REQUEST"),body:{amount:money(5),reason:"C16 C7",refundMethod:"cash"}});
  const refundId=requested.responseBody.data.refund.id;
  await reservationService.approveRefund({companyId:A,branchId:A1,user:actor,refundId,body:{}});
  const before=await refundIdempotencySnapshot(A,A1,f.reservationId,refundId,"RBI-EXEC");
  assert.equal(before.refund_status,"approved");assert.equal(before.refund_executed_at,false);assert.equal(before.refund_allocations,0);assert.equal(before.refund_cash_transactions,0);assert.equal(before.refund_journals,0);assert.equal(before.idempotency_rows,0);assert.equal(before.succeeded_refund_idempotency,0);assert.equal(before.idempotency_response_present,false);assert.equal(before.refund_execution_audit,0);
  await runMandatoryCell({id:"REFUND_ROLLBACK_IDEMPOTENCY_SUCCESS_PERSISTENCE",title:"Refund idempotency success rollback",expected:"idempotency-success persistence failure rolls back the approved Refund status, journal, cash-out, allocation, balances and claimed idempotency row",run:async r=>{
    const transactionProof=await withScopedFailure({target:idempotencyService,method:"succeed",errorCode:"ACC_C16_C7_REFUND_IDEMPOTENCY_SUCCESS_PERSISTENCE_FAILURE",verifyArgs:({request,statusCode,responseBody,transaction})=>{assert.equal(request.companyId,A);assert.equal(request.scope,"reservation.refund.execute");assert.equal(request.key,id("RBI-EXEC"));assert.equal(statusCode,200);assert.equal(responseBody.data.refund.id,refundId);assert.ok(transaction);},run:async observed=>{
      let err;try{await reservationService.executeRefund({companyId:A,branchId:A1,user:actor,refundId,idempotencyKey:id("RBI-EXEC"),body:{}});}catch(e){err=e;}assert.equal(code(err),"ACC_C16_C7_REFUND_IDEMPOTENCY_SUCCESS_PERSISTENCE_FAILURE");return observed();}});
    assert.deepEqual(transactionProof,{present:true,finished:"rollback"});r.transactionBoundary="idempotencyService.succeed received the same executeRefund transaction after final Refund status, journal, cash-out, allocation, audit and notification staging, and before the only commit.";r.sourceOrder="claim → refund metadata → journal header/lines → cash-out → allocation → final status/reservation update → audit/notification → idempotency success → commit";r.transaction=transactionProof;
    const afterFailure=await refundIdempotencySnapshot(A,A1,f.reservationId,refundId,"RBI-EXEC");assert.deepEqual(afterFailure,before);r.before=before;r.afterFailure=afterFailure;
    const retry=await reservationService.executeRefund({companyId:A,branchId:A1,user:actor,refundId,idempotencyKey:id("RBI-EXEC"),body:{}});assert.equal(retry.statusCode,200);
    const afterRetry=await refundIdempotencySnapshot(A,A1,f.reservationId,refundId,"RBI-EXEC");assert.equal(afterRetry.refund_status,"executed");assert.equal(afterRetry.refund_executed_at,true);assert.equal(afterRetry.refund_allocations,1);assert.equal(Number(afterRetry.allocation_total),5);assert.equal(afterRetry.refund_cash_transactions,1);assert.equal(afterRetry.refund_journals,1);assert.equal(afterRetry.refund_journal_lines,2);assert.equal(afterRetry.idempotency_rows,1);assert.equal(afterRetry.idempotency_status,"succeeded");assert.equal(afterRetry.success_idempotency,1);assert.equal(afterRetry.succeeded_refund_idempotency,1);assert.equal(afterRetry.idempotency_response_present,true);assert.equal(afterRetry.idempotency_refund_id,refundId);assert.equal(afterRetry.refund_execution_audit,1);assert.equal(Number(afterRetry.refunded),5);assert.equal(Number(afterRetry.refundable_balance),5);assert.equal(Number(afterRetry.remaining_liability),5);assert.equal(Number(afterRetry.liability_balance),Number(before.liability_balance)-5);assert.equal(Number(afterRetry.treasury_balance),Number(before.treasury_balance)-5);assert.equal(afterRetry.receipts,before.receipts);assert.equal(afterRetry.receipt_snapshot_digest,before.receipt_snapshot_digest);
    const replay=await reservationService.executeRefund({companyId:A,branchId:A1,user:actor,refundId,idempotencyKey:id("RBI-EXEC"),body:{}});const afterReplay=await refundIdempotencySnapshot(A,A1,f.reservationId,refundId,"RBI-EXEC");assert.equal(replay.statusCode,200);assert.equal(replay.responseBody.data.refund.id,retry.responseBody.data.refund.id);assert.deepEqual(afterReplay,afterRetry);
    r.actual="zero committed failure delta; failed key was absent after rollback; same-key retry executed once and replay created no duplicate Refund or idempotency artifacts";r.errorCode="ACC_C16_C7_REFUND_IDEMPOTENCY_SUCCESS_PERSISTENCE_FAILURE";r.retry={key:"same key (claim row rolled back with the transaction)",state:"PASS",afterRetry};r.replay={state:"PASS",afterReplay};r.ownedIds={reservationId:f.reservationId,refundId};r.notes="The success persistence is inside the same atomic Refund transaction. CashRegisterSession has no persisted Refund execution movement/link; its stored expected amount remained unchanged.";
  }});
}
async function completeSaleInvoiceRollback(A1) {
  const f=await reservation(A,A1,"CSV",20,10);
  const before=await completeSaleSnapshot(A,A1,f.reservationId,f.assetId,"CSI-EXEC");
  assert.equal(before.scoped_branch,1);assert.equal(before.reservation_status,"partially_paid");assert.equal(before.reservation_completed_at,false);assert.equal(before.final_invoice_id,null);assert.equal(before.invoices,0);assert.equal(before.invoice_items,0);assert.equal(before.applications,0);assert.equal(before.stock_movements,0);assert.equal(before.sale_journals,0);assert.equal(before.idempotency_rows,0);assert.equal(before.completion_audit,0);assert.equal(before.asset_status,"reserved");assert.equal(before.reservation_item_status,"active");assert.equal(before.receipts,1);
  await runMandatoryCell({id:"COMPLETE_SALE_ROLLBACK_INVOICE_PERSISTENCE",title:"Complete-sale Invoice persistence rollback",expected:"Invoice.create failure rolls back every final-sale side effect and retry/replay create one completion",run:async r=>{
    const transactionProof=await withScopedFailure({target:models.Invoice,method:"create",errorCode:"ACC_C16_C8_COMPLETE_SALE_INVOICE_PERSISTENCE_FAILURE",verifyArgs:(values,opts)=>{assert.equal(values.companyId,A);assert.equal(values.branchId,A1);assert.equal(values.customerId,f.customerId);assert.equal(values.relatedInvoiceId,f.reservationId);assert.equal(values.type,"sale");assert.ok(values.invoiceNumber);assert.ok(opts.transaction);},run:async observed=>{
      let err;try{await reservationService.completeSale({companyId:A,branchId:A1,user:actor,reservationId:f.reservationId,idempotencyKey:id("CSI-EXEC"),body:{}});}catch(e){err=e;}assert.equal(code(err),"ACC_C16_C8_COMPLETE_SALE_INVOICE_PERSISTENCE_FAILURE");return observed();}});
    assert.deepEqual(transactionProof,{present:true,finished:"rollback"});r.transactionBoundary="Invoice.create received the real completeSale transaction. Invoice number allocation and validation precede it; invoice items, asset/item sale state, stock movement, invoice and settlement journals, Deposit applications, reservation completion, audit/notification and idempotency success follow it before the only commit.";r.sourceOrder="claim → validation/locks → invoice number → Invoice.create → invoice item/asset/item/stock writes → invoice journal → Deposit-settlement journal → applications → reservation completed → audit/notification → idempotency success → commit";r.transaction=transactionProof;
    const afterFailure=await completeSaleSnapshot(A,A1,f.reservationId,f.assetId,"CSI-EXEC");assert.deepEqual(afterFailure,before);r.before=before;r.afterFailure=afterFailure;
    const retry=await reservationService.completeSale({companyId:A,branchId:A1,user:actor,reservationId:f.reservationId,idempotencyKey:id("CSI-EXEC"),body:{}});assert.equal(retry.statusCode,201);const invoiceId=retry.responseBody.data.invoice.id;
    const afterRetry=await completeSaleSnapshot(A,A1,f.reservationId,f.assetId,"CSI-EXEC");assert.equal(afterRetry.reservation_status,"completed");assert.equal(afterRetry.reservation_completed_at,true);assert.equal(afterRetry.final_invoice_id,invoiceId);assert.equal(afterRetry.invoices,1);assert.equal(afterRetry.invoice_id,invoiceId);assert.ok(afterRetry.invoice_number);assert.equal(afterRetry.invoice_items,1);assert.equal(afterRetry.applications,1);assert.equal(Number(afterRetry.application_total),10);assert.equal(afterRetry.stock_movements,1);assert.equal(afterRetry.sale_asset_events,1);assert.equal(afterRetry.asset_status,"sold");assert.equal(afterRetry.reservation_item_status,"sold");assert.equal(afterRetry.sale_journals,2);assert.ok(afterRetry.sale_journal_lines>=4);assert.equal(Number(afterRetry.sale_journal_debits),Number(afterRetry.sale_journal_credits));assert.equal(afterRetry.unbalanced_sale_journals,0);assert.equal(afterRetry.idempotency_rows,1);assert.equal(afterRetry.idempotency_status,"succeeded");assert.equal(afterRetry.success_idempotency,1);assert.equal(afterRetry.idempotency_response_present,true);assert.equal(afterRetry.idempotency_invoice_id,invoiceId);assert.equal(afterRetry.completion_audit,1);assert.equal(afterRetry.receipts,before.receipts);assert.equal(afterRetry.receipt_snapshot_digest,before.receipt_snapshot_digest);assert.ok(Number(afterRetry.invoice_tax)>=0);assert.equal(Number(afterRetry.liability_balance),Number(before.liability_balance)-10);assert.equal(Number(afterRetry.ar_balance),Number(before.ar_balance)+10);assert.ok(Number(afterRetry.revenue_balance)>Number(before.revenue_balance));assert.ok(Number(afterRetry.cogs_balance)>Number(before.cogs_balance));assert.ok(Number(afterRetry.inventory_balance)<Number(before.inventory_balance));
    const replay=await reservationService.completeSale({companyId:A,branchId:A1,user:actor,reservationId:f.reservationId,idempotencyKey:id("CSI-EXEC"),body:{}});const afterReplay=await completeSaleSnapshot(A,A1,f.reservationId,f.assetId,"CSI-EXEC");assert.equal(replay.statusCode,201);assert.equal(replay.responseBody.data.invoice.id,invoiceId);assert.deepEqual(afterReplay,afterRetry);
    r.actual="zero committed Invoice failure delta; same-key retry completed once with one invoice, applications, journals and inventory movement; replay created no duplicates";r.errorCode="ACC_C16_C8_COMPLETE_SALE_INVOICE_PERSISTENCE_FAILURE";r.retry={key:"same key (claim row rolled back with the transaction)",state:"PASS",afterRetry};r.replay={state:"PASS",afterReplay};r.ownedIds={reservationId:f.reservationId,assetId:f.assetId,invoiceId};r.notes="Invoice number calculation has no sequence row. The failed attempt created no valid invoice/document; Deposit receipts remained immutable. Final sale alone created the VAT/revenue/COGS/inventory and AR/liability settlement journals.";
  }});
}
async function completeSaleAccountingRollback(A1) {
  const f=await reservation(A,A1,"CSA",20,10);const before=await completeSaleSnapshot(A,A1,f.reservationId,f.assetId,"CSA-EXEC");
  assert.equal(before.reservation_status,"partially_paid");assert.equal(before.invoices,0);assert.equal(before.applications,0);assert.equal(before.sale_journals,0);assert.equal(before.stock_movements,0);assert.equal(before.idempotency_rows,0);assert.equal(before.receipts,1);
  await runMandatoryCell({id:"COMPLETE_SALE_ROLLBACK_ACCOUNTING_PERSISTENCE",title:"Complete-sale accounting persistence rollback",expected:"final-sale JournalEntry persistence failure rolls back Invoice, application, accounting, inventory, completion and idempotency side effects",run:async r=>{
    const transactionProof=await withScopedFailure({target:models.JournalEntry,method:"create",errorCode:"ACC_C16_C9_COMPLETE_SALE_ACCOUNTING_PERSISTENCE_FAILURE",verifyArgs:(values,opts)=>{assert.equal(values.companyId,A);assert.equal(values.branchId,A1);assert.equal(values.sourceType,"invoice");assert.match(values.sourceId,/^INV-RES-/);assert.ok(opts.transaction);},run:async observed=>{let err;try{await reservationService.completeSale({companyId:A,branchId:A1,user:actor,reservationId:f.reservationId,idempotencyKey:id("CSA-EXEC"),body:{}});}catch(e){err=e;}assert.equal(code(err),"ACC_C16_C9_COMPLETE_SALE_ACCOUNTING_PERSISTENCE_FAILURE");return observed();}});
    assert.deepEqual(transactionProof,{present:true,finished:"rollback"});r.transactionBoundary="JournalEntry.create received the real completeSale transaction from postInvoiceEntry after Invoice/header/item/asset/stock staging and before settlement, applications, completion, idempotency success and the only commit.";r.sourceOrder="claim → validation/locks → invoice number/Invoice/items/asset/item/stock writes → postInvoiceEntry → JournalEntry.create (injected) → settlement journal → applications → Reservation completed → audit/notification → idempotency success → commit";r.accountingUnit="Invoice-sale JournalEntry header (AR, revenue, VAT, COGS and inventory lines)";r.transaction=transactionProof;
    const afterFailure=await completeSaleSnapshot(A,A1,f.reservationId,f.assetId,"CSA-EXEC");assert.deepEqual(afterFailure,before);r.before=before;r.afterFailure=afterFailure;
    const retry=await reservationService.completeSale({companyId:A,branchId:A1,user:actor,reservationId:f.reservationId,idempotencyKey:id("CSA-EXEC"),body:{}});assert.equal(retry.statusCode,201);const invoiceId=retry.responseBody.data.invoice.id;const afterRetry=await completeSaleSnapshot(A,A1,f.reservationId,f.assetId,"CSA-EXEC");assert.equal(afterRetry.reservation_status,"completed");assert.equal(afterRetry.final_invoice_id,invoiceId);assert.equal(afterRetry.invoices,1);assert.equal(afterRetry.invoice_items,1);assert.equal(afterRetry.applications,1);assert.equal(Number(afterRetry.application_total),10);assert.equal(afterRetry.stock_movements,1);assert.equal(afterRetry.sale_journals,2);assert.equal(Number(afterRetry.sale_journal_debits),Number(afterRetry.sale_journal_credits));assert.equal(afterRetry.unbalanced_sale_journals,0);assert.equal(afterRetry.idempotency_rows,1);assert.equal(afterRetry.success_idempotency,1);assert.equal(afterRetry.completion_audit,1);assert.equal(Number(afterRetry.liability_balance),0);assert.equal(Number(afterRetry.ar_balance),10);assert.ok(Number(afterRetry.revenue_balance)>0);assert.ok(Number(afterRetry.vat_balance)>0);assert.ok(Number(afterRetry.cogs_balance)>0);assert.ok(Number(afterRetry.inventory_balance)<0);assert.equal(afterRetry.receipt_snapshot_digest,before.receipt_snapshot_digest);
    const replay=await reservationService.completeSale({companyId:A,branchId:A1,user:actor,reservationId:f.reservationId,idempotencyKey:id("CSA-EXEC"),body:{}});const afterReplay=await completeSaleSnapshot(A,A1,f.reservationId,f.assetId,"CSA-EXEC");assert.equal(replay.statusCode,201);assert.equal(replay.responseBody.data.invoice.id,invoiceId);assert.deepEqual(afterReplay,afterRetry);
    r.actual="zero committed accounting-failure delta after staged Invoice/items/stock work; same-key retry completed once with balanced Invoice and settlement journals; replay created no duplicates";r.errorCode="ACC_C16_C9_COMPLETE_SALE_ACCOUNTING_PERSISTENCE_FAILURE";r.retry={key:"same key (claim row rolled back with the transaction)",state:"PASS",afterRetry};r.replay={state:"PASS",afterReplay};r.ownedIds={reservationId:f.reservationId,assetId:f.assetId,invoiceId};r.notes="The selected unit is the Invoice sale-journal header. The successful retry recognized AR, revenue, VAT, COGS, inventory and Deposit-liability settlement exactly once; no receipt mutation or final treasury movement occurred.";
  }});
}
async function completeSaleApplicationRollback(A1) {
  const f=await reservation(A,A1,"CAP",20,10);const before=await completeSaleSnapshot(A,A1,f.reservationId,f.assetId,"CAP-EXEC");
  const payment=await models.ReservationPayment.findOne({where:{companyId:A,reservationId:f.reservationId,status:"posted"}});assert.ok(payment);
  assert.equal(before.reservation_status,"partially_paid");assert.equal(before.invoices,0);assert.equal(before.applications,0);assert.equal(before.sale_journals,0);assert.equal(before.stock_movements,0);assert.equal(before.idempotency_rows,0);assert.equal(before.receipts,1);
  await runMandatoryCell({id:"COMPLETE_SALE_ROLLBACK_DEPOSIT_APPLICATION_PERSISTENCE",title:"Complete-sale Deposit-application persistence rollback",expected:"application failure rolls back earlier Invoice, accounting and inventory staging plus every completion side effect",run:async r=>{
    const transactionProof=await withScopedFailure({target:models.ReservationPaymentApplication,method:"create",errorCode:"ACC_C16_C10_COMPLETE_SALE_DEPOSIT_APPLICATION_PERSISTENCE_FAILURE",verifyArgs:(values,opts)=>{assert.equal(values.companyId,A);assert.equal(values.reservationId,f.reservationId);assert.equal(values.reservationPaymentId,payment.id);assert.ok(values.finalInvoiceId.startsWith("INV-RES-"));assert.ok(Number(values.appliedAmount)>0);assert.ok(opts.transaction);},run:async observed=>{let err;try{await reservationService.completeSale({companyId:A,branchId:A1,user:actor,reservationId:f.reservationId,idempotencyKey:id("CAP-EXEC"),body:{}});}catch(e){err=e;}assert.equal(code(err),"ACC_C16_C10_COMPLETE_SALE_DEPOSIT_APPLICATION_PERSISTENCE_FAILURE");return observed();}});
    assert.deepEqual(transactionProof,{present:true,finished:"rollback"});r.transactionBoundary="ReservationPaymentApplication.create received the real completeSale transaction after Invoice/item/stock and Invoice plus Deposit-settlement journal staging, and before Reservation completion, idempotency success and the only commit.";r.sourceOrder="claim → validation/Invoice/items/asset/item/stock → Invoice journal → Deposit-settlement journal → ReservationPaymentApplication.create (injected) → Reservation completed → audit/notification → idempotency success → commit";r.applicationContract="one owned source payment, same Company/Branch/Reservation and final Invoice, positive amount 10.0000";r.transaction=transactionProof;
    const afterFailure=await completeSaleSnapshot(A,A1,f.reservationId,f.assetId,"CAP-EXEC");assert.deepEqual(afterFailure,before);r.before=before;r.afterFailure=afterFailure;
    const retry=await reservationService.completeSale({companyId:A,branchId:A1,user:actor,reservationId:f.reservationId,idempotencyKey:id("CAP-EXEC"),body:{}});assert.equal(retry.statusCode,201);const invoiceId=retry.responseBody.data.invoice.id;const afterRetry=await completeSaleSnapshot(A,A1,f.reservationId,f.assetId,"CAP-EXEC");const application=await models.ReservationPaymentApplication.findOne({where:{companyId:A,reservationId:f.reservationId}});assert.ok(application);assert.equal(application.reservationPaymentId,payment.id);assert.equal(application.finalInvoiceId,invoiceId);assert.equal(Number(application.appliedAmount),10);assert.equal(afterRetry.reservation_status,"completed");assert.equal(afterRetry.final_invoice_id,invoiceId);assert.equal(afterRetry.invoices,1);assert.equal(afterRetry.invoice_items,1);assert.equal(afterRetry.applications,1);assert.equal(Number(afterRetry.application_total),10);assert.equal(afterRetry.stock_movements,1);assert.equal(afterRetry.sale_journals,2);assert.equal(Number(afterRetry.sale_journal_debits),Number(afterRetry.sale_journal_credits));assert.equal(afterRetry.unbalanced_sale_journals,0);assert.equal(afterRetry.idempotency_rows,1);assert.equal(afterRetry.success_idempotency,1);assert.equal(afterRetry.completion_audit,1);assert.equal(Number(afterRetry.liability_balance),0);assert.equal(Number(afterRetry.ar_balance),10);assert.equal(afterRetry.receipt_snapshot_digest,before.receipt_snapshot_digest);
    const replay=await reservationService.completeSale({companyId:A,branchId:A1,user:actor,reservationId:f.reservationId,idempotencyKey:id("CAP-EXEC"),body:{}});const afterReplay=await completeSaleSnapshot(A,A1,f.reservationId,f.assetId,"CAP-EXEC");assert.equal(replay.statusCode,201);assert.equal(replay.responseBody.data.invoice.id,invoiceId);assert.deepEqual(afterReplay,afterRetry);
    r.actual="zero committed application-failure delta after staged Invoice/accounting/inventory work; same-key retry completed once with one correctly scoped application; replay created no duplicates";r.errorCode="ACC_C16_C10_COMPLETE_SALE_DEPOSIT_APPLICATION_PERSISTENCE_FAILURE";r.retry={key:"same key (claim row rolled back with the transaction)",state:"PASS",afterRetry};r.replay={state:"PASS",afterReplay};r.ownedIds={reservationId:f.reservationId,assetId:f.assetId,invoiceId};r.notes="No pre-sale Deposit VAT/revenue/COGS/inventory recognition exists. The successful application clears liability and settles AR once through the already staged final-sale journals; receipts remained immutable.";
  }});
}
async function completeSaleIdempotencyRollback(A1) {
  const f=await reservation(A,A1,"CSI",20,10);const before=await completeSaleSnapshot(A,A1,f.reservationId,f.assetId,"CSI-EXEC");
  const payment=await models.ReservationPayment.findOne({where:{companyId:A,reservationId:f.reservationId,status:"posted"}});assert.ok(payment);
  assert.equal(before.reservation_status,"partially_paid");assert.equal(before.reservation_completed_at,false);assert.equal(before.invoices,0);assert.equal(before.applications,0);assert.equal(before.sale_journals,0);assert.equal(before.stock_movements,0);assert.equal(before.idempotency_rows,0);assert.equal(before.completion_audit,0);assert.equal(before.receipts,1);
  await runMandatoryCell({id:"COMPLETE_SALE_ROLLBACK_IDEMPOTENCY_SUCCESS_PERSISTENCE",title:"Complete-sale idempotency success rollback",expected:"idempotency-success persistence failure rolls back every staged final-sale effect and the claimed key",run:async r=>{
    const transactionProof=await withScopedFailure({target:idempotencyService,method:"succeed",errorCode:"ACC_C16_C11_COMPLETE_SALE_IDEMPOTENCY_SUCCESS_PERSISTENCE_FAILURE",verifyArgs:({request,statusCode,responseBody,transaction})=>{assert.equal(request.companyId,A);assert.equal(request.scope,"reservation.complete");assert.equal(request.key,id("CSI-EXEC"));assert.equal(statusCode,201);assert.equal(responseBody.data.reservation.id,f.reservationId);assert.match(responseBody.data.invoice.id,/^INV-RES-/);assert.ok(transaction);},run:async observed=>{let err;try{await reservationService.completeSale({companyId:A,branchId:A1,user:actor,reservationId:f.reservationId,idempotencyKey:id("CSI-EXEC"),body:{}});}catch(e){err=e;}assert.equal(code(err),"ACC_C16_C11_COMPLETE_SALE_IDEMPOTENCY_SUCCESS_PERSISTENCE_FAILURE");return observed();}});
    assert.deepEqual(transactionProof,{present:true,finished:"rollback"});r.transactionBoundary="idempotencyService.succeed received the same completeSale transaction after Invoice/item/asset/stock, Invoice and Deposit-settlement journals, Deposit application, Reservation completion and audit/notification staging, and before the only commit.";r.sourceOrder="claim → validation/Invoice/items/asset/item/stock → Invoice journal → Deposit-settlement journal → application → Reservation completed → audit/notification → idempotency success (injected) → commit";r.transaction=transactionProof;
    const afterFailure=await completeSaleSnapshot(A,A1,f.reservationId,f.assetId,"CSI-EXEC");assert.deepEqual(afterFailure,before);r.before=before;r.afterFailure=afterFailure;
    const retry=await reservationService.completeSale({companyId:A,branchId:A1,user:actor,reservationId:f.reservationId,idempotencyKey:id("CSI-EXEC"),body:{}});assert.equal(retry.statusCode,201);const invoiceId=retry.responseBody.data.invoice.id;const afterRetry=await completeSaleSnapshot(A,A1,f.reservationId,f.assetId,"CSI-EXEC");const application=await models.ReservationPaymentApplication.findOne({where:{companyId:A,reservationId:f.reservationId}});assert.ok(application);assert.equal(application.reservationPaymentId,payment.id);assert.equal(application.finalInvoiceId,invoiceId);assert.equal(Number(application.appliedAmount),10);assert.equal(afterRetry.reservation_status,"completed");assert.equal(afterRetry.reservation_completed_at,true);assert.equal(afterRetry.final_invoice_id,invoiceId);assert.equal(afterRetry.invoices,1);assert.equal(afterRetry.invoice_items,1);assert.equal(afterRetry.applications,1);assert.equal(Number(afterRetry.application_total),10);assert.equal(afterRetry.stock_movements,1);assert.equal(afterRetry.sale_journals,2);assert.equal(Number(afterRetry.sale_journal_debits),Number(afterRetry.sale_journal_credits));assert.equal(afterRetry.unbalanced_sale_journals,0);assert.equal(afterRetry.idempotency_rows,1);assert.equal(afterRetry.idempotency_status,"succeeded");assert.equal(afterRetry.success_idempotency,1);assert.equal(afterRetry.idempotency_response_present,true);assert.equal(afterRetry.idempotency_invoice_id,invoiceId);assert.equal(afterRetry.completion_audit,1);assert.equal(Number(afterRetry.liability_balance),0);assert.equal(Number(afterRetry.ar_balance),10);assert.equal(afterRetry.receipt_snapshot_digest,before.receipt_snapshot_digest);
    const replay=await reservationService.completeSale({companyId:A,branchId:A1,user:actor,reservationId:f.reservationId,idempotencyKey:id("CSI-EXEC"),body:{}});const afterReplay=await completeSaleSnapshot(A,A1,f.reservationId,f.assetId,"CSI-EXEC");assert.equal(replay.statusCode,201);assert.equal(replay.responseBody.data.invoice.id,invoiceId);assert.deepEqual(afterReplay,afterRetry);
    r.actual="zero committed final-sale or idempotency failure delta; failed key was absent after rollback; same-key retry completed once and replay created no duplicates";r.errorCode="ACC_C16_C11_COMPLETE_SALE_IDEMPOTENCY_SUCCESS_PERSISTENCE_FAILURE";r.retry={key:"same key (claim row rolled back with the transaction)",state:"PASS",afterRetry};r.replay={state:"PASS",afterReplay};r.ownedIds={reservationId:f.reservationId,assetId:f.assetId,invoiceId};r.notes="The success persistence is inside the same Complete-sale transaction. The retry created one Invoice, application, balanced final-sale journals, stock movement, completion audit and idempotency response; original Deposit receipt snapshots remained immutable.";
  }});
}
function normalizeCell(cell) {
  const nested = Array.isArray(cell.cells) ? cell.cells.map(item => ({ id: item.id, status: item.status, errorCode: item.errorCode || null, writesDelta: item.writesDelta || null, replay: item.replay || null, equations: item.equations || null })).sort((a, b) => a.id.localeCompare(b.id)) : [];
  return { id: cell.id, status: cell.status, errorCode: cell.errorCode || null, total: cell.total ?? null, passed: cell.passed ?? null, failed: cell.failed ?? null, skipped: cell.skipped ?? null, retry: cell.retry?.state || null, replay: cell.replay?.state || null, nested, equations: cell.equations || null };
}
async function repeatabilitySnapshot() {
  const [accountBalances] = await q(`select code,coalesce(sum(balance),0)::text balance from accounts where company_id=$1 group by code order by code`, [A]);
  const [journalShape] = await q(`select source_type,count(*)::int journals,coalesce(sum(total_debit),0)::text debits,coalesce(sum(total_credit),0)::text credits from journal_entries where company_id=$1 group by source_type order by source_type`, [A]);
  const [idempotencyShape] = await q(`select scope,status,count(*)::int count from idempotency_requests where company_id=$1 group by scope,status order by scope,status`, [A]);
  const [auditShape] = await q(`select action,count(*)::int count from audit_logs where company_id=$1 group by action order by action`, [A]);
  return { artifactCounts: await tableCounts([A,B]), accountBalances, journalShape, idempotencyShape, auditShape };
}
function assertExternalEvidencePath(file, label) {
  assert.ok(file, `${label} is required`);
  const absolute = path.resolve(file), relative = path.relative(root, absolute);
  assert.ok(relative.startsWith("..") || path.isAbsolute(relative), `${label} must stay outside the repository`);
  return absolute;
}
async function finalRepeatabilityAndRegression() {
  const runLabel = ns.includes("-C15-RUN1-") ? "RUN1" : "RUN2";
  await runMandatoryCell({ id: "FINAL_REPEATABILITY_AND_REGRESSION", title: "Final fully owned Deposit lifecycle repeatability and regression", expected: "all prior mandatory suites pass with deterministic semantic evidence and exact owned cleanup", run: async result => {
    const suite = [
      ["DEPOSIT_ROLLBACK_JOURNAL_PERSISTENCE", topology => depositJournalRollback(topology.A1)], ["DEPOSIT_ROLLBACK_RECEIPT_PERSISTENCE", topology => depositReceiptRollback(topology.A1)], ["DEPOSIT_ROLLBACK_IDEMPOTENCY_SUCCESS_PERSISTENCE", topology => depositIdempotencyRollback(topology.A1)],
      ["REFUND_ROLLBACK_CASH_OUT_PERSISTENCE", topology => refundCashOutRollback(topology.A1)], ["REFUND_ROLLBACK_JOURNAL_PERSISTENCE", topology => refundJournalRollback(topology.A1)], ["REFUND_ROLLBACK_ALLOCATION_PERSISTENCE", topology => refundAllocationRollback(topology.A1)], ["REFUND_ROLLBACK_IDEMPOTENCY_SUCCESS_PERSISTENCE", topology => refundIdempotencyRollback(topology.A1)],
      ["COMPLETE_SALE_ROLLBACK_INVOICE_PERSISTENCE", topology => completeSaleInvoiceRollback(topology.A1)], ["COMPLETE_SALE_ROLLBACK_ACCOUNTING_PERSISTENCE", topology => completeSaleAccountingRollback(topology.A1)], ["COMPLETE_SALE_ROLLBACK_DEPOSIT_APPLICATION_PERSISTENCE", topology => completeSaleApplicationRollback(topology.A1)], ["COMPLETE_SALE_ROLLBACK_IDEMPOTENCY_SUCCESS_PERSISTENCE", topology => completeSaleIdempotencyRollback(topology.A1)],
      ["CONFIGURATION_AND_NO_FALLBACK_MATRIX", topology => configurationAndNoFallbackMatrix(topology.A1,topology.A2,topology.B1,topology.a1,topology.a2,topology.b1)], ["FINANCIAL_RECONCILIATION_MATRIX", topology => financialReconciliationMatrix(topology.A1,topology.a1)], ["ORPHAN_DUPLICATE_CROSS_SCOPE_AUDIT_MATRIX", topology => orphanDuplicateCrossScopeAuditMatrix(topology.A1,topology.A2,topology.B1,topology.a1)],
    ];
    const rebuild = async expanded => { const nextA1=await companyBranch(A,"A1"), nextA2=await companyBranch(A,"A2"), nextB1=await companyBranch(B,"B1"); const nextA1Accounts=await accounts(A,nextA1), nextA2Accounts=expanded ? await accounts(A,nextA2) : null, nextB1Accounts=expanded ? await accounts(B,nextB1) : null; return { A1:nextA1,A2:nextA2,B1:nextB1,a1:nextA1Accounts,a2:nextA2Accounts,b1:nextB1Accounts }; };
    await cleanup(); await zero(); const suiteSnapshots=[];
    for (const [id, execute] of suite) { const topology=await rebuild(id === "CONFIGURATION_AND_NO_FALLBACK_MATRIX"); await execute(topology); suiteSnapshots.push({ id, snapshot: await repeatabilitySnapshot() }); await cleanup(); await zero(); }
    const mandatory = cells.filter(cell => cell.id !== "FINAL_REPEATABILITY_AND_REGRESSION");
    assert.equal(mandatory.length, 14, "C15 must execute all 11 rollback suites plus configuration, reconciliation and integrity matrices");
    assert.ok(mandatory.every(cell => cell.status === "PASS"), "every prior mandatory suite must pass");
    const evidence = { version: 1, runLabel, normalized: { mandatory: mandatory.map(normalizeCell).sort((a,b) => a.id.localeCompare(b.id)), suiteSnapshots } };
    if (evidenceOut) fs.writeFileSync(assertExternalEvidencePath(evidenceOut, "--evidence-out"), JSON.stringify(evidence, null, 2));
    if (compareEvidence) {
      const expected = JSON.parse(fs.readFileSync(assertExternalEvidencePath(compareEvidence, "--compare-evidence"), "utf8"));
      assert.deepEqual(evidence.normalized, expected.normalized, "normalized C15 business outcomes must match RUN1 exactly");
      result.normalizedComparison = "PASS";
    }
    result[runLabel.toLowerCase()] = evidence;
    result.mandatoryCellInventory = mandatory.map(cell => ({ id: cell.id, status: cell.status }));
    result.notes = "Allowed differences are identities, timestamps, namespaces, correlation/process IDs and monotonic document numbers only; semantic totals, financials, replay, negative zero-write behavior and journal role-shape are compared exactly.";
    out("FINAL_REPEATABILITY_EVIDENCE", evidence);
  }});
}
async function cleanup() {
  const arr=`ARRAY['${A}','${B}']::text[]`;
  const sql=[
    `delete from journal_lines where journal_entry_id in (select id from journal_entries where company_id=any(${arr}))`,
    `delete from reservation_deposit_receipt_documents where company_id=any(${arr})`,
    `delete from reservation_deposit_receipt_sequences where company_id=any(${arr})`,
    `delete from reservation_refund_allocations where company_id=any(${arr})`,
    `delete from reservation_payment_applications where company_id=any(${arr})`,
    `delete from reservation_refunds where company_id=any(${arr})`,
    `delete from reservation_payments where company_id=any(${arr})`,
    `delete from cash_transactions where company_id=any(${arr})`,
    `delete from idempotency_requests where company_id=any(${arr})`,
    `delete from audit_logs where company_id=any(${arr})`,
    `delete from notifications where company_id=any(${arr})`,
    `delete from stock_movements where company_id=any(${arr})`,
    `delete from invoice_items where invoice_id in (select id from invoices where company_id=any(${arr}))`,
    `delete from invoices where company_id=any(${arr})`,
    `delete from journal_entries where company_id=any(${arr})`,
    `delete from asset_events where asset_id in (select id from assets where company_id=any(${arr}))`,
    `delete from reservation_items where company_id=any(${arr})`,
    `delete from reservations where company_id=any(${arr})`,
    `delete from cash_register_sessions where company_id=any(${arr})`,
    `delete from branch_financial_mappings where company_id=any(${arr})`,
    `delete from system_account_roles where company_id=any(${arr})`,
    `delete from branch_customers where company_id=any(${arr})`,
    `delete from customers where company_id=any(${arr})`,
    `delete from assets where company_id=any(${arr})`,
    `delete from accounts where company_id=any(${arr})`,
    `delete from settings where company_id=any(${arr})`,
    `delete from branches where company_id=any(${arr})`,
    `delete from companies where id=any(${arr})`];
  for(const s of sql) await q(s);
}
async function zero() { const c=await tableCounts([A,B]); for(const v of Object.values(c)) assert.equal(v,0); out("ZERO_RESIDUE_PASS",c); }
async function main() {
  out("PREFLIGHT",{namespace:ns, mode: importOnly ? "import-only" : "write"}); assertWriteGuard(); await target(); await zero(); out("CLEANUP_DRY_RUN_PASS");
  if(importOnly) { out("IMPORT_ONLY_PASS"); return; }
  const A1=await companyBranch(A,"A1"), A2=await companyBranch(A,"A2"), B1=await companyBranch(B,"B1");
  const a1=await accounts(A,A1), a2=(c16C12 || c16C15) ? await accounts(A,A2) : null, b1=await accounts(B,B1); out("FIXTURE_READINESS_PASS",{A1,A2,B1,session:a1.session.id,alternateSession:a2?.session.id||null});
  if (c16C1) await depositJournalRollback(A1);
  else if (c16C2) await depositReceiptRollback(A1);
  else if (c16C3) await depositIdempotencyRollback(A1);
  else if (c16C4) await refundCashOutRollback(A1);
  else if (c16C5) await refundJournalRollback(A1);
  else if (c16C6) await refundAllocationRollback(A1);
  else if (c16C7) await refundIdempotencyRollback(A1);
  else if (c16C8) await completeSaleInvoiceRollback(A1);
  else if (c16C9) await completeSaleAccountingRollback(A1);
  else if (c16C10) await completeSaleApplicationRollback(A1);
  else if (c16C11) await completeSaleIdempotencyRollback(A1);
  else if (c16C12) await configurationAndNoFallbackMatrix(A1,A2,B1,a1,a2,b1);
  else if (c16C13) await financialReconciliationMatrix(A1,a1);
  else if (c16C14) await orphanDuplicateCrossScopeAuditMatrix(A1,A2,B1,a1);
  else if (c16C15) await finalRepeatabilityAndRegression();
  else { await configuration(A1,A2,B1,a1); const scenario=await financialScenario(A1); await orphanAudit(scenario); }
  assert.ok(cells.every(c=>c.status==="PASS"),"mandatory cell gate");
  out("FINAL_REGRESSION_READY");
}
if (require.main === module) main().catch(e=>{console.error("HARNESS_FAILURE",e.original?.message||e.parent?.message||e.stack||e.message);process.exitCode=1;}).finally(async()=>{try{await cleanup();await zero();}catch(e){console.error("CLEANUP_FAILURE",e.original?.message||e.parent?.message||e.stack||e.message);process.exitCode=1;}try{await models.sequelize.close();}catch(_){}});
module.exports = { runMandatoryCell, runConfigurationCell, withScopedFailure, isAllowedNamespace, decimalUnits, assertJournalBalance, signedLineMovement, assertNoIntegrityCounts, normalizeCell };
