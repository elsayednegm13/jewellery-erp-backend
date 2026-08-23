"use strict";

// Gold Center source defines the capability to approve prices, but not a
// job title.  The migration registers this capability without granting it.
const GOLD_PRICE_APPROVAL_PERMISSION = Object.freeze({
  name: "gold.approve_price",
  module: "gold",
  action: "approve_price",
  description: "Approve an executable Gold Center price",
});

module.exports = { GOLD_PRICE_APPROVAL_PERMISSION };
