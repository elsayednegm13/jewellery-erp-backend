"use strict";

const SENSITIVE_KEY = /(?:authorization|cookie|password|token|secret|api[_-]?key|database[_-]?url|db[_-]?(?:user|password|pass)|email|login|identifier)/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const DATABASE_URL = /postgres(?:ql)?:\/\/[^\s"'}]+/gi;
const BEARER = /\bBearer\s+[^\s,;"'}]+/gi;
const JWT = /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g;
const KEY_VALUE = /((?:["']?)(?:authorization|cookie|password|passwordconfirmation|currentpassword|token|refreshtoken|access[_-]?token|secret|api[_-]?key|email|login|identifier)(?:["']?)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}\]]+)/gi;

function redactString(value) {
  return String(value ?? "")
    .replace(DATABASE_URL, "[REDACTED_DATABASE_URL]")
    .replace(BEARER, "Bearer [REDACTED]")
    .replace(JWT, "[REDACTED_TOKEN]")
    .replace(KEY_VALUE, "$1[REDACTED]")
    .replace(EMAIL, "[REDACTED_EMAIL]");
}

function redactValue(value, key = "") {
  if (SENSITIVE_KEY.test(String(key))) return "[REDACTED]";
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactValue(entryValue, entryKey)]));
  }
  return value;
}

module.exports = { redactString, redactValue, SENSITIVE_KEY };
