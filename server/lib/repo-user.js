import { all, get, run, tx, parseJson } from './db-sqlite.js';

/** 数据库行 → API 用户对象 */
export function shapeUser(row) {
  if (!row) return null;
  const bindings = {};
  if (row.bind_qq) bindings.qq = { handle: row.bind_qq, nickname: row.bind_qq_name, avatar: row.bind_qq_avatar, boundAt: row.bind_qq_at, verified: true };
  if (row.bind_wechat) bindings.wechat = { handle: row.bind_wechat, nickname: row.bind_wechat_name, avatar: row.bind_wechat_avatar, boundAt: row.bind_wechat_at, verified: true };
  if (row.bind_xhs) bindings.xiaohongshu = { handle: row.bind_xhs, nickname: row.bind_xhs_name, avatar: row.bind_xhs_avatar, boundAt: row.bind_xhs_at, verified: true };

  return {
    id: row.id,
    email: row.email || '',
    emailDomain: row.email_domain || '',
    phone: row.phone || '',
    phoneMasked: maskPhone(row.phone),
    username: row.username || '',
    nickname: row.nickname,
    role: row.role,
    roleLabel: ROLE_LABELS[row.role] || '普通用户',
    status: row.status,
    bio: row.bio || '',
    avatarHue: row.avatar_hue ?? 260,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at || null,
    bindings,
    bindingUsage: {
      month: row.bind_month || '',
      used: row.bind_count || 0,
      limit: 3,
      remaining: Math.max(0, 3 - (row.bind_count || 0)),
    },
    stats: {},
    permissions: ROLE_PERMISSIONS[row.role] || [],
  };
}

export function maskPhone(phone) {
  const s = String(phone || '');
  return /^1\d{10}$/.test(s) ? `${s.slice(0, 3)}****${s.slice(7)}` : s;
}

export const ROLE_LABELS = { admin: '管理员', assessor: '审核员', user: '普通用户' };
export const ROLE_PERMISSIONS = {
  admin: ['review', 'appeal', 'users', 'names', 'logs', 'settings', 'notify', 'dashboard'],
  assessor: ['review', 'appeal', 'dashboard', 'logs'],
  user: [],
};

export const findUserById = (id) => get('SELECT * FROM users WHERE id = ? AND deleted = 0', id);
export const findUserByEmail = (email) =>
  email ? get('SELECT * FROM users WHERE lower(email) = lower(?) AND deleted = 0', String(email).trim()) : null;
export const findUserByPhone = (phone) =>
  phone ? get('SELECT * FROM users WHERE phone = ? AND deleted = 0', String(phone).trim()) : null;
export const findUserByUsername = (u) =>
  u ? get('SELECT * FROM users WHERE lower(username) = lower(?) AND deleted = 0', String(u).trim()) : null;

export function findUserByIdentifier(raw) {
  const v = String(raw || '').trim();
  if (!v) return null;
  if (v.includes('@')) return findUserByEmail(v);
  if (/^1\d{10}$/.test(v)) return findUserByPhone(v);
  return findUserByUsername(v) || findUserByPhone(v);
}

/** 创建用户 */
export function createUser(u) {
  run(
    `INSERT INTO users
      (id,email,email_domain,phone,username,nickname,password_hash,role,status,bio,avatar_hue,
       deleted,bind_month,bind_count,last_login_at,last_ip,login_count,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,0,'',0,?,?,?,?)`,
    u.id, u.email || null, u.emailDomain || null, u.phone || null, u.username, u.nickname,
    u.passwordHash, u.role || 'user', u.status || 'active', u.bio || '', u.avatarHue ?? 260,
    u.lastLoginAt || null, u.lastIp || null, u.loginCount || 0, u.createdAt,
  );
  return findUserById(u.id);
}

/** 更新任意字段（白名单列名） */
const ALLOWED = new Set([
  'email','email_domain','phone','username','nickname','password_hash','role','status',
  'bio','avatar_hue','ban_reason','deleted','last_login_at','last_ip','login_count',
  'bind_qq','bind_qq_name','bind_qq_avatar','bind_qq_at',
  'bind_wechat','bind_wechat_name','bind_wechat_avatar','bind_wechat_at',
  'bind_xhs','bind_xhs_name','bind_xhs_avatar','bind_xhs_at',
  'bind_month','bind_count',
]);

export function updateUser(id, patch) {
  const keys = Object.keys(patch).filter((k) => ALLOWED.has(k));
  if (!keys.length) return findUserById(id);
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  run(`UPDATE users SET ${sets}, updated_at = ? WHERE id = ?`, ...keys.map((k) => patch[k]), new Date().toISOString(), id);
  return findUserById(id);
}

/** 社交绑定状态（OAuth 结果） */
export function setBinding(userId, provider, info) {
  const map = {
    qq: ['bind_qq', 'bind_qq_name', 'bind_qq_avatar', 'bind_qq_at'],
    wechat: ['bind_wechat', 'bind_wechat_name', 'bind_wechat_avatar', 'bind_wechat_at'],
    xhs: ['bind_xhs', 'bind_xhs_name', 'bind_xhs_avatar', 'bind_xhs_at'],
  }[provider];
  if (!map) throw new Error('不支持的平台');
  const at = new Date().toISOString();
  run(
    `UPDATE users SET ${map[0]} = ?, ${map[1]} = ?, ${map[2]} = ?, ${map[3]} = ?, updated_at = ? WHERE id = ?`,
    info.openId, info.nickname || '', info.avatar || '', at, at, userId,
  );
  return findUserById(userId);
}

export function clearBinding(userId, provider) {
  const map = {
    qq: ['bind_qq', 'bind_qq_name', 'bind_qq_avatar', 'bind_qq_at'],
    wechat: ['bind_wechat', 'bind_wechat_name', 'bind_wechat_avatar', 'bind_wechat_at'],
    xhs: ['bind_xhs', 'bind_xhs_name', 'bind_xhs_avatar', 'bind_xhs_at'],
  }[provider];
  if (!map) throw new Error('不支持的平台');
  run(
    `UPDATE users SET ${map[0]} = NULL, ${map[1]} = NULL, ${map[2]} = NULL, ${map[3]} = NULL, updated_at = ? WHERE id = ?`,
    new Date().toISOString(), userId,
  );
  return findUserById(userId);
}

/** 绑定额度（每月 3 次，原子操作） */
export function consumeBindQuota(userId, { skipLimit = false } = {}) {
  const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  return tx(() => {
    const u = get('SELECT bind_month, bind_count FROM users WHERE id = ?', userId);
    if (!u) return { ok: false, error: '用户不存在' };
    const used = u.bind_month === month ? u.bind_count : 0;
    if (skipLimit) return { ok: true, usage: { month, used, limit: 3, remaining: 3 - used } };
    if (used >= 3) return { ok: false, error: '本月绑定修改次数已用完（每月最多 3 次），下月 1 日重置', usage: { month, used, limit: 3, remaining: 0 } };
    const next = used + 1;
    run('UPDATE users SET bind_month = ?, bind_count = ?, updated_at = ? WHERE id = ?', month, next, new Date().toISOString(), userId);
    return { ok: true, usage: { month, used: next, limit: 3, remaining: 3 - next } };
  });
}

/** 统计 */
export function userStats(userId) {
  const claims = get('SELECT count(*) n FROM claims WHERE user_id = ?', userId)?.n || 0;
  const approved = get("SELECT count(*) n FROM claims WHERE user_id = ? AND status='approved'", userId)?.n || 0;
  const rejected = get("SELECT count(*) n FROM claims WHERE user_id = ? AND status='rejected'", userId)?.n || 0;
  const names = get("SELECT count(*) n FROM names WHERE owner_id = ? AND status='active'", userId)?.n || 0;
  const appeals = get('SELECT count(*) n FROM appeals WHERE user_id = ?', userId)?.n || 0;
  return { claims, approved, rejected, names, appeals };
}
