const { DataTypes } = require("sequelize");
const crypto = require("crypto");

// Must stay in sync with src/services/audit.service.js canonical()/computeHash().
function canonical(r) {
  return [
    r.id, r.company_id, r.action, r.description, r.user, r.user_id || "",
    r.place || "", r.branch || "", r.date, r.before || "", r.after || "", r.severity || "info"
  ].join("|");
}
function computeHash(prevHash, r) {
  return crypto.createHash("sha256").update(`${prevHash || ""}|${canonical(r)}`).digest("hex");
}

module.exports = {
  up: async (queryInterface) => {
    await queryInterface.addColumn("audit_logs", "hash", { type: DataTypes.STRING });
    await queryInterface.addColumn("audit_logs", "prev_hash", { type: DataTypes.STRING });

    // Backfill the chain over existing rows in chronological order.
    const [rows] = await queryInterface.sequelize.query(
      "SELECT * FROM audit_logs ORDER BY created_at ASC, id ASC;"
    );
    let prevHash = null;
    for (const r of rows) {
      const hash = computeHash(prevHash, r);
      await queryInterface.sequelize.query(
        "UPDATE audit_logs SET hash = :hash, prev_hash = :prev WHERE id = :id;",
        { replacements: { hash, prev: prevHash, id: r.id } }
      );
      prevHash = hash;
    }
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn("audit_logs", "hash");
    await queryInterface.removeColumn("audit_logs", "prev_hash");
  }
};
