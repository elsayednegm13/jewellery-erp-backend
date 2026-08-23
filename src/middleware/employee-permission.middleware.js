const requireOperator = require("./require-operator.middleware");

function requireEmployeePermission(permissionName, options = {}) {
  return requireOperator({
    ...options,
    requiredPermission: permissionName,
    requestedOperation: options.requestedOperation || permissionName
  });
}

module.exports = requireEmployeePermission;
