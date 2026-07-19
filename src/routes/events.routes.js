const express = require("express");
const { authMiddleware } = require("../middleware/auth.middleware");
const eventsService = require("../services/events.service");
const technicalSessions = require("../services/technical-session.service");

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

  let closed = false;
  let validationInFlight = false;

  const closeStream = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    eventsService.removeClient(id);
    if (!res.writableEnded) res.end();
  };

  // Keep the stream aligned with persisted technical-session revocation/version state.
  const heartbeat = setInterval(async () => {
    if (closed || validationInFlight) return;
    validationInFlight = true;
    try {
      await technicalSessions.assertAccessSession(req.accessTokenPayload);
      if (!closed) res.write(`: ping\n\n`);
    } catch {
      closeStream();
    } finally {
      validationInFlight = false;
    }
  }, 25000);

  req.on("close", closeStream);
});

module.exports = router;
