const { DataTypes } = require("sequelize");

module.exports = {
  up: async (queryInterface) => {
    await queryInterface.createTable("gold_fixings", {
      id: { type: DataTypes.STRING, primaryKey: true },
      company_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      customer_id: { type: DataTypes.STRING },
      customer_name: { type: DataTypes.STRING },
      direction: { type: DataTypes.ENUM("buy", "sell"), allowNull: false, defaultValue: "buy" },
      karat: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 21 },
      gross_weight: { type: DataTypes.DECIMAL(10, 4), allowNull: false, defaultValue: 0 },
      fine_weight: { type: DataTypes.DECIMAL(10, 4), allowNull: false, defaultValue: 0 },
      rate_per_gram: { type: DataTypes.DECIMAL(12, 4), allowNull: false, defaultValue: 0 },
      value: { type: DataTypes.DECIMAL(15, 4), allowNull: false, defaultValue: 0 },
      currency: { type: DataTypes.STRING, defaultValue: "AED" },
      status: { type: DataTypes.ENUM("fixed", "unfixed", "settled"), defaultValue: "fixed" },
      fixed_at: { type: DataTypes.STRING },
      unfixed_at: { type: DataTypes.STRING },
      fixed_by: { type: DataTypes.STRING },
      notes: { type: DataTypes.TEXT },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    });
    await queryInterface.addIndex("gold_fixings", ["company_id"]);
    await queryInterface.addIndex("gold_fixings", ["status"]);
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable("gold_fixings");
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_gold_fixings_direction";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_gold_fixings_status";');
  }
};
