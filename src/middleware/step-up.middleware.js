const requireOperator = require("./require-operator.middleware");

function requireStepUp(options = {}) {
  return requireOperator({
    ...options,
    requestedOperation: options.requestedOperation || "operator_verified"
  });
}

module.exports = requireStepUp;
