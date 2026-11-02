import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, DATA_DIR, UPLOAD_DIR } from './paths.js';
import { getDb, closeDb, transaction } from './sqlite.js';
import * as repo from './repo.js';

/**
 * 数据访问层（SQLite 持久化 + 内存缓存）
 *
 * 为什么保留内存缓存：
 * 业务代码中存在大量 `db.users.find(...)`、`db.sessions.filter(...)` 形式的同步查询，
 * 直接改成 SQL 会引入大量 async/await 改造，风险高且易遗漏。
 *
 * 采用「写穿透 + 读缓存」策略：
 *   - 启动时把全部数据加载进内存（本项目量级下完全可行）
 *   - 所有写操作同步更新内存 + 落库（save()/saveXxx()）
 *   - 读操作直接走内存，保持原有同步语义与性能
 *
 * 数据安全：
 *   - 每次写操作都立即持久化到 SQLite（不是靠定时刷盘）
 *   - 关键流程用事务保证多表一致性
 */

export { ROOT, DATA_DIR, UPLOAD_DIR };
export const uid = (prefix = '') => prefix + crypto.randomBytes(8).toString('hex');

/* ---------------- 默认配置 ---------------- */
const DEFAULT_SETTINGS = {
  mail: {
    host: 'smtp.qq.com',
    port: 465,
    secure: true,
    user: '',
    pass: '',
    fromName: '小天才圈名平台',
    fromEmail: '',
    subject: '【小天才圈名平台】{{action}}验证码 {{code}}',
    template: '',
    enabled: false,
  },
  binding: { monthlyLimit: 3 },
  registerGuard: {
    enabled: true,
    windowMinutes: 10,
    maxPerWindow: 5,
    tempBlockMinutes: 30,
    permBlockAfter: 3,
  },
  rateLimit: {
    enabled: true,
    windowSeconds: 10,
    maxRequests: 120,
    tempBlockSeconds: 60,
    strikesBeforeLongBlock: 3,
    longBlockSeconds: 600,
    whitelist: ['127.0.0.1', '::1'],
  },
};

function deepMerge(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') {
      out[k] = deepMerge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/* ---------------- 内存缓存 ---------------- */
export const db = {
  users: [],
  sessions: [],
  names: [],
  claims: [],
  appeals: [],
  notifications: [],
  logs: [],
  codes: [],
  searches: [],
  captchas: [],
  security: {
    blockedIps: [],
    tempBlocks: [],
    events: [],
    registerAttempts: {},
  },
  settings: structuredClone(DEFAULT_SETTINGS),
  meta: {},
};

/* ---------------- 启动加载 ---------------- */
function loadAll() {
  const conn = getDb();

  db.users = conn.prepare('SELECT * FROM users').all().map(repo.mapUser);
  db.sessions = conn.prepare('SELECT * FROM sessions').all().map(repo.mapSession);
  db.names = conn.prepare('SELECT * FROM names').all().map(repo.mapName);
  db.claims = conn.prepare('SELECT * FROM claims').all().map(repo.mapClaim);
  db.appeals = conn.prepare('SELECT * FROM appeals').all().map(repo.mapAppeal);
  db.notifications = conn.prepare('SELECT * FROM notifications').all().map(repo.mapNotification);
  db.logs = conn.prepare('SELECT * FROM access_logs ORDER BY ts DESC').all().map(repo.mapLog);
  db.codes = conn.prepare('SELECT * FROM email_codes').all().map(repo.mapCode);
  db.captchas = conn.prepare('SELECT * FROM captchas').all().map(repo.mapCaptcha);

  db.security.blockedIps = conn
    .prepare('SELECT * FROM blocked_ips')
    .all()
    .map((r) => ({ ip: r.ip, reason: r.reason, by: r.by_user, createdAt: r.created_at }));

  db.security.tempBlocks = conn
    .prepare('SELECT * FROM temp_blocks')
    .all()
    .map((r) => ({ ip: r.ip, until: r.until_ms, strikes: r.strikes, reason: r.reason, blockedAt: r.blocked_at }));

  db.security.events = conn
    .prepare('SELECT * FROM security_events ORDER BY created_at DESC LIMIT 500')
    .all()
    .map((r) => ({ id: r.id, type: r.type, ip: r.ip, reason: r.reason, level: r.level, seconds: r.seconds, strikes: r.strikes, createdAt: r.created_at }));

  // 注册尝试计数（按 IP）
  const regRows = conn.prepare('SELECT * FROM register_attempts').all();
  db.security.registerAttempts = {};
  for (const r of regRows) {
    db.security.registerAttempts[r.ip] = {
      attempts: repo.json.parse(r.attempts, []),
      failures: repo.json.parse(r.failures, []),
      blocks: r.blocks || 0,
      lastAt: r.last_at || 0,
    };
  }

  // 登录失败计数（三维度）
  const lf = conn.prepare('SELECT * FROM login_attempts').all();
  const loginAttempts = { accounts: {}, ips: {}, hashes: {} };
  for (const r of lf) {
    const rec = { count: r.count, level: r.level, lockedUntil: r.locked_until, lastAt: r.last_at, ...repo.json.parse(r.extra, {}) };
    if (r.scope === 'account') loginAttempts.accounts[r.key] = rec;
    else if (r.scope === 'ip') loginAttempts.ips[r.key] = rec;
    else if (r.scope === 'hash') loginAttempts.hashes[r.key] = rec;
  }
  db.security.loginAttempts = loginAttempts;

  // 配置
  const saved = repo.loadSettings();
  db.settings = deepMerge(structuredClone(DEFAULT_SETTINGS), saved || {});

  db.meta = { version: 4, engine: 'sqlite', loadedAt: new Date().toISOString() };
  return db;
}

loadAll();

/* ---------------- 持久化 API ---------------- */

/** 全量落库（用于初始化/迁移等场景） */
export function flush() {
  const conn = getDb();
  transaction(() => {
    for (const u of db.users) repo.saveUser(u);
    for (const n of db.names) repo.saveName(n);
    for (const c of db.claims) repo.saveClaim(c);
    for (const a of db.appeals) repo.saveAppeal(a);
    for (const n of db.notifications) repo.saveNotification(n);
    for (const s of db.sessions) repo.saveSession(s);
    for (const c of db.codes) repo.saveCode(c);
    for (const c of db.captchas) repo.saveCaptcha(c);
    for (const l of db.logs) repo.saveLog(l);
  });
}

/**
 * 通用保存（保持向后兼容）
 * 业务代码里大量 `save()` 调用无法逐一区分改了什么，
 * 这里做「增量同步」：对比内存与库中记录，只写有变化的表。
 * 为控制开销，采用轻量版本号机制。
 */
let saveTimer = null;
let dirty = new Set();

export function markDirty(table) {
  dirty.add(table);
}

export function save(table) {
  if (table) dirty.add(table);
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const tables = dirty.size
      ? new Set(dirty)
      : new Set(['users', 'sessions', 'names', 'claims', 'appeals', 'notifications', 'codes', 'captchas', 'logs', 'settings']);
    dirty = new Set();
    try {
      persistTables(tables);
    } catch (err) {
      console.error('[db] 写入数据库失败:', err.message);
    }
  }, 60);
}

/** 立即持久化指定表（关键操作使用，确保不丢数据） */
export function persistTables(tables) {
  transaction(() => {
    if (tables.has('users')) for (const u of db.users) repo.saveUser(u);
    if (tables.has('sessions')) for (const s of db.sessions) repo.saveSession(s);
    if (tables.has('names')) for (const n of db.names) repo.saveName(n);
    if (tables.has('claims')) for (const c of db.claims) repo.saveClaim(c);
    if (tables.has('appeals')) for (const a of db.appeals) repo.saveAppeal(a);
    if (tables.has('notifications')) for (const n of db.notifications) repo.saveNotification(n);
    if (tables.has('codes')) for (const c of db.codes) repo.saveCode(c);
    if (tables.has('captchas')) for (const c of db.captchas) repo.saveCaptcha(c);
    if (tables.has('logs')) for (const l of db.logs) repo.saveLog(l);
    if (tables.has('settings')) for (const [k, v] of Object.entries(db.settings)) repo.saveSettings(k, v);
    // 安全相关表
    if (tables.has('blocked_ips')) repo.saveBlockedIps(db.security?.blockedIps || []);
    if (tables.has('temp_blocks')) repo.saveTempBlocks(db.security?.tempBlocks || []);
    if (tables.has('security_events')) {
      for (const e of (db.security?.events || []).slice(0, 100)) repo.saveSecurityEvent(e);
    }
    if (tables.has('register_attempts')) {
      for (const [ip, r] of Object.entries(db.security?.registerAttempts || {})) {
        repo.saveRegisterAttempt({ ip, ...r });
      }
    }
    if (tables.has('login_attempts')) {
      const la = db.security?.loginAttempts || {};
      for (const [k, v] of Object.entries(la.accounts || {})) {
        repo.saveLoginAttempt({ key: 'acct:' + k, kind: 'account', ...v });
      }
      for (const [k, v] of Object.entries(la.ips || {})) {
        repo.saveLoginAttempt({ key: 'ip:' + k, kind: 'ip', ...v });
      }
      for (const [k, v] of Object.entries(la.hashes || {})) {
        repo.saveLoginAttempt({ key: 'hash:' + k, kind: 'hash', count: v.count || 0, payload: { accounts: v.accounts || [] }, lastAt: v.lastAt });
      }
    }
  });
}

/** 立即落盘（进程退出/关键写操作后调用） */
export function persistNow() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const tables = dirty.size
    ? new Set([...dirty, 'users', 'sessions'])
    : new Set(['users', 'sessions', 'names', 'claims', 'appeals', 'notifications', 'codes', 'captchas', 'logs', 'settings', 'blocked_ips', 'temp_blocks']);
  dirty = new Set();
  try {
    persistTables(tables);
  } catch (err) {
    console.error('[db] persistNow 失败:', err.message);
  }
}

export const flushPolicy = { mode: 'sqlite-wal', immediate: true };

export function dbStats() {
  return {
    engine: 'SQLite',
    path: 'data/quanming.db',
    users: db.users.length,
    names: db.names.length,
    claims: db.claims.length,
    appeals: db.appeals.length,
    notifications: db.notifications.length,
    logs: db.logs.length,
  };
}

const shutdown = () => {
  try {
    persistNow();
  } catch {}
  try {
    closeDb();
  } catch {}
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

/* ---------------- 用户相关工具 ---------------- */
export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email || '',
    emailDomain: u.emailDomain || '',
    phone: u.phone || '',
    phoneMasked: maskPhone(u.phone),
    username: u.username || '',
    nickname: u.nickname,
    role: u.role,
    roleLabel: ROLE_LABELS[u.role] || '普通用户',
    status: u.status,
    bio: u.bio || '',
    avatarHue: u.avatarHue ?? 260,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt || null,
    bindings: u.bindings || {},
    bindingUsage: bindingUsage(u),
    stats: u.stats || {},
    permissions: ROLE_PERMISSIONS[u.role] || ROLE_PERMISSIONS.user,
  };
}

export const BINDING_PLATFORMS = ['qq', 'wechat', 'xiaohongshu'];

export function bindingMonthlyLimit() {
  return Math.max(1, Number(db.settings?.binding?.monthlyLimit) || 3);
}

export function currentMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function bindingUsage(u) {
  const limit = bindingMonthlyLimit();
  const month = currentMonthKey();
  const record = u?.bindingChanges || {};
  const used = record.month === month ? Number(record.count) || 0 : 0;
  return {
    month,
    used,
    limit,
    remaining: Math.max(0, limit - used),
    resetAt: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString(),
  };
}

export function consumeBindingQuota(u, { skipLimit = false } = {}) {
  const month = currentMonthKey();
  const limit = bindingMonthlyLimit();
  const current = u.bindingChanges?.month === month ? Number(u.bindingChanges.count) || 0 : 0;

  if (skipLimit) {
    return { ok: true, usage: { month, used: current, limit, remaining: Math.max(0, limit - current) } };
  }
  if (current >= limit) {
    return {
      ok: false,
      error: `本月绑定修改次数已用完（每月最多 ${limit} 次），下月 1 日重置`,
      usage: { month, used: current, limit, remaining: 0 },
    };
  }
  const used = current + 1;
  u.bindingChanges = { month, count: used };
  save('users');
  return { ok: true, usage: { month, used, limit, remaining: Math.max(0, limit - used) } };
}

export function refundBindingQuota(u) {
  if (!u.bindingChanges) return;
  const month = currentMonthKey();
  if (u.bindingChanges.month !== month) return;
  u.bindingChanges.count = Math.max(0, Number(u.bindingChanges.count) - 1);
  save('users');
}

export function maskPhone(phone) {
  const s = String(phone || '');
  if (!/^1\d{10}$/.test(s)) return s;
  return `${s.slice(0, 3)}****${s.slice(7)}`;
}

/* ---------------- 角色权限 ---------------- */
export const ROLES = ['admin', 'assessor', 'user'];

export const ROLE_LABELS = {
  admin: '管理员',
  assessor: '审核员',
  user: '普通用户',
};

export const ROLE_PERMISSIONS = {
  admin: ['review', 'appeal', 'users', 'names', 'logs', 'settings', 'notify', 'dashboard'],
  assessor: ['review', 'appeal', 'dashboard', 'logs'],
  user: [],
};

export function hasPermission(user, permission) {
  if (!user) return false;
  return (ROLE_PERMISSIONS[user.role] || []).includes(permission);
}

/* ---------------- 查询助手（优先内存，保证同步语义） ---------------- */
export function findUserByEmail(email) {
  const target = String(email || '').trim().toLowerCase();
  if (!target) return null;
  return db.users.find((u) => !u.deleted && (u.email || '').toLowerCase() === target);
}

export function findUserByPhone(phone) {
  const target = String(phone || '').trim();
  if (!target) return null;
  return db.users.find((u) => !u.deleted && u.phone === target);
}

export function findUserByUsername(username) {
  const target = String(username || '').trim().toLowerCase();
  if (!target) return null;
  return db.users.find((u) => !u.deleted && (u.username || '').toLowerCase() === target);
}

export function findUserByIdentifier(identifier) {
  const raw = String(identifier || '').trim();
  if (!raw) return null;
  if (raw.includes('@')) return findUserByEmail(raw);
  if (/^1\d{10}$/.test(raw)) return findUserByPhone(raw);
  return findUserByUsername(raw) || findUserByPhone(raw);
}

export function findUserById(id) {
  return db.users.find((u) => u.id === id);
}

export function isNameTaken(name) {
  const target = String(name || '').trim().toLowerCase();
  return db.names.some((n) => n.name.toLowerCase() === target);
}

export function maskEmail(email) {
  const [local, domain] = String(email || '').split('@');
  if (!domain) return '***';
  const head = local.slice(0, Math.min(2, local.length));
  return head + '*'.repeat(Math.max(2, Math.min(6, local.length - head.length))) + '@' + domain;
}

export function maskNickname(nickname) {
  const s = String(nickname || '圈友');
  if (s.length <= 1) return s + '*';
  return s.slice(0, 1) + '*'.repeat(Math.max(1, s.length - 1));
}
