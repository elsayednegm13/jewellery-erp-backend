function createRateLimiter({ windowMs = 60_000, max = 20 } = {}) {
  const buckets = new Map();

  return (req, res, next) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const current = buckets.get(key);
    if (!current || current.resetAt < now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    current.count += 1;
    if (current.count > max) {
      return res.status(429).json({
        success: false,
        message: "Too many authentication attempts. Please try again shortly."
      });
    }
    return next();
  };
}

module.exports = { createRateLimiter };
