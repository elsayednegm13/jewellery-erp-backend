const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const User = sequelize.define("User", {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  companyId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "company_id"
  },
  firstName: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "first_name"
  },
  lastName: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "last_name"
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: {
      isEmail: true
    }
  },
  phone: {
    type: DataTypes.STRING
  },
  password: {
    type: DataTypes.STRING,
    allowNull: false
  },
  jobTitle: {
    type: DataTypes.STRING,
    field: "job_title"
  },
  role: {
    type: DataTypes.ENUM("admin", "owner", "manager", "accountant", "sales"),
    allowNull: false,
    defaultValue: "sales"
  }
}, {
  tableName: "users",
  timestamps: true,
  underscored: true,
  paranoid: true
});

module.exports = User;
