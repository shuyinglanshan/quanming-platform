import {
  db,
  save,
  bindingUsage,
  consumeBindingQuota,
  maskPhone,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
} from './db.js';

/**
 * 用户层统一走 db.js 的内存 + SQLite 主数据模型。
 * 绑定关系存放在 users.bindings(JSON)，不再使用 bind_xxx 独立列，
 * 避免与后台管理、圈名详情读取的数据不一致。
 */

const ALLOWED_FIELDS = new Set([
  'email', 'emailDomain', 'phone', 'username', 'nickname', 'passwordHash', 'role', 'status',
  'bio', 'avatarHue', 'banReason', 'lastLoginAt', 'lastIp', 'loginCount', 'deleted',
  'bindings', 'bindingChanges', 'stats',
]);

const FIELD_MAP = {
  email_domain: 'emailDomain',
  avatar_hue: 'avatarHue',
  password_hash: 'passwordHash',
  ban_reason: 'banReason',
  last_login_at: 'lastLoginAt',
  last_ip: 'lastIp',
  login_count: 'loginCount',
  created_at: 'createdAt',
  binding_changes: 'bindingChanges',
};

/** 数据库用户对象 → API 用户对象 */
export function shapeUser(u) {
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
    permissions: ROLE_PERMISSIONS[u.role] || [],
  };
}

export const findUserById = (id) => db.users.find((u) => !u.deleted && u.id === id) || null;

export const findUserByEmail = (email) => {
  const target = String(email || '').trim().toLowerCase();
  if (!target) return null;
  return db.users.find((u) => !u.deleted && (u.email || '').toLowerCase() === target) || null;
};

export const findUserByPhone = (phone) => {
  const target = String(phone || '').trim();
  if (!target) return null;
  return db.users.find((u) => !u.deleted && u.phone === target) || null;
};

export const findUserByUsername = (username) => {
  const target = String(username || '').trim().toLowerCase();
  if (!target) return null;
  return db.users.find((u) => !u.deleted && (u.username || '').toLowerCase() === target) || null;
};

export function findUserByIdentifier(raw) {
  const v = String(raw || '').trim();
  if (!v) return null;
  if (v.includes('@')) return findUserByEmail(v);
  if (/^1\d{10}$/.test(v)) return findUserByPhone(v);
  return findUserByUsername(v) || findUserByPhone(v);
}

/** 更新任意字段（白名单列名，兼容 snake_case） */
export function updateUser(id, patch = {}) {
  const u = findUserById(id);
  if (!u) return null;
  for (const [rawKey, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const key = FIELD_MAP[rawKey] || rawKey;
    if (!ALLOWED_FIELDS.has(key)) continue;
    u[key] = value;
  }
  save('users');
  return u;
}

/** 绑定额度（每月 3 次，走主数据层的 bindingChanges） */
export function consumeBindQuota(userId, options = {}) {
  const u = findUserById(userId);
  if (!u) return { ok: false, error: '用户不存在' };
  return consumeBindingQuota(u, options);
}

/** 统计（与内存数据保持一致） */
export function userStats(userId) {
  const claims = db.claims.filter((c) => c.userId === userId);
  return {
    claims: claims.length,
    approved: claims.filter((c) => c.status === 'approved').length,
    rejected: claims.filter((c) => c.status === 'rejected').length,
    names: db.names.filter((n) => n.ownerId === userId && n.status === 'active').length,
    appeals: db.appeals.filter((a) => a.userId === userId).length,
  };
}
