"use strict";

// The V2 stocktake contract needs durable DRAFT and CLOSED states. Existing
// records retain their legacy enum values; this forward-only migration merely
// extends the value set and is never applied to the persistent rehearsal base.
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query("ALTER TYPE enum_stock_audits_status ADD VALUE IF NOT EXISTS 'draft'");
    await queryInterface.sequelize.query("ALTER TYPE enum_stock_audits_status ADD VALUE IF NOT EXISTS 'closed'");
  },
  async down() {
    throw new Error("NON_DESTRUCTIVE_FORWARD_ONLY: inventory audit lifecycle evidence cannot be removed safely");
  },
};
