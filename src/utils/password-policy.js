const COMMON_PASSWORDS = new Set([
  "password",
  "password1",
  "password123",
  "1234567890",
  "qwerty12345",
  "admin12345",
  "darfuS123!".toLowerCase(),
  "welcome123",
  "letmein123"
]);

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function validatePasswordPolicy(password, context = {}) {
  const errors = [];
  const value = typeof password === "string" ? password : "";
  if (value.length < 10) errors.push("Password must be at least 10 characters.");
  if (!/[A-Z]/.test(value)) errors.push("Password must include an uppercase letter.");
  if (!/[a-z]/.test(value)) errors.push("Password must include a lowercase letter.");
  if (!/\d/.test(value)) errors.push("Password must include a digit.");
  if (!/[^A-Za-z0-9]/.test(value)) errors.push("Password must include a symbol.");

  const lowered = value.toLowerCase();
  if (COMMON_PASSWORDS.has(lowered)) errors.push("Password is too common.");

  const email = normalizeText(context.email);
  const emailName = email.includes("@") ? email.split("@")[0] : "";
  const nameParts = [
    ...normalizeText(context.firstName).split(/\s+/),
    ...normalizeText(context.lastName).split(/\s+/),
    ...normalizeText(context.name).split(/\s+/),
    emailName
  ].filter((part) => part && part.length >= 4);
  if (nameParts.some((part) => lowered.includes(part))) {
    errors.push("Password must not include obvious account identity text.");
  }

  if (errors.length) {
    const { ValidationError } = require("./errors");
    throw new ValidationError("Password does not meet policy.", { password: errors });
  }
}

function generatePolicyCompliantPassword(randomBytes) {
  const crypto = require("crypto");
  const entropy = crypto.randomBytes(randomBytes || 18).toString("base64url");
  return `Aa1!${entropy}`;
}

module.exports = {
  validatePasswordPolicy,
  generatePolicyCompliantPassword
};
