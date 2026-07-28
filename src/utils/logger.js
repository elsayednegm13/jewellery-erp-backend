const winston = require("winston");
const { redactString, redactValue } = require("./log-redaction");

const redactLogInfo = winston.format((info) => {
  info.message = redactString(info.message);
  if (info.stack) info.stack = redactString(info.stack);
  for (const key of Object.keys(info)) {
    if (!['level', 'message', 'timestamp', 'stack'].includes(key)) info[key] = redactValue(info[key], key);
  }
  return info;
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    redactLogInfo(),
    winston.format.json()
  ),
  defaultMeta: { service: "darfus-erp" },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(
          (info) => `${info.timestamp} ${info.level}: ${info.message}${info.stack ? `\n${info.stack}` : ""}`
        )
      )
    })
  ]
});

module.exports = logger;
