const requireOperator = require("./require-operator.middleware");

function requireStepUp(options = {}) {
  return requireOperator({
    ...options,
    requiredLevel: 2,
    requestedOperation: options.requestedOperation || "step_up"
  });
}

module.exports = requireStepUp;
