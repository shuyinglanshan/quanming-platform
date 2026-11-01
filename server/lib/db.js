import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const UPLOAD_DIR = path.join(ROOT, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');

export const uid = (prefix = '') => prefix + crypto.randomBytes(8).toString('hex');

const EMPTY = {
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
    // 永久封禁的 IP：{ ip, reason, createdAt, by }
    blockedIps: [],
    // 临时封禁：{ ip, until, strikes, reason }
    tempBlocks: [],
    // 风控事件记录（用于后台展示）
    events: [],
  },
  settings: {
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
    // 社交平台账号信息接口（小红书 / QQ / 微信）
    // 官方均需 OAuth 授权，未配置时绑定仅记录账号，不展示昵称头像
    social: {
      qq: {
        enabled: false,
        endpoint: '',
        method: 'GET',
        headers: '',
        params: 'uin={{handle}}',
        nicknamePath: 'nickname',
        avatarPath: 'avatar',
        uidPath: 'uin',
        appId: '',
        appSecret: '',
        note: '',
      },
      wechat: {
        enabled: false,
        endpoint: '',
        method: 'GET',
        headers: '',
        params: 'openid={{handle}}',
        nicknamePath: 'nickname',
        avatarPath: 'headimgurl',
        uidPath: 'openid',
        appId: '',
        appSecret: '',
        note: '',
      },
      xiaohongshu: {
        enabled: false,
        endpoint: '',
        method: 'GET',
        headers: '',
        params: 'user_id={{handle}}',
        nicknamePath: 'nickname',
        avatarPath: 'avatar',
        uidPath: 'user_id',
        appId: '',
        appSecret: '',
        note: '',
      },
    },
    binding: {
      // 每个平台每月允许修改绑定的次数
      monthlyLimit: 3,
    },
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
  },
  meta: { createdAt: new Date().toISOString(), version: 3 },
};

function ensureDirs() {
  for (const dir of [DATA_DIR, UPLOAD_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

function load() {
  ensureDirs();
  if (!fs.existsSync(DB_FILE)) return structuredClone(EMPTY);
  try {
    const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    const base = structuredClone(EMPTY);
    // 深合并，保证老数据文件升级后仍具备新字段
    const merged = {
      ...base,
      ...raw,
      security: { ...base.security, ...(raw.security || {}) },
      settings: {
        ...base.settings,
        ...(raw.settings || {}),
        mail: { ...base.settings.mail, ...(raw.settings?.mail || {}) },
        social: {
          qq: { ...base.settings.social.qq, ...(raw.settings?.social?.qq || {}) },
          wechat: { ...base.settings.social.wechat, ...(raw.settings?.social?.wechat || {}) },
          xiaohongshu: { ...base.settings.social.xiaohongshu, ...(raw.settings?.social?.xiaohongshu || {}) },
        },
        binding: { ...base.settings.binding, ...(raw.settings?.binding || {}) },
        registerGuard: { ...base.settings.registerGuard, ...(raw.settings?.registerGuard || {}) },
        rateLimit: { ...base.settings.rateLimit, ...(raw.settings?.rateLimit || {}) },
      },
    };
    return merged;
  } catch (err) {
    console.error('[db] 数据库文件损坏，已备份并使用空库:', err.message);
    try {
      fs.copyFileSync(DB_FILE, DB_FILE + '.broken-' + Date.now());
    } catch {}
    return structuredClone(EMPTY);
  }
}

export const db = load();

let saveTimer = null;
let saving = false;
let dirty = false;
let writeCount = 0;

/**
 * 落盘策略优化（性能关键）
 *
 * 早期实现：每个请求都 save() → JSON.stringify 整个 db + 同步 writeFileSync。
 * 并发下（db 涨到 287KB）单次约 0.7~3ms 且阻塞事件循环，导致 p99 飙升。
 *
 * 现在：
 * - 日志类高频写入只标脏，按固定间隔合并落盘
 * - 业务数据变更仍走 120ms 防抖
 * - 进程退出 / 显式 persistNow 时强制冲刷
 */
export const flushPolicy = {
  intervalMs: 1000, // 日志批量落盘间隔
  maxDirtyEntries: 200, // 脏条目达到阈值立即落盘
};

/** 立即落盘（原子写入） */
export function flush() {
  ensureDirs();
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

/** 合并短时间内的多次写入，避免频繁 IO */
export function save() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (saving) return;
    saving = true;
    try {
      flush();
      dirty = false;
      writeCount += 1;
    } catch (err) {
      console.error('[db] 写入失败:', err.message);
    } finally {
      saving = false;
    }
  }, 120);
}

/** 统计信息（性能观测用） */
export function dbStats() {
  return {
    writes: writeCount,
    dirty,
    sizeBytes: fs.existsSync(DB_FILE) ? fs.statSync(DB_FILE).size : 0,
    logs: db.logs.length,
    users: db.users.length,
  };
}

export function persistNow() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  flush();
}

const shutdown = () => {
  try {
    persistNow();
  } catch {}
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

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

/* ---------------- 社交绑定修改限额 ---------------- */
export const BINDING_PLATFORMS = ['qq', 'wechat', 'xiaohongshu'];

export function bindingMonthlyLimit() {
  return Math.max(1, Number(db.settings?.binding?.monthlyLimit) || 3);
}

export function currentMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** 返回该用户本月的绑定修改次数与剩余次数 */
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

/**
 * 校验并消耗一次绑定修改额度
 * 返回 { ok: true, usage } 或 { ok: false, error, usage }
 */
/**
 * 绑定限额「检查 + 自增」原子操作
 *
 * 并发安全：Node 单线程下，只要本函数内部**没有任何 await / 异步让出**，
 * 检查与自增就是一个不可分割的临界区，多个并发请求不会同时通过。
 * 因此这里只做同步内存操作，save() 的异步落盘放在最后。
 */
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
  // 同步自增（临界区内，不会被并发打断）
  const used = current + 1;
  u.bindingChanges = { month, count: used };
  save();
  return { ok: true, usage: { month, used, limit, remaining: Math.max(0, limit - used) } };
}

/** 额度回滚：业务失败时归还一次（例如绑定目标被占用） */
export function refundBindingQuota(u) {
  if (!u.bindingChanges) return;
  const month = currentMonthKey();
  if (u.bindingChanges.month !== month) return;
  u.bindingChanges.count = Math.max(0, Number(u.bindingChanges.count) - 1);
  save();
}

export function maskPhone(phone) {
  const s = String(phone || '');
  if (!/^1\d{10}$/.test(s)) return s;
  return `${s.slice(0, 3)}****${s.slice(7)}`;
}

/* ---------------- 角色与权限 ---------------- */
export const ROLES = ['admin', 'assessor', 'user'];

export const ROLE_LABELS = {
  admin: '管理员',
  assessor: '审核员',
  user: '普通用户',
};

/** 权限点：审核、用户管理、圈名管理、日志、系统设置、通知发布 */
export const ROLE_PERMISSIONS = {
  admin: ['review', 'appeal', 'users', 'names', 'logs', 'settings', 'notify', 'dashboard'],
  assessor: ['review', 'appeal', 'dashboard', 'logs'],
  user: [],
};

export function hasPermission(user, permission) {
  if (!user) return false;
  const perms = ROLE_PERMISSIONS[user.role] || [];
  return perms.includes(permission);
}

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

/** 统一按「邮箱 / 手机号 / 用户名」查找用户 */
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
