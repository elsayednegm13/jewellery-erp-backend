const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { Op } = require("sequelize");
const { User, Company, PasswordResetToken, EmailChangeToken } = require("../models");
const { AppError, ValidationError, UnauthorizedError } = require("../utils/errors");
const logger = require("../utils/logger");
const permissionService = require("../services/permission.service");
const technicalSessions = require("../services/technical-session.service");
const localRecoveryDelivery = require("../services/local-recovery-delivery.service");
const auditService = require("../services/audit.service");
const { validatePasswordPolicy } = require("../utils/password-policy");

const DUMMY_BCRYPT_HASH = "$2a$10$7EqJtq98hPqEX7fNZaFWoOhiHNO7Q8NOq8B4EGKGU9Yh/8q0LJcMK";
const MAX_LOGIN_FAILURES = 5;
const LOCKOUT_MINUTES = 15;
const RESET_EXPIRY_MINUTES = 30;

function genericLoginError() {
  return new ValidationError("بيانات الاعتماد غير صالحة. البريد الإلكتروني أو كلمة المرور غير صحيحة.");
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

async function findUserByNormalizedEmail(email, { excludeId = null } = {}) {
  const normalized = normalizeEmail(email);
  const where = User.sequelize.where(
    User.sequelize.fn("lower", User.sequelize.col("email")),
    normalized
  );
  return User.findOne({
    where: excludeId ? { [Op.and]: [where, { id: { [Op.ne]: excludeId } }] } : where
  });
}

function resetTokenHash(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

const serializeCompany = (company) => company ? {
  id: company.id,
  businessName: company.businessName,
  workspace: company.workspace,
  companySize: company.companySize || "",
  country: company.country || "",
  currency: company.currency || "AED",
  city: company.city || "",
  region: company.region || "",
  address1: company.address1 || "",
  address2: company.address2 || "",
  postalCode: company.postalCode || "",
  commercialRegister: company.commercialRegister || "",
  taxNumber: company.taxNumber || "",
  phone: company.phone || "",
  email: company.email || "",
  website: company.website || "",
  logo: company.logo || "",
  branchName: company.branchName || "Main Branch"
} : null;

const serializeUser = async (user) => {
  const permissions = await permissionService.getUserPermissionNames(user);
  const roles = await permissionService.getUserRoles(user);
  const fixedBranch = (user.accountType || "legacy") === "branch_shell" && user.branchId
    ? await require("../models").Branch.findOne({ where: { id: user.branchId }, attributes: ["id", "name", "code"] })
    : null;
  const accountScope = technicalSessions.safeScope(user);
  if (fixedBranch) {
    accountScope.branchName = fixedBranch.name || null;
    accountScope.branchCode = fixedBranch.code || null;
    accountScope.fixedBranch = { id: fixedBranch.id, name: fixedBranch.name, code: fixedBranch.code };
  }
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phone: user.phone || "",
    jobTitle: user.jobTitle || "",
    role: user.role,
    accountType: user.accountType || "legacy",
    accountScope,
    forcePasswordChange: Boolean(user.forcePasswordChange),
    defaultEmployeeId: user.defaultEmployeeId || null,
    roles: roles.map((role) => ({ id: role.id, name: role.name, slug: role.slug, isAdmin: role.isAdmin })),
    permissions
  };
};

class AuthController {
  login = async (req, res, next) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        throw new ValidationError("يرجى إدخال البريد الإلكتروني وكلمة المرور.");
      }

      const user = await User.findOne({
        where: { email: normalizeEmail(email) }
      });

      if (!user) {
        await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
        throw genericLoginError();
      }
      const now = new Date();
      if (user.lockedUntil && new Date(user.lockedUntil) > now) {
        throw new AppError("Account is locked.", 423, "ACCOUNT_LOCKED");
      }
      const passwordMatches = await bcrypt.compare(password, user.password);
      if (!passwordMatches) {
        const failedLoginCount = Number(user.failedLoginCount || 0) + 1;
        let lockedUntil = failedLoginCount >= MAX_LOGIN_FAILURES ? new Date(now.getTime() + LOCKOUT_MINUTES * 60 * 1000) : null;
        if (lockedUntil && (user.accountType || "legacy") === "super_admin") {
          const systemAccounts = require("../services/system-account.service");
          if (await systemAccounts.isFinalActiveSuperAdmin(user)) lockedUntil = null;
        }
        await user.update({ failedLoginCount, lockedUntil });
        if (lockedUntil) {
          await auditService.record(user.companyId, {
            action: "system_account.locked",
            description: `System account locked after failed login attempts for ${user.email}.`,
            user: "System",
            place: "Auth",
            sourceDocument: user.id,
            severity: "warning",
            after: JSON.stringify({ failedLoginCount, lockedUntil })
          });
        }
        throw genericLoginError();
      }

      if (user.isActive === false) {
        throw new AppError("Account is inactive.", 403, "ACCOUNT_INACTIVE");
      }

      const accountType = user.accountType || "legacy";
      if (accountType === "branch_shell") {
        if (!user.branchId) {
          throw new AppError("Branch Account requires an assigned branch.", 422, "BRANCH_ACCOUNT_BRANCH_REQUIRED");
        }
        const branch = await require("../models").Branch.findOne({
          where: { id: user.branchId, isActive: true },
          attributes: ["id", "companyId", "name", "code", "isActive"]
        });
        if (!branch || branch.isActive === false) {
          throw new AppError("Branch Account branch is inactive or missing.", 422, "BRANCH_ACCOUNT_BRANCH_INACTIVE");
        }
        if (String(branch.companyId) !== String(user.companyId)) {
          throw new AppError("Branch Account company does not match assigned branch.", 422, "BRANCH_ACCOUNT_COMPANY_MISMATCH");
        }
      }

      const company = await Company.findByPk(user.companyId);
      if (!company) {
        throw new AppError("Branch Account company is missing.", 422, "BRANCH_ACCOUNT_COMPANY_MISMATCH");
      }
      await user.update({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: now });
      const tokens = await technicalSessions.issueTokens(user, req);

      logger.info(`User logged in: ${user.email} (${user.role})`);

      return res.status(200).json({
        success: true,
        data: {
          token: tokens.token,
          refreshToken: tokens.refreshToken,
          user: await serializeUser(user),
          company: serializeCompany(company)
        }
      });
    } catch (error) {
      next(error);
    }
  };

  refresh = async (req, res, next) => {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        throw new UnauthorizedError("رمز التحديث مفقود.");
      }

      const rotated = await technicalSessions.rotateRefreshToken(refreshToken, req);
      const user = rotated.user;

      const company = await Company.findByPk(user.companyId);
      logger.info(`Tokens refreshed for user ID: ${user.id}`);

      return res.status(200).json({
        success: true,
        data: {
          token: rotated.token,
          refreshToken: rotated.refreshToken,
          user: await serializeUser(user),
          company: serializeCompany(company)
        }
      });
    } catch (error) {
      next(error);
    }
  };

  logout = async (req, res, next) => {
    try {
      if (req.technicalSession?.id && req.user?.id) {
        await technicalSessions.revokeSession(req.technicalSession.id, req.user.id, "logout");
      }
      logger.info(`User logged out successfully`);
      return res.status(200).json({
        success: true,
        data: {
          message: "تم تسجيل الخروج بنجاح"
        }
      });
    } catch (error) {
      next(error);
    }
  };

  me = async (req, res, next) => {
    try {
      const user = req.user;
      const company = await Company.findByPk(user.companyId);

      return res.status(200).json({
        success: true,
        data: {
          user: await serializeUser(user),
          company: serializeCompany(company)
        }
      });
    } catch (error) {
      next(error);
    }
  };

  register = async (req, res, next) => {
    try {
      const payload = req.body;
      const email = payload.email.trim().toLowerCase();
      const workspace = payload.workspace.trim().toLowerCase();

      // Check if email or workspace exists
      const existingUser = await User.findOne({ where: { email } });
      if (existingUser) {
        throw new ValidationError("البريد الإلكتروني مسجل بالفعل.", { email: ["البريد الإلكتروني مسجل بالفعل."] });
      }

      const existingCompany = await Company.findOne({ where: { workspace } });
      if (existingCompany) {
        throw new ValidationError("رابط مساحة العمل محجوز بالفعل.", { workspace: ["رابط مساحة العمل محجوز بالفعل."] });
      }

      const timestamp = Date.now();
      const companyId = `CMP-${timestamp}`;
      const userId = `USR-${timestamp}`;

      const { normalizeCurrencyCode } = require("../utils/currency");

      // Create Company
      const company = await Company.create({
        id: companyId,
        businessName: payload.businessName.trim(),
        workspace,
        companySize: payload.companySize,
        country: payload.country,
        currency: normalizeCurrencyCode(payload.currency),
        city: payload.city.trim(),
        region: payload.region.trim(),
        address1: payload.address1.trim(),
        address2: payload.address2?.trim(),
        postalCode: payload.postalCode.trim(),
        commercialRegister: payload.commercialRegister?.trim(),
        taxNumber: payload.taxNumber?.trim(),
        logo: payload.logo,
        branchName: payload.city.trim() || "Main Branch"
      });

      // Create Admin User
      const hashedPassword = bcrypt.hashSync(payload.password, 10);
      const user = await User.create({
        id: userId,
        companyId,
        firstName: payload.firstName.trim(),
        lastName: payload.lastName.trim(),
        email,
        phone: payload.phone.trim(),
        jobTitle: payload.jobTitle,
        role: payload.role || "admin",
        password: hashedPassword
      });

      // Add as Employee
      await Employee.create({
        id: `EMP-${timestamp}`,
        companyId,
        name: `${payload.firstName.trim()} ${payload.lastName.trim()}`,
        role: "Administrator",
        systemRole: payload.role || "admin",
        branch: payload.city.trim() || "Main Branch",
        status: "present",
        email,
        phone: payload.phone.trim(),
        joinDate: new Date().toISOString().split("T")[0],
        jobTitle: payload.jobTitle
      });

      const tokens = await technicalSessions.issueTokens(user, req);
      logger.info(`Organization registered: ${company.businessName} (Workspace: ${company.workspace})`);

      return res.status(201).json({
        success: true,
        data: {
          token: tokens.token,
          refreshToken: tokens.refreshToken,
          user: {
            id: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            phone: user.phone || "",
            jobTitle: user.jobTitle || "",
            role: user.role,
            accountType: user.accountType || "legacy",
            accountScope: technicalSessions.safeScope(user)
          },
          company: serializeCompany(company)
        }
      });
    } catch (error) {
      next(error);
    }
  };

  changePassword = async (req, res, next) => {
    try {
      const { currentPassword, newPassword, confirmation } = req.body || {};
      if (!currentPassword || !newPassword || newPassword !== confirmation) {
        throw new ValidationError("Password confirmation does not match.", { password: ["Password confirmation does not match."] });
      }
      const user = await User.findByPk(req.user.id);
      validatePasswordPolicy(newPassword, { email: user.email, firstName: user.firstName, lastName: user.lastName });
      const matches = await bcrypt.compare(currentPassword, user.password);
      if (!matches) throw new ValidationError("Current password is invalid.", { currentPassword: ["Current password is invalid."] });
      await modelsTransaction(async (transaction) => {
        await user.update({
          password: await bcrypt.hash(newPassword, 10),
          forcePasswordChange: false,
          failedLoginCount: 0,
          lockedUntil: null
        }, { transaction });
        await technicalSessions.bumpPasswordVersion(user, "self_password_change", transaction);
        await auditService.record(user.companyId, {
          action: "system_account.password_changed",
          description: `Password changed for ${user.email}.`,
          user: `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email,
          userId: user.id,
          technicalUserId: user.id,
          place: "Auth",
          sourceDocument: user.id,
          severity: "warning"
        }, { transaction });
      });
      res.status(200).json({ success: true, data: { message: "Password changed. Please log in again." } });
    } catch (error) {
      next(error);
    }
  };

  forgotPassword = async (req, res, next) => {
    try {
      const email = normalizeEmail(req.body?.email);
      const user = email ? await User.findOne({ where: { email } }) : null;
      if (user) {
        const token = crypto.randomBytes(32).toString("base64url");
        const expiresAt = new Date(Date.now() + RESET_EXPIRY_MINUTES * 60 * 1000);
        await modelsTransaction(async (transaction) => {
          await PasswordResetToken.update({ usedAt: new Date() }, {
            where: { userId: user.id, usedAt: null, expiresAt: { [Op.gt]: new Date() } },
            transaction
          });
          const deliveryId = `PWD-RESET-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          await PasswordResetToken.create({
            id: deliveryId,
            userId: user.id,
            tokenHash: resetTokenHash(token),
            expiresAt,
            requestedIp: req.ip || req.connection?.remoteAddress || null,
            requestedUserAgent: String(req.headers["user-agent"] || "").slice(0, 255) || null
          }, { transaction });
          localRecoveryDelivery.writeLocalDelivery({
            id: deliveryId,
            kind: "password_reset",
            email,
            userId: user.id,
            token,
            expiresAt: expiresAt.toISOString()
          });
          await auditService.record(user.companyId, {
            action: "system_account.forgot_password_requested",
            description: `Password reset requested for ${user.email}.`,
            user: "System",
            place: "Auth",
            sourceDocument: user.id,
            severity: "warning",
            after: JSON.stringify({ deliveryId, localDevDelivery: process.env.NODE_ENV !== "production" })
          }, { transaction });
        });
      } else {
        await bcrypt.compare("invalid", DUMMY_BCRYPT_HASH);
      }
      res.status(200).json({ success: true, data: { message: "If the account can be recovered, reset instructions have been sent." } });
    } catch (error) {
      next(error);
    }
  };

  resetPassword = async (req, res, next) => {
    try {
      const { token, newPassword, confirmation } = req.body || {};
      if (!token || !newPassword || newPassword !== confirmation) {
        throw new ValidationError("Invalid reset request.", { password: ["Password confirmation does not match."] });
      }
      const row = await PasswordResetToken.findOne({ where: { tokenHash: resetTokenHash(token), usedAt: null } });
      if (!row || new Date(row.expiresAt) <= new Date()) throw new AppError("Reset token is invalid or expired.", 422, "RESET_TOKEN_INVALID");
      const user = await User.findByPk(row.userId);
      if (!user) throw new AppError("Reset token is invalid or expired.", 422, "RESET_TOKEN_INVALID");
      validatePasswordPolicy(newPassword, { email: user.email, firstName: user.firstName, lastName: user.lastName });
      await modelsTransaction(async (transaction) => {
        await row.update({ usedAt: new Date() }, { transaction });
        await user.update({
          password: await bcrypt.hash(newPassword, 10),
          forcePasswordChange: false,
          failedLoginCount: 0,
          lockedUntil: null
        }, { transaction });
        await technicalSessions.bumpPasswordVersion(user, "password_reset_token", transaction);
        await auditService.record(user.companyId, {
          action: "system_account.forgot_password_completed",
          description: `Password reset completed for ${user.email}.`,
          user: "System",
          place: "Auth",
          sourceDocument: user.id,
          severity: "warning"
        }, { transaction });
      });
      res.status(200).json({ success: true, data: { message: "Password reset complete. Please log in." } });
    } catch (error) {
      next(error);
    }
  };

  validateResetToken = async (req, res, next) => {
    try {
      const { token } = req.body || {};
      if (!token) throw new ValidationError("Reset token is required.", { token: ["Reset token is required."] });
      const row = await PasswordResetToken.findOne({ where: { tokenHash: resetTokenHash(token) } });
      let status = "invalid";
      if (row?.usedAt) status = "used";
      else if (row && new Date(row.expiresAt) <= new Date()) status = "expired";
      else if (row) status = "valid";
      res.status(200).json({ success: true, data: { valid: status === "valid", status } });
    } catch (error) {
      next(error);
    }
  };

  changeEmail = async (req, res, next) => {
    try {
      const { currentPassword, newEmail } = req.body || {};
      const email = normalizeEmail(newEmail || req.body?.email);
      if (!currentPassword || !email) {
        throw new ValidationError("Current password and new email are required.", { email: ["New email is required."] });
      }
      const user = await User.findByPk(req.user.id);
      const matches = await bcrypt.compare(currentPassword, user.password);
      if (!matches) throw new ValidationError("Current password is invalid.", { currentPassword: ["Current password is invalid."] });
      const exists = await findUserByNormalizedEmail(email, { excludeId: user.id });
      if (exists) throw new AppError("Email is already used by another account.", 409, "STATE_CONFLICT");
      const token = crypto.randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + RESET_EXPIRY_MINUTES * 60 * 1000);
      await modelsTransaction(async (transaction) => {
        await EmailChangeToken.update({ usedAt: new Date() }, {
          where: { userId: user.id, usedAt: null, expiresAt: { [Op.gt]: new Date() } },
          transaction
        });
        const deliveryId = `EMAIL-CHANGE-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await EmailChangeToken.create({
          id: deliveryId,
          userId: user.id,
          newEmail: email,
          tokenHash: resetTokenHash(token),
          expiresAt
        }, { transaction });
        localRecoveryDelivery.writeLocalDelivery({
          id: deliveryId,
          kind: "email_change",
          email,
          userId: user.id,
          token,
          expiresAt: expiresAt.toISOString()
        });
        await auditService.record(user.companyId, {
          action: "system_account.email_change_requested",
          description: `Email change requested for ${user.id}.`,
          user: `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email,
          userId: user.id,
          technicalUserId: user.id,
          place: "Auth",
          sourceDocument: user.id,
          severity: "warning",
          after: JSON.stringify({ deliveryId, localDevDelivery: process.env.NODE_ENV !== "production" })
        }, { transaction });
      });
      res.status(200).json({ success: true, data: { message: "Email change confirmation has been issued." } });
    } catch (error) {
      next(error);
    }
  };

  confirmEmailChange = async (req, res, next) => {
    try {
      const { token } = req.body || {};
      if (!token) throw new ValidationError("Email change token is required.", { token: ["Token is required."] });
      const row = await EmailChangeToken.findOne({ where: { tokenHash: resetTokenHash(token), usedAt: null } });
      if (!row || new Date(row.expiresAt) <= new Date()) throw new AppError("Email change token is invalid or expired.", 422, "EMAIL_CHANGE_TOKEN_INVALID");
      const user = await User.findByPk(row.userId);
      if (!user) throw new AppError("Email change token is invalid or expired.", 422, "EMAIL_CHANGE_TOKEN_INVALID");
      const exists = await findUserByNormalizedEmail(row.newEmail, { excludeId: user.id });
      if (exists) throw new AppError("Email is already used by another account.", 409, "STATE_CONFLICT");
      await modelsTransaction(async (transaction) => {
        await row.update({ usedAt: new Date() }, { transaction });
        await user.update({ email: row.newEmail }, { transaction });
        await technicalSessions.bumpSessionVersion(user, "email_change_confirmed", transaction);
        await auditService.record(user.companyId, {
          action: "system_account.email_change_completed",
          description: `Email change completed for ${user.id}.`,
          user: "System",
          place: "Auth",
          sourceDocument: user.id,
          severity: "warning",
          after: JSON.stringify({ targetUserId: user.id })
        }, { transaction });
      });
      res.status(200).json({ success: true, data: { message: "Email changed. Please log in again." } });
    } catch (error) {
      next(error);
    }
  };
}

async function modelsTransaction(fn) {
  const models = require("../models");
  return models.sequelize.transaction(fn);
}

module.exports = new AuthController();
