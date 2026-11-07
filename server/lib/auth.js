import crypto from 'node:crypto';
import { db, save, findUserById, hasPermission } from './db.js';

export const SESSION_COOKIE = 'qm_sid';
/** 会话绝对有效期（无论是否活跃，到期必须重新登录） */
const SESSION_TTL = 1000 * 60 * 60 * 24 * 30; // 30 天
/** 闲置超时：超过该时长没有任何请求，自动踢出（默认 7 天） */
const IDLE_TIMEOUT = process.env.SESSION_IDLE_SECONDS
  ? Math.max(1, Number(process.env.SESSION_IDLE_SECONDS)) * 1000
  : Math.max(1, Number(process.env.SESSION_IDLE_HOURS) || 168) * 60 * 60 * 1000;
/** 活跃时间回写节流：避免每个请求都写库 */
const TOUCH_INTERVAL = 5 * 60 * 1000;

export function sessionIdleTimeout() {
  return IDLE_TIMEOUT;
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  db.sessions = db.sessions.filter((s) => s.expiresAt > now);
  db.sessions.push({
    token,
    userId,
    createdAt: now,
    lastActiveAt: now,
    expiresAt: now + SESSION_TTL,
  });
  save();
  return token;
}

export function destroySession(token) {
  if (!token) return;
  const before = db.sessions.length;
  db.sessions = db.sessions.filter((s) => s.token !== token);
  if (db.sessions.length !== before) save();
}

export function destroyUserSessions(userId) {
  db.sessions = db.sessions.filter((s) => s.userId !== userId);
  save();
}

export function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL,
    path: '/',
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function sessionToken(req) {
  const fromCookie = req.cookies?.[SESSION_COOKIE];
  if (fromCookie) return fromCookie;
  const auth = req.get('authorization') || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return null;
}

/** 解析当前登录用户（不强制登录） */
export function attachUser(req, _res, next) {
  const token = sessionToken(req);
  if (!token) return next();
  const session = db.sessions.find((s) => s.token === token);
  if (!session || session.expiresAt < Date.now()) return next();

  const now = Date.now();
  // 闲置超时：长时间没有任何请求则强制下线
  const lastActive = Number(session.lastActiveAt || session.createdAt || 0);
  if (lastActive && now - lastActive > IDLE_TIMEOUT) {
    db.sessions = db.sessions.filter((s) => s.token !== token);
    save('sessions');
    req.sessionExpiredReason = 'idle';
    return next();
  }

  const user = findUserById(session.userId);
  if (!user || user.status === 'banned' || user.deleted) return next();

  // 活跃时间滑动续期（节流写库，避免每个请求都落盘）
  session.lastActiveAt = now;
  if (!session._touchedAt || now - session._touchedAt > TOUCH_INTERVAL) {
    session._touchedAt = now;
    save('sessions');
  }

  req.user = user;
  req.session = session;
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '请先登录后再继续操作' });
  next();
}

/** 需要指定权限点（admin 拥有全部权限） */
export function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: '请先登录后再继续操作' });
    if (!hasPermission(req.user, permission)) {
      return res.status(403).json({ error: '当前账号没有该操作权限，请联系管理员开通' });
    }
    next();
  };
}

/** 仅管理员 */
export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '请先登录后再继续操作' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: '仅管理员可以执行该操作' });
  next();
}

/** 管理员或审核员 */
export function requireStaff(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '请先登录后再继续操作' });
  if (!['admin', 'superadmin', 'assessor'].includes(req.user.role)) {
    return res.status(403).json({ error: '仅管理员、超级管理员与审核员可以访问该资源' });
  }
  next();
}

export { hasPermission };
