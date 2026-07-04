const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const Company = sequelize.define("Company", {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  businessName: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "business_name"
  },
  workspace: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  companySize: {
    type: DataTypes.STRING,
    field: "company_size"
  },
  country: {
    type: DataTypes.STRING
  },
  currency: {
    type: DataTypes.STRING,
    defaultValue: "AED"
  },
  city: {
    type: DataTypes.STRING
  },
  region: {
    type: DataTypes.STRING
  },
  address1: {
    type: DataTypes.STRING,
    field: "address_1"
  },
  address2: {
    type: DataTypes.STRING,
    field: "address_2"
  },
  postalCode: {
    type: DataTypes.STRING,
    field: "postal_code"
  },
  commercialRegister: {
    type: DataTypes.STRING,
    field: "commercial_register"
  },
  taxNumber: {
    type: DataTypes.STRING,
    field: "tax_number"
  },
  phone: {
    type: DataTypes.STRING(40)
  },
  email: {
    type: DataTypes.STRING(160)
  },
  website: {
    type: DataTypes.STRING(200)
  },
  logo: {
    type: DataTypes.STRING
  },
  branchName: {
    type: DataTypes.STRING,
    field: "branch_name",
    defaultValue: "Main Branch"
  }
}, {
  tableName: "companies",
  timestamps: true,
  underscored: true,
  hooks: {
    beforeCreate: (company) => {
      if (company.currency) {
        const { normalizeCurrencyCode } = require("../utils/currency");
        company.currency = normalizeCurrencyCode(company.currency);
      }
    },
    beforeUpdate: (company) => {
      if (company.currency) {
        const { normalizeCurrencyCode } = require("../utils/currency");
        company.currency = normalizeCurrencyCode(company.currency);
      }
    }
  }
});

module.exports = Company;
