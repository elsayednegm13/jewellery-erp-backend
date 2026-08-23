"use strict";

const { randomUUID } = require("crypto");

const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{8,128}$/;

function requestIdMiddleware(req, res, next) {
  const inbound = req.get("X-Correlation-ID") || req.get("X-Request-ID");
  req.requestId = typeof inbound === "string" && REQUEST_ID_RE.test(inbound) ? inbound : randomUUID();
  res.setHeader("X-Request-ID", req.requestId);
  next();
}

module.exports = requestIdMiddleware;
