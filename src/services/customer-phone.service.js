"use strict";

const { AppError } = require("../utils/errors");
const {
  isSupportedCountry,
  parsePhoneNumberFromString,
} = require("libphonenumber-js/max");

const PHONE_COUNTRY_PATTERN = /^[A-Z]{2}$/;

// Kept for legacy read-only consumers. New customer identity decisions must
// use canonicalizeCustomerPhone() with an explicit country instead.
function normalizePhone(phone) {
  if (phone === null || phone === undefined) return "";
  return String(phone).replace(/[^0-9]/g, "").replace(/^0+/, "");
}

function normalizePhoneCountry(phoneCountry) {
  if (phoneCountry === null || phoneCountry === undefined) return "";
  const value = String(phoneCountry).trim().toUpperCase();
  if (!PHONE_COUNTRY_PATTERN.test(value) || !isSupportedCountry(value)) return "";
  return value;
}

function invalidPhoneResult(rawPhone, phoneCountry, errorCode) {
  return {
    rawPhone: rawPhone === null || rawPhone === undefined ? "" : String(rawPhone),
    phoneCountry: normalizePhoneCountry(phoneCountry),
    canonicalPhone: null,
    isValid: false,
    errorCode,
  };
}

function canonicalizeCustomerPhone(rawPhone, phoneCountry) {
  const raw = rawPhone === null || rawPhone === undefined ? "" : String(rawPhone);
  const country = normalizePhoneCountry(phoneCountry);
  if (!country) return invalidPhoneResult(raw, phoneCountry, "CUSTOMER_PHONE_COUNTRY_REQUIRED");
  if (!raw.trim()) return invalidPhoneResult(raw, country, "CUSTOMER_PHONE_REQUIRED");

  const parsed = parsePhoneNumberFromString(raw, { defaultCountry: country, extract: false });
  if (!parsed || parsed.ext || !parsed.isValid()) {
    return invalidPhoneResult(raw, country, "CUSTOMER_PHONE_INVALID");
  }
  if (parsed.country && parsed.country !== country) {
    return invalidPhoneResult(raw, country, "CUSTOMER_PHONE_COUNTRY_MISMATCH");
  }

  return {
    rawPhone: raw,
    phoneCountry: country,
    canonicalPhone: parsed.number,
    isValid: true,
    errorCode: null,
  };
}

/**
 * Read-only POS search interpretation. This deliberately does not infer a
 * country, persist anything, or replace the explicit phone authority used by
 * customer create/edit. An international-looking query is canonicalized only
 * when it is already self-contained (+... or 00...) and valid.
 */
function normalizeCustomerPhoneSearchInput(rawPhone) {
  const raw = rawPhone === null || rawPhone === undefined ? "" : String(rawPhone);
  const trimmed = raw.trim();
  const normalizedInternational = trimmed.replace(/^00/, "+");
  const digits = trimmed.replace(/[^0-9]/g, "");
  const hasInternationalPrefix = normalizedInternational.startsWith("+");

  if (hasInternationalPrefix) {
    const parsed = parsePhoneNumberFromString(normalizedInternational, { extract: false });
    if (parsed && !parsed.ext && parsed.isValid()) {
      return {
        raw,
        digits,
        canonicalPhone: parsed.number,
        isExactCanonical: true,
      };
    }
  }

  return {
    raw,
    digits,
    canonicalPhone: null,
    isExactCanonical: false,
  };
}

function assertCanonicalCustomerPhone(rawPhone, phoneCountry) {
  const result = canonicalizeCustomerPhone(rawPhone, phoneCountry);
  if (result.isValid) return result;

  const messages = {
    CUSTOMER_PHONE_COUNTRY_REQUIRED: "A supported two-letter phone country code is required.",
    CUSTOMER_PHONE_REQUIRED: "Customer phone is required.",
    CUSTOMER_PHONE_INVALID: "Customer phone is invalid for the selected country.",
    CUSTOMER_PHONE_COUNTRY_MISMATCH: "Customer phone does not belong to the selected country.",
  };
  const fieldErrors = {};
  if (result.errorCode === "CUSTOMER_PHONE_COUNTRY_REQUIRED" || result.errorCode === "CUSTOMER_PHONE_COUNTRY_MISMATCH") {
    fieldErrors.phoneCountry = [messages[result.errorCode]];
  } else {
    fieldErrors.phone = [messages[result.errorCode] || "Customer phone is invalid."];
  }
  throw new AppError(
    messages[result.errorCode] || "Customer phone is invalid.",
    422,
    result.errorCode || "CUSTOMER_PHONE_INVALID",
    fieldErrors,
  );
}

module.exports = {
  PHONE_COUNTRY_PATTERN,
  normalizePhone,
  normalizePhoneCountry,
  canonicalizeCustomerPhone,
  normalizeCustomerPhoneSearchInput,
  assertCanonicalCustomerPhone,
};
