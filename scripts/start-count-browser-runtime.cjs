"use strict";

const { spawn } = require("node:child_process");
const path = require("node:path");

const cloneDb = process.argv[2];
const frontendRoot = process.argv[3];
if (!cloneDb || !frontendRoot) throw new Error("Usage: node start-count-browser-runtime.cjs <cloneDb> <frontendRoot>");

const env = {
  ...process.env,
  NODE_ENV: "development",
  PORT: "8001",
  DB_HOST: "127.0.0.1",
  DB_PORT: "5433",
  DB_NAME: cloneDb,
  DB_USER: "postgres",
  DB_PASS: "postgres",
  DB_PASSWORD: "postgres",
  DATABASE_URL: "",
  REDIS_URL: "redis://127.0.0.1:6379",
  CORS_ALLOWED_ORIGINS: "http://localhost:3001,http://127.0.0.1:3001",
  FRONTEND_URL: "http://localhost:3001",
  ALLOW_RUNTIME_ADMIN_BOOTSTRAP: "false",
  NEXT_DIST_DIR: ".next-count-clone",
};

const redacted = (chunk) => String(chunk).replace(/(authorization|token|secret|password|cookie)=[^\s]+/gi, "$1=[REDACTED]");
const backend = spawn(process.execPath, ["src/server.js"], { cwd: path.resolve(__dirname, ".."), env, stdio: ["ignore", "pipe", "pipe"] });
const frontend = process.platform === "win32"
  ? spawn("cmd.exe", ["/d", "/s", "/c", "npm.cmd run start -- -p 3001"], { cwd: frontendRoot, env, stdio: ["ignore", "pipe", "pipe"] })
  : spawn("npm", ["run", "start", "--", "-p", "3001"], { cwd: frontendRoot, env, stdio: ["ignore", "pipe", "pipe"] });
backend.stdout.on("data", (chunk) => process.stdout.write(`[clone-backend] ${redacted(chunk)}`));
backend.stderr.on("data", (chunk) => process.stderr.write(`[clone-backend] ${redacted(chunk)}`));
frontend.stdout.on("data", (chunk) => process.stdout.write(`[clone-frontend] ${redacted(chunk)}`));
frontend.stderr.on("data", (chunk) => process.stderr.write(`[clone-frontend] ${redacted(chunk)}`));

function stop() {
  if (!backend.killed) backend.kill("SIGTERM");
  if (!frontend.killed) frontend.kill("SIGTERM");
  setTimeout(() => {
    if (!backend.killed) backend.kill("SIGKILL");
    if (!frontend.killed) frontend.kill("SIGKILL");
  }, 2500).unref();
}
process.once("SIGINT", () => { stop(); setTimeout(() => process.exit(0), 3000).unref(); });
process.once("SIGTERM", () => { stop(); setTimeout(() => process.exit(0), 3000).unref(); });
backend.once("exit", (code) => { if (code && code !== 0) process.exitCode = 1; });
frontend.once("exit", (code) => { if (code && code !== 0) process.exitCode = 1; });
