const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const FINANCIAL_OPERATION_TYPE = "financial-operation";

function isFinancialOperation(instance) {
  return instance.type === FINANCIAL_OPERATION_TYPE;
}

// The legacy generic CRUD surface must not become an alternate authority for
// financial-operation approvals.  They are created only by the canonical
// financial approval foundation, which supplies the immutable policy/context
// evidence in one transaction.
function assertFinancialFoundationCreate(instance, options) {
  if (isFinancialOperation(instance) && options?.financialApprovalFoundation !== true) {
    throw new Error("Financial approval requests must be created by the canonical financial approval foundation.");
  }
}

function assertFinancialOperationUpdate(instance, options) {
  if (!isFinancialOperation(instance)) return;
  const changed = instance.changed() || [];
  const immutable = new Set([
    "companyId", "type", "requestedBy", "requestedAt", "branch", "description", "amount",
    "relatedId", "policyId", "operationType", "subjectType", "subjectId", "branchId",
    "currency", "paymentMethod", "idempotencyKey", "requestContextSnapshot", "policyDecisionSnapshot",
  ]);
  if (changed.some((field) => immutable.has(field))) {
    throw new Error("Financial approval request policy and context evidence are immutable.");
  }
  if (changed.includes("status")) {
    if (instance.previous("status") !== "pending" || !["approved", "rejected"].includes(instance.status)) {
      throw new Error("Financial approval request decision is immutable.");
    }
    if (options?.financialApprovalDecision !== true || !instance.reviewedBy || !instance.reviewedAt) {
      throw new Error("Financial approval request decision requires the canonical approval authority.");
    }
  }
}

const ApprovalRequest = sequelize.define("ApprovalRequest", {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  companyId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "company_id"
  },
  type: {
    type: DataTypes.ENUM("discount", "price-override", "transfer", "adjustment", "cgp", "period-close", "reverse-charge", FINANCIAL_OPERATION_TYPE),
    allowNull: false
  },
  requestedBy: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "requested_by"
  },
  requestedAt: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "requested_at"
  },
  branch: {
    type: DataTypes.STRING,
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  amount: {
    type: DataTypes.DECIMAL(15, 4)
  },
  status: {
    type: DataTypes.ENUM("pending", "approved", "rejected", "expired"),
    defaultValue: "pending"
  },
  reviewedBy: {
    type: DataTypes.STRING,
    field: "reviewed_by"
  },
  reviewedAt: {
    type: DataTypes.STRING,
    field: "reviewed_at"
  },
  reason: {
    type: DataTypes.STRING
  },
  relatedId: {
    type: DataTypes.STRING,
    field: "related_id"
  },
  policyId: {
    type: DataTypes.STRING,
    field: "policy_id"
  },
  operationType: {
    type: DataTypes.STRING(64),
    field: "operation_type"
  },
  subjectType: {
    type: DataTypes.STRING(64),
    field: "subject_type"
  },
  subjectId: {
    type: DataTypes.STRING,
    field: "subject_id"
  },
  branchId: {
    type: DataTypes.STRING,
    field: "branch_id"
  },
  currency: {
    type: DataTypes.STRING(3)
  },
  paymentMethod: {
    type: DataTypes.STRING(32),
    field: "payment_method"
  },
  idempotencyKey: {
    type: DataTypes.STRING(191),
    field: "idempotency_key"
  },
  requestContextSnapshot: {
    type: DataTypes.JSONB,
    field: "request_context_snapshot"
  },
  policyDecisionSnapshot: {
    type: DataTypes.JSONB,
    field: "policy_decision_snapshot"
  }
}, {
  tableName: "approval_requests",
  timestamps: true,
  underscored: true,
  hooks: {
    beforeCreate: assertFinancialFoundationCreate,
    beforeUpdate: assertFinancialOperationUpdate,
    beforeDestroy: (instance) => {
      if (isFinancialOperation(instance)) throw new Error("Financial approval requests are immutable and cannot be deleted.");
    },
    beforeBulkDestroy: (options) => {
      if (options?.where?.type === FINANCIAL_OPERATION_TYPE) throw new Error("Financial approval requests are immutable and cannot be deleted.");
    }
  }
});

ApprovalRequest.FINANCIAL_OPERATION_TYPE = FINANCIAL_OPERATION_TYPE;
module.exports = ApprovalRequest;
