"use strict";

const STATUS_DEFAULTS = {
  400: ["BAD_REQUEST", "The request could not be processed."],
  401: ["UNAUTHORIZED", "Authentication is required."],
  403: ["FORBIDDEN", "You do not have access to this resource."],
  404: ["RESOURCE_NOT_FOUND", "The requested resource was not found."],
  409: ["STATE_CONFLICT", "The requested action conflicts with the current state."],
  422: ["VALIDATION_FAILED", "Please correct the highlighted fields."],
  429: ["RATE_LIMITED", "Too many requests. Please try again shortly."],
  500: ["INTERNAL_SERVER_ERROR", "An unexpected server error occurred."],
};

const CODE_RE = /^[A-Z][A-Z0-9_]{1,127}$/;

function safeCode(value, fallback) {
  return typeof value === "string" && CODE_RE.test(value) ? value : fallback;
}

function safeMessage(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 512) : fallback;
}

function normalizeFields(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const fields = {};
  for (const [key, messages] of Object.entries(value)) {
    if (!/^[A-Za-z0-9_.\[\]-]{1,128}$/.test(key)) continue;
    const normalized = (Array.isArray(messages) ? messages : [messages])
      .filter((message) => typeof message === "string" && message.trim())
      .map((message) => message.trim().slice(0, 256));
    if (normalized.length) fields[key] = normalized;
  }
  return Object.keys(fields).length ? fields : null;
}

function normalizeDetails(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const details = {};
  for (const [key, item] of Object.entries(value)) {
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(key)) continue;
    if (typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item))) details[key] = item;
    else if (typeof item === "string" && item.trim()) details[key] = item.trim().slice(0, 256);
  }
  return Object.keys(details).length ? details : null;
}

function canonicalErrorPayload({ status, code, message, fields, details, requestId }) {
  const [defaultCode, defaultMessage] = STATUS_DEFAULTS[status] || STATUS_DEFAULTS[500];
  return {
    success: false,
    error: {
      code: safeCode(code, defaultCode),
      message: safeMessage(message, defaultMessage),
      details: normalizeDetails(details),
      fields: normalizeFields(fields),
      requestId: typeof requestId === "string" ? requestId.slice(0, 128) : null,
    },
  };
}

function normalizeErrorResponse(body, status, requestId) {
  const nested = body && typeof body === "object" && body.error && typeof body.error === "object" ? body.error : {};
  const [defaultCode, defaultMessage] = STATUS_DEFAULTS[status] || STATUS_DEFAULTS[500];
  return canonicalErrorPayload({
    status,
    code: nested.code || body?.errorCode || body?.code || defaultCode,
    // Route-level 5xx responses are never trusted to contain a safe message:
    // historic health and ORM paths sometimes embedded driver text there.
    message: status >= 500 ? defaultMessage : (nested.message || body?.message || defaultMessage),
    fields: nested.fields || nested.fieldErrors || body?.fields || body?.fieldErrors || body?.errors,
    details: nested.details || body?.details || body?.linked,
    requestId: nested.requestId || body?.requestId || body?.correlationId || requestId,
  });
}

module.exports = { canonicalErrorPayload, normalizeErrorResponse, normalizeFields };
