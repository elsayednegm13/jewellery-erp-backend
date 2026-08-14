"use strict";

const START_TIME = Symbol("requestTerminalStartTime");

function durationMs(start, end = process.hrtime.bigint()) {
  if (typeof start !== "bigint" || typeof end !== "bigint" || end < start) return "0.000";
  return (Number(end - start) / 1_000_000).toFixed(3);
}

function classifyOutcome(req, res) {
  if (req.aborted) return "aborted";
  if (!res.writableFinished) return "client_disconnected";
  return "completed";
}

function requestTerminalLogging(req, res, next) {
  req[START_TIME] = process.hrtime.bigint();
  next();
}

function terminalLogFields(req, res) {
  return {
    duration: durationMs(req[START_TIME]),
    outcome: classifyOutcome(req, res)
  };
}

module.exports = {
  classifyOutcome,
  durationMs,
  requestTerminalLogging,
  terminalLogFields
};
