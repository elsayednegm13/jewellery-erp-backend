const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const runtime = require(path.join(__dirname, "../src/services/inventory-v2-runtime.service"));
const exactFailedRequest = JSON.parse(fs.readFileSync(
  path.join(__dirname, "../acceptance-artifacts/loose-pearl/DARFUS-LOOSE-PEARL-OFFICIAL-ACCEPTANCE-WITH-SCOPED-HISTORICAL-BASELINE-EXCEPTION/09-exact-request.json"),
  "utf8"
)).exactRequest;

test("exact failed Loose Pearl shape derives ordinal 1 without client pieceIndex", () => {
  const piece = exactFailedRequest.items[0].perPiece[0];
  assert.equal(piece.pieceIndex, undefined);
  const ordinal = runtime.resolveReceiptEvidenceOrdinal({ piece, pieceIndex: 0 });
  assert.equal(ordinal, 1);
  assert.equal(Number.isFinite(ordinal), true);
  assert.equal(Number.isInteger(ordinal), true);
});

test("explicit canonical pieceIndex 0 remains ordinal 1", () => {
  assert.equal(runtime.resolveReceiptEvidenceOrdinal({ piece: { pieceIndex: 0 }, pieceIndex: 9 }), 1);
});

test("multiple runtime array positions derive deterministic ordinals 1, 2, 3", () => {
  assert.deepEqual([0, 1, 2].map((pieceIndex) => runtime.resolveReceiptEvidenceOrdinal({ piece: {}, pieceIndex })), [1, 2, 3]);
});

test("invalid canonical metadata safely falls back to validated array position", () => {
  assert.equal(runtime.resolveReceiptEvidenceOrdinal({ piece: { pieceIndex: NaN }, pieceIndex: 0 }), 1);
  assert.equal(runtime.resolveReceiptEvidenceOrdinal({ piece: { pieceIndex: "invalid" }, pieceIndex: 2 }), 3);
});

test("missing canonical metadata and fallback fails closed before SQL", () => {
  assert.throws(
    () => runtime.resolveReceiptEvidenceOrdinal({ piece: { pieceIndex: Infinity } }),
    /INVENTORY_V2_RECEIPT_EVIDENCE_ORDINAL_INVALID/
  );
});

test("receipt evidence SQL receives a validated ordinal value", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/services/inventory-v2-runtime.service.js"), "utf8");
  assert.match(source, /const ordinal = resolveReceiptEvidenceOrdinal\(\{ piece, pieceIndex \}\)/);
  assert.match(source, /ordinal, receivedAt, receivedBy/);
  assert.doesNotMatch(source, /ordinal:\s*piece\.pieceIndex\s*\+\s*1/);
});
