"use strict";

// The permission name is owned by this catalog. Consumers may import the
// descriptor, while historical migrations remain historical evidence only.
const GOLD_PRICING_POLICY_PERMISSION = Object.freeze({
  name: "gold.manage_pricing_policy",
  module: "gold",
  action: "manage_pricing_policy",
  description: "Manage versioned Gold Center pricing policies",
});

module.exports = { GOLD_PRICING_POLICY_PERMISSION };
