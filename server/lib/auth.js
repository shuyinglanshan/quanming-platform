import crypto from 'node:crypto';
import { db, save, findUserById, hasPermission } from './db.js';
import { eventLog } from './logger.js';

export const SESSION_COOKIE = 'qm_sid';
/** 会话绝对有效期（无论是否活跃，到期必须重新登录） */
const SESSION_TTL = 1000 * 60 * 60 * 24 * 30; // 30 天
/** 闲置超时：超过该时长没有任何请求，自动踢出（默认 3 天） */
const IDLE_TIMEOUT = process.env.SESSION_IDLE_SECONDS
  ? Math.max(1, Number(process.env.SESSION_IDLE_SECONDS)) * 1000
  : Math.max(1, Number(process.env.SESSION_IDLE_HOURS) || 72) * 60 * 60 * 1000;
/** 活跃时间回写节流：避免每个请求都写库 */
const TOUCH_INTERVAL = 5 * 60 * 1000;

export function sessionIdleTimeout() {
  return IDLE_TIMEOUT;
}

/**
 * 角色标识前缀
 *
 * 会话 ID 首段体现角色，便于运维一眼识别、也作为服务端校验的第一道关口：
 *   A = admin        平台管理员
 *   S = superadmin   超级管理员
 *   R = assessor     审核员
 *   U = user         普通用户
 *
 * 注意：角色标识只用于**识别与快速校验**，真正的权限判定仍以
 * 服务端会话记录里的 role 快照为准，绝不信任客户端传来的前缀。
 */
const ROLE_PREFIX = {
  admin: 'A',
  superadmin: 'S',
  assessor: 'R',
  user: 'U',
};

export function sessionRolePrefix(role) {
  return ROLE_PREFIX[role] || 'U';
}

/**
 * 生成唯一会话 ID：角色前缀 + 随机串
 *
 * 格式：<角色字母>-<24 位随机>，例如 A-K7M2XP9QRT4NVW8YHZ3BCD5
 * 随机部分用 CSPRNG，不含 userId/时间戳，无法枚举或预测。
 */
function generateSessionId(role) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混淆的 I/O/0/1
  const bytes = crypto.randomBytes(24);
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return `${sessionRolePrefix(role)}-${out}`;
}

/**
 * 创建会话
 * @param {string} userId
 * @param {{ role?: string, ip?: string, ua?: string }} meta 会话元信息（角色快照用于防越权）
 */
export function createSession(userId, meta = {}) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();

  // 保证 sessionId 全局唯一（含角色前缀）
  let sessionId = generateSessionId(meta.role);
  while (db.sessions.some((s) => s.sessionId === sessionId)) {
    sessionId = generateSessionId(meta.role);
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
    // 心跳时间：由前端定时上报，是判断「是否真正在使用」的唯一依据
    lastHeartbeatAt: now,
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
    expireSession(session, 'absolute', req);
    req.sessionExpiredReason = 'expired';
    return next();
  }

  // 闲置超时（默认 3 天，基于**心跳**而非普通请求）
  //
  // 为什么用心跳而不是 lastActiveAt：
  //   只要有请求就会刷新 lastActiveAt，而用户可能只是开着页面没操作
  //   （或被脚本/轮询持续打请求），导致「一直在用」的假象。
  //   心跳由前端在页面可见且用户活跃时定时上报，更能代表真实使用状态。
  const lastBeat = Number(
    session.lastHeartbeatAt || session.lastActiveAt || session.createdAt || 0,
  );
  if (lastBeat && now - lastBeat > IDLE_TIMEOUT) {
    expireSession(session, 'idle', req);
    req.sessionExpiredReason = 'idle';
    return next();
  }

  const user = findUserById(session.userId);
  if (!user || user.status === 'banned' || user.deleted) {
    req.sessionExpiredReason = 'disabled';
    if (session) expireSession(session, 'disabled', req);
    return next();
  }

  // 防越权：会话创建时的角色必须与当前一致，
  // 否则说明权限被变更，旧会话不能继续沿用（尤其降权场景）
  if (session.role && session.role !== user.role) {
    expireSession(session, 'role-changed', req);
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

/**
 * 校验请求携带的会话 ID 是否与服务端记录一致
 *
 * 设计意图：cookie 里的 token 是长期凭证，一旦泄露即可长期冒用；
 * 会话 ID 每次请求都随加密载荷一起发送，等于给每个请求加了一道
 * 「本次会话身份」的二次确认：
 *   - 只偷到 cookie 没有 sessionId → 拒绝
 *   - sessionId 与 token 不是同一次登录 → 拒绝
 *   - 角色前缀与实际角色不符 → 拒绝（防越权猜测）
 *
 * 低风险只读接口（浏览圈名、热榜等）豁免，避免无谓开销。
 */
export function assertSessionId(req, res, next) {
  if (!req.user || !req.session) return next();

  const provided = String(req.sessionIdFromBody || req.sessionIdFromHeader || '').trim();

  /**
   * 会话 ID 校验策略（宽松模式）
   *
   * 设计取舍：SID 的价值是「防止只偷到 cookie 就能冒充」，
   * 但它存在浏览器本地，部署更新、清缓存、换标签页都可能丢失，
   * 若因此拒绝请求，用户会频繁遇到「刷新就提示会话校验失败」。
   *
   * 因此改为：
   *   · 未携带 SID  → 自动把服务端的 sessionId 回填给前端（不拒绝）
   *   · SID 不匹配  → 视为本地缓存过期，同样回填而非拒绝
   *   · 角色前缀不符 → 说明本地 SID 属于其他角色，回填
   *
   * 真正的安全边界仍由 cookie 会话 + 人机验证 + 频率限制承担；
   * SID 退化为「防误用提示」而非「硬性门禁」。
   *
   * 如需恢复严格模式，设置环境变量 SESSION_ID_STRICT=1。
   */
  const strict = String(process.env.SESSION_ID_STRICT || '') === '1';

  if (!provided) {
    if (strict) {
      return res.status(401).json({
        error: '会话校验失败，请刷新页面后重新登录',
        code: 'SESSION_ID_REQUIRED',
      });
    }
    // 宽松：通过响应头把正确 SID 回填给前端
    res.setHeader('X-QM-Sid-Refresh', req.session.sessionId || '');
    return next();
  }

  // 与服务端会话比对
  if (provided !== req.session.sessionId) {
    if (strict) {
      try { eventLog(req, '会话ID不匹配', `${provided.slice(0, 32)}`); } catch { /* 忽略 */ }
      return res.status(401).json({
        error: '会话校验失败，请重新登录',
        code: 'SESSION_ID_MISMATCH',
      });
    }
    // 宽松：本地 SID 已过期（如部署更新），回填新值让前端自动修复
    res.setHeader('X-QM-Sid-Refresh', req.session.sessionId || '');
    return next();
  }

  // 角色前缀校验（防伪造他人角色标识）
  const expectPrefix = sessionRolePrefix(req.user.role);
  if (!provided.startsWith(`${expectPrefix}-`)) {
    if (strict) {
      try { eventLog(req, '会话角色不匹配', `${provided.slice(0, 12)}`); } catch { /* 忽略 */ }
      return res.status(403).json({
        error: '会话角色校验失败，请重新登录',
        code: 'SESSION_ROLE_MISMATCH',
      });
    }
    res.setHeader('X-QM-Sid-Refresh', req.session.sessionId || '');
    return next();
  }

  next();
}


/** 标记并移除会话，记录过期原因供审计 */
function expireSession(session, reason, req = null) {
  if (!session) return;
  session.expiredReason = reason;
  db.sessions = db.sessions.filter((s) => s.token !== session.token);
  save('sessions');
  // eventLog 依赖 req.get()，没有请求上下文时只写控制台，避免崩溃
  try {
    if (req && typeof req.get === 'function') {
      eventLog(req, '会话失效', `${session.sessionId || '-'} · ${reason}`);
    } else {
      console.log('[session] 会话失效:', session.sessionId || '-', '·', reason);
    }
  } catch {
    /* 审计失败绝不影响主流程 */
  }
}

export function requireAuth(req, res, next) {
  if (!req.user) return unauthorized(req, res);
  next();
}

/**
 * 统一的「未登录/会话失效」响应
 *
 * 关键：必须带 code 字段，否则前端无法识别为会话问题，
 * 只会当成普通错误弹个提示，页面继续显示旧的登录态
 * —— 这正是「伪登录态」的根源。
 *
 * 区分两种情况：
 *   · 有过会话但失效（有 sessionExpiredReason）→ SESSION_EXPIRED
 *   · 从未登录（没有 cookie）→ NOT_AUTHENTICATED
 */
function unauthorized(req, res) {
  const reason = req.sessionExpiredReason;
  if (reason) {
    return res.status(401).json({
      error: '登录过期，请重新登录',
      code: 'SESSION_EXPIRED',
      reason,
    });
  }
  return res.status(401).json({
    error: '请先登录后再继续操作',
    code: 'NOT_AUTHENTICATED',
  });
}

/** 需要指定权限点（admin 拥有全部权限） */
export function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) return unauthorized(req, res);
    if (!hasPermission(req.user, permission)) {
      return res.status(403).json({ error: '当前账号没有该操作权限，请联系管理员开通' });
    }
    next();
  };
}

/** 仅管理员 */
export function requireAdmin(req, res, next) {
  if (!req.user) return unauthorized(req, res);
  if (req.user.role !== 'admin') return res.status(403).json({ error: '仅管理员可以执行该操作' });
  next();
}

/** 管理员或审核员 */
export function requireStaff(req, res, next) {
  if (!req.user) return unauthorized(req, res);
  if (!['admin', 'superadmin', 'assessor'].includes(req.user.role)) {
    return res.status(403).json({ error: '仅管理员、超级管理员与审核员可以访问该资源' });
  }
  next();
}

export { hasPermission };

/**
 * 上报心跳
 *
 * 由前端在「页面可见 + 用户有操作」时定时调用（默认 60 秒一次）。
 * 服务端只更新 lastHeartbeatAt，不延长绝对有效期。
 *
 * @returns {{ok:boolean, reason?:string, nextIn?:number}}
 */
export function touchHeartbeat(session) {
  if (!session) return { ok: false, reason: 'NO_SESSION' };
  const now = Date.now();
  const lastBeat = Number(session.lastHeartbeatAt || 0);
  // 节流：30 秒内重复上报不写库，避免多标签页刷爆
  if (lastBeat && now - lastBeat < 30_000) {
    return { ok: true, throttled: true };
  }
  session.lastHeartbeatAt = now;
  session.lastActiveAt = now;
  save('sessions');
  return { ok: true };
}

/** 心跳间隔建议值（毫秒），供前端定时器使用 */
export function heartbeatInterval() {
  // 注意：先换算成毫秒再取 max，否则 Math.max(15000, 60)*1000 = 15000000（4 小时）
  const sec = Math.max(15, Number(process.env.SESSION_HEARTBEAT_SECONDS) || 60);
  return sec * 1000;
}
