"use strict";

module.exports = {
  async up(queryInterface) {
    const [rows] = await queryInterface.sequelize.query(
      "SELECT key, value FROM settings WHERE key = 'branches'"
    );
    if (rows.length) {
      // eslint-disable-next-line no-console
      console.log(`[Migration] Removing ${rows.length} legacy settings.branches row(s).`);
    }
    await queryInterface.sequelize.query("DELETE FROM settings WHERE key = 'branches'");
    await queryInterface.sequelize.query(`
      INSERT INTO settings (company_id, key, value, created_at, updated_at)
      SELECT c.id, 'branchesInitialized', 'true'::jsonb, NOW(), NOW()
      FROM companies c
      WHERE EXISTS (SELECT 1 FROM branches b WHERE b.company_id = c.id)
        AND NOT EXISTS (
          SELECT 1 FROM settings s
          WHERE s.company_id = c.id AND s.key = 'branchesInitialized'
        )
    `);
  },

  async down() {
    // Intentionally no-op: branch master data lives in the branches table.
  }
};
