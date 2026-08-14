const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const pagePath = path.join(
  __dirname,
  "..",
  "..",
  "app",
  "[locale]",
  "(dashboard)",
  "suppliers",
  "purchases",
  "page.tsx",
);
const page = fs.readFileSync(pagePath, "utf8");

test("profile switch has one monotonic generation and abort boundary", () => {
  assert.match(page, /profileGenerationRef = useRef\(0\)/);
  assert.match(page, /previewSequenceRef = useRef\(0\)/);
  assert.match(page, /previewAbortRef = useRef<AbortController \| null>\(null\)/);
  assert.match(page, /const handleInventoryProfileChange = \(nextProfile: string\)/);
  assert.match(page, /profileGenerationRef\.current \+= 1/);
  assert.match(page, /previewAbortRef\.current\?\.abort\(\)/);
});

test("profile-owned fields are cleared atomically before the new profile is committed", () => {
  assert.match(page, /const resetProfileOwnedFields = \(piece: ReceivePieceDraft\)/);
  assert.match(page, /description: ""/);
  assert.match(page, /certificateIssuer: ""/);
  assert.match(page, /certificateNumber: ""/);
  assert.match(page, /masterData: \{\}/);
  assert.match(page, /setCanonicalPreview\(null\)/);
  assert.match(page, /setAcceptedPreviewKey\(""\)/);
  assert.match(page, /setProfileTransitionPending\(true\)/);
  assert.match(page, /setInventoryProfile\(nextProfile\)/);
  assert.doesNotMatch(page, /previousProfileRef/);
});

test("preview is latest-request-wins and aborts cannot publish unavailable", () => {
  assert.match(page, /signal: controller\.signal/);
  assert.match(page, /sequence !== previewSequenceRef\.current/);
  assert.match(page, /generation !== profileGenerationRef\.current/);
  assert.match(page, /const aborted = controller\.signal\.aborted/);
  assert.match(page, /acceptedPreviewKey === previewInputKey/);
  assert.match(page, /acceptedPreviewGeneration === profileGenerationRef\.current/);
});

test("pending preview clears stale financial display and locks submit", () => {
  assert.match(page, /const previewPending = isApi/);
  assert.match(page, /جاري إعادة الحساب/);
  assert.match(page, /profileTransitionPending \|\| \(!isQuantityBased && isApi && !previewIsCurrent\)/);
  assert.match(page, /submitGeneration = profileGenerationRef\.current/);
  assert.match(page, /profileGenerationRef\.current !== submitGeneration/);
});

test("preview guard blocks avoidable incomplete profile-switch requests", () => {
  assert.match(page, /const previewInputReady = useMemo\(\(\) =>/);
  assert.match(page, /!assetName\.trim\(\)/);
  assert.match(page, /parseDecimal\(piece\.grossWeight\) <= 0/);
  assert.match(page, /parseDecimal\(piece\.purchaseGoldRate\) <= 0/);
  assert.match(page, /selectedProfileContract\.required\.includes\("condition"\)/);
  assert.match(page, /!previewInputReady/);
  assert.match(page, /previewState === "loading"/);
});
