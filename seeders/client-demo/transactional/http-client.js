"use strict";

const crypto = require("crypto");
const http = require("http");
const path = require("path");
const config = require("./config");

// Import real Express app
const app = require(path.resolve(__dirname, "..", "..", "..", "src", "app"));

let server = null;
let baseUrl = "";
let authToken = "";

/**
 * Generate stable UUID-compatible keys from fixed seed names using crypto.
 */
function deterministicUuid(seed) {
  const hash = crypto.createHash("sha256").update(seed).digest("hex");
  const p1 = hash.slice(0, 8);
  const p2 = hash.slice(8, 12);
  const p3 = hash.slice(12, 16);
  const p4 = hash.slice(16, 20);
  const p5 = hash.slice(20, 32);
  return `${p1}-${p2}-${p3}-${p4}-${p5}`;
}

/**
 * Boots the Express app in-process on an ephemeral localhost port.
 */
function startServer() {
  return new Promise((resolve, reject) => {
    // Listen on ephemeral port (0) on localhost
    server = app.listen(0, "127.0.0.1", (err) => {
      if (err) return reject(err);
      const address = server.address();
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve(baseUrl);
    });
  });
}

/**
 * Closes the Express server instance cleanly.
 */
function stopServer() {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => {
        server = null;
        resolve();
      });
    } else {
      resolve();
    }
  });
}

/**
 * Perform login through the real auth endpoint to retrieve a JWT token.
 */
async function login() {
  const url = `${baseUrl}/api/v1/auth/login`;
  const payload = {
    email: config.ADMIN_EMAIL,
    password: config.ADMIN_PASSWORD
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Login failed with status ${response.status}: ${text}`);
  }

  const json = await response.json();
  if (!json.success || !json.data || !json.data.token) {
    throw new Error("Login response was missing authentication token.");
  }

  authToken = json.data.token;
  return authToken;
}

/**
 * Perform an authenticated HTTP request against the in-process server.
 */
async function request(method, path, body = null, idempotencyKey = null, branchId = config.DEFAULT_BRANCH_ID) {
  if (!baseUrl) {
    throw new Error("HTTP client server is not started.");
  }
  if (!authToken && !path.includes("/auth/login")) {
    throw new Error("HTTP client is not authenticated. Call login() first.");
  }

  const url = `${baseUrl}${path}`;
  const headers = {
    "Content-Type": "application/json",
    "X-Company-ID": config.DEFAULT_COMPANY_ID,
    "X-Branch-ID": branchId
  };

  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }

  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }

  const options = {
    method: method.toUpperCase(),
    headers
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const isJson = response.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await response.json() : await response.text();

  return {
    status: response.status,
    ok: response.ok,
    headers: response.headers,
    data
  };
}

module.exports = {
  deterministicUuid,
  startServer,
  stopServer,
  login,
  request
};
