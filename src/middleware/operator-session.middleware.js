const operatorSessionService = require("../services/operator-session.service");

async function operatorSessionMiddleware(req, _res, next) {
  try {
    if (!req.user) return next();
    const result = await operatorSessionService.currentFromRequest(req, { touch: true });
    req.operatorSessionState = result;
    req.operatorContext = result.active ? result.context : null;
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = operatorSessionMiddleware;
