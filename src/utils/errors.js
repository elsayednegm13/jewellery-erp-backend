class AppError extends Error {
  constructor(message, statusCode, errorCode = "INTERNAL_SERVER_ERROR", fieldErrors = null) {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.fieldErrors = fieldErrors;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message = "بيانات غير صحيحة", fieldErrors = null) {
    super(message, 422, "VALIDATION_FAILED", fieldErrors);
  }
}

class NotFoundError extends AppError {
  constructor(message = "المورد غير موجود") {
    super(message, 404, "RESOURCE_NOT_FOUND");
  }
}

class UnauthorizedError extends AppError {
  constructor(message = "جلسة غير صالحة. يرجى تسجيل الدخول مرة أخرى") {
    super(message, 401, "UNAUTHORIZED");
  }
}

class ForbiddenError extends AppError {
  constructor(message = "تم رفض الوصول. لا تملك الصلاحيات الكافية") {
    super(message, 403, "FORBIDDEN");
  }
}

class ConflictError extends AppError {
  constructor(message = "حدث تعارض في الحالة أو تحديث متزامن") {
    super(message, 409, "STATE_CONFLICT");
  }
}

module.exports = {
  AppError,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError
};
