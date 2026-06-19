const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const GoldPrice = sequelize.define("GoldPrice", {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  karat: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  pricePerGram: {
    type: DataTypes.DECIMAL(10, 4),
    allowNull: false,
    field: "price_per_gram"
  },
  currency: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: "AED"
  },
  updatedBy: {
    type: DataTypes.STRING,
    field: "updated_by",
    defaultValue: "System"
  }
}, {
  tableName: "gold_prices",
  timestamps: true,
  underscored: true
});

module.exports = GoldPrice;
