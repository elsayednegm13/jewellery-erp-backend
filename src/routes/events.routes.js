const express = require("express");
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../config/security");
const User = require("../models/user.model");
const eventsService = require("../services/events.service");
const logger = require("../utils/logger");

const router = express.Router();

/**
 * GET /events/stream?token=...
 *
 * Server-Sent Events stream for realtime updates. EventSource cannot set an
 * Authorization header, so the JWT is accepted via the `token` query param
 * (falling back to the Authorization header for non-browser clients).
 */
router.get("/stream", async (req, res) => {
  const token = req.query.token || (req.headers.authorization || "").replace("Bearer ", "");
  if (!token) return res.status(401).end();

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).end();
  }

  let companyId = "CMP-DEMO";
  try {
    const user = await User.findByPk(decoded.userId);
    if (!user) return res.status(401).end();
    companyId = user.companyId || "CMP-DEMO";
  } catch (err) {
    logger.warn(`[SSE] user lookup failed: ${err.message}`);
    return res.status(401).end();
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no" // disable proxy buffering (nginx)
  });
  res.write(`event: connected\ndata: {"ok":true}\n\n`);

  const id = eventsService.addClient(companyId, res);

  // Heartbeat to keep proxies/load-balancers from closing the idle connection.
  const heartbeat = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch {
      /* connection gone — cleanup handled by close handler */
    }
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    eventsService.removeClient(id);
  });
});

module.exports = router;
