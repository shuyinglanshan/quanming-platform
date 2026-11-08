import crypto from 'node:crypto';
import { db, save, findUserById, hasPermission } from './db.js';

export const SESSION_COOKIE = 'qm_sid';
/** 会话绝对有效期（无论是否活跃，到期必须重新登录） */
const SESSION_TTL = 1000 * 60 * 60 * 24 * 30; // 30 天
/** 闲置超时：超过该时长没有任何请求，自动踢出（默认 3 天） */
const IDLE_TIMEOUT = process.env.SESSION_IDLE_SECONDS
  ? Math.max(1, Number(process.env.SESSION_IDLE_SECONDS)) * 1000
  : Math.max(1, Number(process.env.SESSION_IDLE_HOURS) || 168) * 60 * 60 * 1000;
/** 活跃时间回写节流：避免每个请求都写库 */
const TOUCH_INTERVAL = 5 * 60 * 1000;

export function sessionIdleTimeout() {
  return IDLE_TIMEOUT;
}

/**
 * 生成唯一会话 ID
 *
 * 要求「无规律」：不能用 userId/时间戳等可预测信息拼接，
 * 也不能用递增序列（否则可枚举、可横向越权）。
 * 这里用 24 字节 CSPRNG 随机数转 base32 风格字符串，32 字符。
 */
function generateSessionId() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混淆的 I/O/0/1
  const bytes = crypto.randomBytes(24);
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  // 加时间前缀便于人工识别，但**不含任何用户/权限信息**
  return out;
}

/**
 * 创建会话
 * @param {string} userId
 * @param {{ role?: string, ip?: string, ua?: string }} meta 会话元信息（角色快照用于防越权）
 */
export function createSession(userId, meta = {}) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();

  // 保证 sessionId 全局唯一
  let sessionId = generateSessionId();
  while (db.sessions.some((s) => s.sessionId === sessionId)) {
    sessionId = generateSessionId();
  }

  db.sessions = db.sessions.filter((s) => s.expiresAt > now);
  db.sessions.push({
    token,
    sessionId,
    userId,
    // 角色快照：会话期间角色被改，需要强制重新登录，防止旧会话保留高权限
    role: meta.role || null,
    ip: meta.ip || '',
    ua: (meta.ua || '').slice(0, 200),
    createdAt: now,
    lastActiveAt: now,
    expiresAt: now + SESSION_TTL,
    expiredReason: null,
  });
  save('sessions');
  return { token, sessionId };
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

  // 会话不存在：可能已过期清理、已被踢出、或伪造
  if (!session) {
    req.sessionExpiredReason = 'invalid';
    return next();
  }

  const now = Date.now();

  // 绝对过期
  if (session.expiresAt < now) {
    expireSession(session, 'absolute');
    req.sessionExpiredReason = 'expired';
    return next();
  }

  // 闲置超时（默认 3 天）
  const lastActive = Number(session.lastActiveAt || session.createdAt || 0);
  if (lastActive && now - lastActive > IDLE_TIMEOUT) {
    expireSession(session, 'idle');
    req.sessionExpiredReason = 'idle';
    return next();
  }

  const user = findUserById(session.userId);
  if (!user || user.status === 'banned' || user.deleted) {
    req.sessionExpiredReason = 'disabled';
    if (session) expireSession(session, 'disabled');
    return next();
  }

  // 防越权：会话创建时的角色必须与当前一致，
  // 否则说明权限被变更，旧会话不能继续沿用（尤其降权场景）
  if (session.role && session.role !== user.role) {
    expireSession(session, 'role-changed');
    req.sessionExpiredReason = 'role-changed';
    return next();
  }

  // 活跃时间滑动续期（节流写库）
  session.lastActiveAt = now;
  if (!session._touchedAt || now - session._touchedAt > TOUCH_INTERVAL) {
    session._touchedAt = now;
    save('sessions');
  }

  req.user = user;
  req.session = session;
  req.sessionId = session.sessionId;
  next();
}

/** 标记并移除会话，记录过期原因供审计 */
function expireSession(session, reason) {
  if (!session) return;
  session.expiredReason = reason;
  db.sessions = db.sessions.filter((s) => s.token !== session.token);
  save('sessions');
  eventLog(null, '会话失效', `${session.sessionId || '-'} · ${reason}`);
}

export function requireAuth(req, res, next) {
  if (!req.user) {
    // 区分「从未登录」与「会话过期」：后者需要前端弹「登录过期」提示
    const reason = req.sessionExpiredReason;
    if (reason) {
      return res.status(401).json({
        error: '登录过期，请重新登录',
        code: 'SESSION_EXPIRED',
        reason,
      });
    }
    return res.status(401).json({ error: '请先登录后再继续操作', code: 'NOT_AUTHENTICATED' });
  }
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
