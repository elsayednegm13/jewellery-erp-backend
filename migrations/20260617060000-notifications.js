const { DataTypes } = require("sequelize");

module.exports = {
  up: async (queryInterface) => {
    await queryInterface.createTable("notifications", {
      id: { type: DataTypes.STRING, primaryKey: true },
      company_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      user_id: {
        type: DataTypes.STRING,
        references: { model: "users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      },
      role_id: {
        type: DataTypes.STRING,
        references: { model: "roles", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      },
      title: { type: DataTypes.STRING, allowNull: false },
      message: { type: DataTypes.TEXT, allowNull: false },
      type: { type: DataTypes.ENUM("info", "success", "warning", "error", "approval", "system"), defaultValue: "info" },
      entity_type: { type: DataTypes.STRING },
      entity_id: { type: DataTypes.STRING },
      is_read: { type: DataTypes.BOOLEAN, defaultValue: false },
      read_at: { type: DataTypes.DATE },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    });
    await queryInterface.addIndex("notifications", ["company_id", "user_id", "is_read"]);
    await queryInterface.addIndex("notifications", ["company_id", "created_at"]);
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable("notifications");
  }
};
