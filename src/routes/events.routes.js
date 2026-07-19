const express = require("express");
const { authMiddleware } = require("../middleware/auth.middleware");
const eventsService = require("../services/events.service");
const logger = require("../utils/logger");

const router = express.Router();

/**
 * GET /events/stream with the normal protected-route technical-session checks.
 */
router.get("/stream", authMiddleware, async (req, res) => {
  const companyId = req.companyId || req.user?.companyId;
  if (!companyId) return res.status(401).end();

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-store",
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
