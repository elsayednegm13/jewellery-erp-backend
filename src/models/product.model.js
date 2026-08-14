const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const Product = sequelize.define("Product", {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  companyId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "company_id"
  },
  productCode: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "product_code"
  },
  productName: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "product_name"
  },
  description: {
    type: DataTypes.TEXT
  },
  karat: {
    type: DataTypes.INTEGER
  },
  stockType: {
    type: DataTypes.STRING,
    field: "stock_type"
  },
  branchId: {
    type: DataTypes.STRING,
    field: "branch_id"
  },
  branchName: {
    type: DataTypes.STRING,
    field: "branch_name"
  },
  warehouseId: {
    type: DataTypes.STRING,
    field: "warehouse_id"
  },
  quantityOnHand: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0,
    field: "quantity_on_hand"
  },
  quantityAvailable: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0,
    field: "quantity_available"
  },
  quantitySold: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0,
    field: "quantity_sold"
  },
  quantityReserved: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0,
    field: "quantity_reserved"
  },
  totalWeight: {
    type: DataTypes.DECIMAL(12, 4),
    defaultValue: 0,
    field: "total_weight"
  },
  averageUnitWeight: {
    type: DataTypes.DECIMAL(12, 4),
    defaultValue: 0,
    field: "average_unit_weight"
  },
  unitCost: {
    type: DataTypes.DECIMAL(15, 4),
    defaultValue: 0,
    field: "unit_cost"
  },
  averageCost: {
    type: DataTypes.DECIMAL(15, 4),
    defaultValue: 0,
    field: "average_cost"
  },
  salePrice: {
    type: DataTypes.DECIMAL(15, 4),
    defaultValue: 0,
    field: "sale_price"
  },
  supplierId: {
    type: DataTypes.STRING,
    field: "supplier_id"
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    field: "is_active"
  }
}, {
  tableName: "products",
  timestamps: true,
  underscored: true,
  indexes: [
    {
      unique: true,
      fields: ["company_id", "product_code"]
    }
  ],
  hooks: {
    beforeUpdate: async (product, options) => {
      if (options.skipAdjustmentHook) return;
      if (product.changed("quantityOnHand")) {
        const prevQty = Number(product.previous("quantityOnHand")) || 0;
        const newQty = Number(product.quantityOnHand) || 0;
        const diff = newQty - prevQty;
        if (diff !== 0) {
          const type = diff > 0 ? "adjustment_in" : "adjustment_out";
          const StockMovement = sequelize.models.StockMovement;
          if (StockMovement) {
            await StockMovement.create({
              id: `SM-ADJ-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
              companyId: product.companyId,
              productId: product.id,
              productCode: product.productCode,
              type,
              quantityIn: diff > 0 ? diff : 0,
              quantityOut: diff < 0 ? Math.abs(diff) : 0,
              weightIn: diff > 0 ? (Number(product.averageUnitWeight || 0) * diff) : 0,
              weightOut: diff < 0 ? (Number(product.averageUnitWeight || 0) * Math.abs(diff)) : 0,
              unitCost: Number(product.unitCost || 0),
              totalCost: Number(product.unitCost || 0) * Math.abs(diff),
              referenceType: "ManualAdjustment",
              referenceId: "MANUAL",
              branchId: product.branchId,
              createdBy: options.actor || "System"
            }, { transaction: options.transaction });
          }
        }
      }
    }
  }
});

module.exports = Product;
