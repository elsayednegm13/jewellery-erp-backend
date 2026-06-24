/**
 * Accounting journal entries pagination Phase 8B — READ-ONLY verify (GET only).
 *
 * Confirms /journal-entries honours page/pageSize, returns pagination metadata,
 * searches text-safe fields without applying ILIKE to the status ENUM, and
 * supports the two simplified UI status groups through a JournalEntry-scoped
 * status IN filter. No journal entries or other records are written.
 *
 * Run from repo root: node backend/scripts/verify-accounting-pagination.js
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const { JWT_SECRET } = require("../src/config/security");
const { sequelize } = require("../src/models");

const COMPANY = "CMP-DEMO";
const BALANCED_STATUSES = new Set(["balanced", "posted"]);
const PENDING_STATUSES = new Set(["pending", "draft", "reversed"]);
let passed = 0;

function check(condition, message) {
  if (!condition) throw new Error("FAILED: " + message);
  passed++;
  console.log("  ✓ " + message);
}

const filters = (value) => encodeURIComponent(JSON.stringify(value));
const ids = (payload) => new Set((payload.items || []).map((item) => item.id));

let base;
let token;

async function get(path) {
  const response = await fetch(`${base}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Company-ID": COMPANY,
    },
  });
  let json = null;
  try {
    json = await response.json();
  } catch {}
  return { status: response.status, json };
}

(async () => {
  await sequelize.authenticate();
  const server = app.listen(0);
  await new Promise((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  token = jwt.sign({ userId: "USR-ADMIN" }, JWT_SECRET, { expiresIn: "1h" });

  try {
    console.log("frontend pagination contract:");
    const pageSource = fs.readFileSync(
      path.resolve(__dirname, "../../app/[locale]/(dashboard)/accounting/page.tsx"),
      "utf8",
    );
    const hookSource = fs.readFileSync(path.resolve(__dirname, "../../hooks/use-accounting.ts"), "utf8");
    check(pageSource.includes("resultCount={resultTotal}"), "toolbar resultCount uses the full matching total");
    check(pageSource.includes("const PAGE_SIZE_OPTIONS = [10, 20, 50]"), "page-size options are 10/20/50");
    check(
      ["handleSearchChange", "handleStatusChange", "handlePageSizeChange", "resetFilters"].every((handler) => {
        const start = pageSource.indexOf(`const ${handler}`);
        return start >= 0 && pageSource.slice(start, start + 220).includes("setPage(1)");
      }),
      "search, status, page-size, and reset return to page 1",
    );
    check(
      hookSource.includes('balanced: ["balanced", "posted"]') &&
        hookSource.includes('pending: ["pending", "draft", "reversed"]'),
      "hook maps both UI status groups to their approved backend statuses",
    );
    check(
      pageSource.includes('value: money(486250)') &&
        pageSource.includes('value: money(1240800)') &&
        pageSource.includes('value: money(328900)') &&
        pageSource.includes('value: money(176450)'),
      "financial cards remain independent placeholder values",
    );
    check(
      pageSource.includes('setEntries((current) => [{ id: `JE-${Date.now().toString().slice(-9)}`'),
      "existing localStorage create-modal path remains unchanged",
    );

    console.log("pagination metadata + page boundaries:");
    const page1 = await get("/journal-entries?page=1&pageSize=10&sortBy=id&sortDirection=asc");
    check(page1.status === 200, "GET /journal-entries?page=1&pageSize=10 returns 200");
    check(
      page1.json.page === 1 &&
        page1.json.pageSize === 10 &&
        typeof page1.json.total === "number" &&
        typeof page1.json.totalPages === "number",
      "returns {page,pageSize,total,totalPages}",
    );
    check(Array.isArray(page1.json.items) && page1.json.items.length <= 10, "page honours pageSize (10 or fewer)");
    check(page1.json.totalPages === Math.ceil(page1.json.total / 10), "totalPages = ceil(total/pageSize)");

    if (page1.json.total > 10) {
      const page2 = await get("/journal-entries?page=2&pageSize=10&sortBy=id&sortDirection=asc");
      check(page2.status === 200 && page2.json.page === 2, "page 2 returns successfully");
      check(
        [...ids(page2.json)].every((id) => !ids(page1.json).has(id)),
        "page 1 and page 2 do not overlap",
      );
    } else {
      console.log("  (10 or fewer journal entries — skipping overlap check)");
    }

    console.log("\ntext-safe server search:");
    const all = await get("/journal-entries?page=1&pageSize=250");
    check(all.status === 200, "unfiltered journal entry list returns 200");
    const sample = (all.json.items || []).find((entry) => entry.description || entry.date);
    if (sample?.description) {
      const term = String(sample.description).trim().split(/\s+/)[0];
      const searched = await get(`/journal-entries?page=1&pageSize=250&search=${encodeURIComponent(term)}`);
      check(searched.status === 200, "description search does not fail on status ENUM");
      check(
        searched.json.items.some((entry) =>
          String(entry.description || "").toLocaleLowerCase().includes(term.toLocaleLowerCase()),
        ),
        "description search returns a matching entry",
      );
    }
    if (sample?.date) {
      const dateSearch = await get(`/journal-entries?page=1&pageSize=250&search=${encodeURIComponent(sample.date)}`);
      check(dateSearch.status === 200, "date search returns 200");
      check(dateSearch.json.items.some((entry) => entry.date === sample.date), "date search returns a matching entry");
    }
    const noMatch = await get("/journal-entries?page=1&pageSize=250&search=zzzzzznomatch");
    check(noMatch.status === 200 && noMatch.json.total === 0, "non-matching search returns zero results");

    console.log("\nserver-side status groups:");
    const balanced = await get(
      `/journal-entries?page=1&pageSize=250&filters=${filters({ status: ["balanced", "posted"] })}`,
    );
    check(balanced.status === 200, "balanced status group returns 200");
    check(
      balanced.json.items.every((entry) => BALANCED_STATUSES.has(entry.status)),
      "balanced group contains only balanced/posted",
    );

    const pending = await get(
      `/journal-entries?page=1&pageSize=250&filters=${filters({ status: ["pending", "draft", "reversed"] })}`,
    );
    check(pending.status === 200, "pending status group returns 200");
    check(
      pending.json.items.every((entry) => PENDING_STATUSES.has(entry.status)),
      "pending group contains only pending/draft/reversed",
    );

    const combined = await get(
      `/journal-entries?page=1&pageSize=250&search=zzzzzznomatch&filters=${filters({ status: ["balanced", "posted"] })}`,
    );
    check(combined.status === 200 && combined.json.total === 0, "search and status group compose server-side");

    console.log(`\nRESULT: all ${passed} checks passed. (read-only GET, no writes)`);
  } finally {
    server.close();
    await sequelize.close();
  }
  process.exit(0);
})().catch((error) => {
  console.error("VERIFY FAILED:", error.message);
  process.exit(1);
});
