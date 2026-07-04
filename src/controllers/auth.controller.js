const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { User, Company, Employee } = require("../models");
const { ValidationError, UnauthorizedError } = require("../utils/errors");
const logger = require("../utils/logger");
const permissionService = require("../services/permission.service");

const { JWT_SECRET, JWT_REFRESH_SECRET, ACCESS_EXPIRY, REFRESH_EXPIRY } = require("../config/security");

const generateTokens = (userId) => {
  const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: ACCESS_EXPIRY });
  const refreshToken = jwt.sign({ userId }, JWT_REFRESH_SECRET, { expiresIn: REFRESH_EXPIRY });
  return { token, refreshToken };
};

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

class AuthController {
  login = async (req, res, next) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        throw new ValidationError("يرجى إدخال البريد الإلكتروني وكلمة المرور.");
      }

      const user = await User.findOne({
        where: { email: email.trim().toLowerCase() }
      });

      if (!user || !bcrypt.compareSync(password, user.password)) {
        throw new ValidationError("بيانات الاعتماد غير صالحة. البريد الإلكتروني أو كلمة المرور غير صحيحة.");
      }

      const company = await Company.findByPk(user.companyId);
      const permissions = await permissionService.getUserPermissionNames(user);
      const roles = await permissionService.getUserRoles(user);
      const tokens = generateTokens(user.id);

      logger.info(`User logged in: ${user.email} (${user.role})`);

      return res.status(200).json({
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
            roles: roles.map((role) => ({ id: role.id, name: role.name, slug: role.slug, isAdmin: role.isAdmin })),
            permissions
          },
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

      let decoded;
      try {
        decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
      } catch (err) {
        throw new UnauthorizedError("انتهت صلاحية جلسة العمل. يرجى تسجيل الدخول مرة أخرى.");
      }

      const user = await User.findByPk(decoded.userId);
      if (!user) {
        throw new UnauthorizedError("المستخدم غير موجود.");
      }

      const company = await Company.findByPk(user.companyId);
      const permissions = await permissionService.getUserPermissionNames(user);
      const roles = await permissionService.getUserRoles(user);
      const tokens = generateTokens(user.id);
      logger.info(`Tokens refreshed for user ID: ${user.id}`);

      return res.status(200).json({
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
            roles: roles.map((role) => ({ id: role.id, name: role.name, slug: role.slug, isAdmin: role.isAdmin })),
            permissions
          },
          company: serializeCompany(company)
        }
      });
    } catch (error) {
      next(error);
    }
  };

  logout = async (req, res, next) => {
    try {
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
      const permissions = await permissionService.getUserPermissionNames(user);
      const roles = await permissionService.getUserRoles(user);

      return res.status(200).json({
        success: true,
        data: {
          user: {
            id: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            phone: user.phone || "",
            jobTitle: user.jobTitle || "",
            role: user.role,
            roles: roles.map((role) => ({ id: role.id, name: role.name, slug: role.slug, isAdmin: role.isAdmin })),
            permissions
          },
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

      const tokens = generateTokens(user.id);
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
            role: user.role
          },
          company: serializeCompany(company)
        }
      });
    } catch (error) {
      next(error);
    }
  };
}

module.exports = new AuthController();
