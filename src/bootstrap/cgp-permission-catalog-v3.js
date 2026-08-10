"use strict";

// CGP-IMP-11 registers future capabilities without granting them to a role or
// user.  A later canonical Posting batch owns endpoint activation and any
// controlled authorization rollout.
const CGP_FUTURE_CAPABILITIES = Object.freeze([
  {
    name: "gold_purchase.cgp.post",
    module: "gold_purchase.cgp",
    action: "post",
    description: "Post a validated and approved Customer Gold Purchase document",
  },
  {
    name: "gold_purchase.cgp.view_integration_status",
    module: "gold_purchase.cgp",
    action: "view_integration_status",
    description: "View Customer Gold Purchase integration status",
  },
  {
    name: "gold_purchase.cgp.retry_integration",
    module: "gold_purchase.cgp",
    action: "retry_integration",
    description: "Retry a failed Customer Gold Purchase integration",
  },
  {
    name: "gold_purchase.cgp.reverse",
    module: "gold_purchase.cgp",
    action: "reverse",
    description: "Reverse a posted Customer Gold Purchase through the canonical reversal workflow",
  },
]);

module.exports = { CGP_FUTURE_CAPABILITIES };
