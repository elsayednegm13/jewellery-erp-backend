const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { Op } = require("sequelize");
const models = require("../models");
const auditService = require("./audit.service");
const { UnauthorizedError } = require("../utils/errors");
const { JWT_SECRET, JWT_REFRESH_SECRET, ACCESS_EXPIRY, REFRESH_EXPIRY } = require("../config/security");

function id(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function randomSecret(bytes = 48) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function expiryToMs(value) {
  const text = String(value || "7d").trim();
  const match = text.match(/^(\d+)([smhd])$/i);
  if (!match) return 7 * 24 * 60 * 60 * 1000;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === "s") return amount * 1000;
  if (unit === "m") return amount * 60 * 1000;
  if (unit === "h") return amount * 60 * 60 * 1000;
  return amount * 24 * 60 * 60 * 1000;
}

function maskIp(value) {
  const text = String(value || "");
  if (!text) return null;
  if (text.includes(":")) return `${text.slice(0, 6)}...`;
  const parts = text.split(".");
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.x.x`;
  return "masked";
}

function safeScope(user) {
  return {
    accountType: user.accountType || "legacy",
    companyId: user.companyId,
    branchId: user.branchId || null,
    forcePasswordChange: Boolean(user.forcePasswordChange),
    defaultEmployeeId: user.defaultEmployeeId || null
  };
}

function accessPayload(user, session) {
  return {
    userId: user.id,
    passwordVersion: Number(user.passwordVersion || 1),
    sessionVersion: Number(user.sessionVersion || 1),
    technicalSessionId: session.id,
    accountType: user.accountType || "legacy",
    branchId: user.branchId || null
  };
}

async function issueTokens(user, req, transaction = null) {
  const refreshSecret = randomSecret();
  const session = await models.TechnicalAccountSession.create({
    id: id("TAS"),
    userId: user.id,
    companyId: user.companyId,
    branchId: user.branchId || null,
    refreshTokenHash: tokenHash(refreshSecret),
    deviceSessionId: req.headers["x-device-session-id"] || null,
    userAgent: String(req.headers["user-agent"] || "").slice(0, 255) || null,
    ipAddress: maskIp(req.ip || req.connection?.remoteAddress || null),
    passwordVersion: Number(user.passwordVersion || 1),
    sessionVersion: Number(user.sessionVersion || 1),
    expiresAt: new Date(Date.now() + expiryToMs(REFRESH_EXPIRY)),
    lastUsedAt: new Date()
  }, { transaction });
  const token = jwt.sign(accessPayload(user, session), JWT_SECRET, { expiresIn: ACCESS_EXPIRY });
  const refreshToken = jwt.sign({
    userId: user.id,
    technicalSessionId: session.id,
    secret: refreshSecret,
    passwordVersion: Number(user.passwordVersion || 1),
    sessionVersion: Number(user.sessionVersion || 1)
  }, JWT_REFRESH_SECRET, { expiresIn: REFRESH_EXPIRY });
  return { token, refreshToken, session };
}

async function rotateRefreshToken(refreshToken, req) {
  let decoded;
  try {
    decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
  } catch {
    throw new UnauthorizedError("انتهت صلاحية جلسة العمل. يرجى تسجيل الدخول مرة أخرى.");
  }
  const session = await models.TechnicalAccountSession.findOne({
    where: { id: decoded.technicalSessionId, userId: decoded.userId },
    include: [{ model: models.User, as: "user" }]
  });
  if (!session || !session.user) throw new UnauthorizedError("انتهت صلاحية جلسة العمل. يرجى تسجيل الدخول مرة أخرى.");
  const now = new Date();
  const user = session.user;
  const expectedHash = tokenHash(decoded.secret || "");
  const stale =
    session.revokedAt ||
    new Date(session.expiresAt) <= now ||
    session.refreshTokenHash !== expectedHash ||
    Number(session.passwordVersion) !== Number(user.passwordVersion || 1) ||
    Number(session.sessionVersion) !== Number(user.sessionVersion || 1) ||
    Number(decoded.passwordVersion || 0) !== Number(user.passwordVersion || 1) ||
    Number(decoded.sessionVersion || 0) !== Number(user.sessionVersion || 1);
  if (stale) throw new UnauthorizedError("انتهت صلاحية جلسة العمل. يرجى تسجيل الدخول مرة أخرى.");

  const nextSecret = randomSecret();
  await session.update({
    refreshTokenHash: tokenHash(nextSecret),
    lastUsedAt: now,
    deviceSessionId: req.headers["x-device-session-id"] || session.deviceSessionId || null,
    userAgent: String(req.headers["user-agent"] || session.userAgent || "").slice(0, 255) || null,
    ipAddress: maskIp(req.ip || req.connection?.remoteAddress || session.ipAddress || null)
  });
  const token = jwt.sign(accessPayload(user, session), JWT_SECRET, { expiresIn: ACCESS_EXPIRY });
  const nextRefreshToken = jwt.sign({
    userId: user.id,
    technicalSessionId: session.id,
    secret: nextSecret,
    passwordVersion: Number(user.passwordVersion || 1),
    sessionVersion: Number(user.sessionVersion || 1)
  }, JWT_REFRESH_SECRET, { expiresIn: REFRESH_EXPIRY });
  return { token, refreshToken: nextRefreshToken, user, session };
}

async function assertAccessSession(decoded) {
  const user = await models.User.findByPk(decoded.userId);
  if (!user) throw new UnauthorizedError("المستخدم غير موجود.");
  if (!decoded.technicalSessionId) throw new UnauthorizedError("انتهت الجلسة. يرجى تسجيل الدخول مرة أخرى.");
  const session = await models.TechnicalAccountSession.findOne({
    where: { id: decoded.technicalSessionId, userId: user.id }
  });
  const now = new Date();
  if (!session || session.revokedAt || new Date(session.expiresAt) <= now) {
    throw new UnauthorizedError("انتهت الجلسة. يرجى تسجيل الدخول مرة أخرى.");
  }
  if (
    Number(decoded.passwordVersion || 0) !== Number(user.passwordVersion || 1) ||
    Number(decoded.sessionVersion || 0) !== Number(user.sessionVersion || 1) ||
    Number(session.passwordVersion || 0) !== Number(user.passwordVersion || 1) ||
    Number(session.sessionVersion || 0) !== Number(user.sessionVersion || 1)
  ) {
    throw new UnauthorizedError("انتهت الجلسة. يرجى تسجيل الدخول مرة أخرى.");
  }
  return { user, session };
}

async function revokeSession(sessionId, userId, reason = "logout", transaction = null) {
  if (!sessionId) return 0;
  const [count] = await models.TechnicalAccountSession.update({
    revokedAt: new Date(),
    revokeReason: reason
  }, {
    where: { id: sessionId, userId, revokedAt: null },
    transaction
  });
  return count;
}

async function revokeUserSessions(userId, reason = "security_change", { exceptSessionId = null, transaction = null } = {}) {
  const where = { userId, revokedAt: null };
  if (exceptSessionId) where.id = { [Op.ne]: exceptSessionId };
  const [count] = await models.TechnicalAccountSession.update({
    revokedAt: new Date(),
    revokeReason: reason
  }, { where, transaction });
  return count;
}

async function bumpSessionVersion(user, reason = "security_change", transaction = null) {
  await user.update({ sessionVersion: Number(user.sessionVersion || 1) + 1 }, { transaction });
  await revokeUserSessions(user.id, reason, { transaction });
}

async function bumpPasswordVersion(user, reason = "password_change", transaction = null) {
  await user.update({
    passwordVersion: Number(user.passwordVersion || 1) + 1,
    sessionVersion: Number(user.sessionVersion || 1) + 1,
    credentialsChangedAt: new Date(),
    lastPasswordChangeAt: new Date()
  }, { transaction });
  await revokeUserSessions(user.id, reason, { transaction });
}

async function auditSessionRevocation({ companyId, actorUser, targetUser, reason, count, transaction }) {
  await auditService.record(companyId, {
    action: "technical_sessions.revoked",
    description: `Technical sessions revoked for ${targetUser.email}.`,
    user: actorUser ? `${actorUser.firstName || ""} ${actorUser.lastName || ""}`.trim() || actorUser.email : "System",
    userId: actorUser?.id || null,
    technicalUserId: actorUser?.id || null,
    place: "System Accounts",
    sourceDocument: targetUser.id,
    severity: "warning",
    after: JSON.stringify({ targetUserId: targetUser.id, count, reason })
  }, { transaction });
}

module.exports = {
  tokenHash,
  randomSecret,
  safeScope,
  issueTokens,
  rotateRefreshToken,
  assertAccessSession,
  revokeSession,
  revokeUserSessions,
  bumpSessionVersion,
  bumpPasswordVersion,
  auditSessionRevocation
};
