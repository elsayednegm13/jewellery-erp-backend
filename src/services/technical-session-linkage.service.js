"use strict";

const crypto = require("crypto");

function technicalSessionFingerprint(sessionId) {
  if (!sessionId) return null;
  return crypto.createHash("sha256").update(String(sessionId)).digest("hex");
}

module.exports = {
  technicalSessionFingerprint
};
