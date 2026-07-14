const operatorSessionService = require("../services/operator-session.service");

function requireOperator(options = {}) {
  return async (req, _res, next) => {
    try {
      const result = await operatorSessionService.currentFromRequest(req, { ...options, touch: true });
      if (!result.active) {
        throw operatorSessionService.operatorError(result.reason, result.statusCode);
      }
      req.operatorSessionState = result;
      req.operatorContext = result.context;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = requireOperator;
