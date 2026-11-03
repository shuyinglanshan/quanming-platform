import express from 'express';
import { db, save, publicUser, findUserById, maskEmail, ROLES, ROLE_LABELS } from '../lib/db.js';
import { requirePermission } from '../lib/auth.js';
import { paginate, sanitizeText } from '../lib/util.js';
import { shapeName } from './names.js';
import { eventLog } from '../lib/logger.js';
import { notifyUser } from '../lib/notify.js';
import { deleteName } from '../lib/repo.js';

const router = express.Router();

/** 社交平台账号规则（与个人中心保持一致） */
const PLATFORM_RULES = {
  qq: { label: 'QQ', pattern: /^\d{5,12}$/, hint: '请输入 5-12 位 QQ 号' },
  wechat: { label: '微信', pattern: /^[a-zA-Z][-_a-zA-Z0-9]{5,19}$/, hint: '请输入 6-20 位微信号（字母开头）' },
  xiaohongshu: { label: '小红书', pattern: /^[a-zA-Z0-9_.]{2,24}$/, hint: '请输入小红书号（2-24 位字母、数字、下划线）' },
};

/* ============ 用户管理（权限组） ============ */
router.get('/users', requirePermission('users'), (req, res) => {
  const { q = '', status = 'all', role = 'all', sort = 'latest', page = 1, pageSize = 10 } = req.query;
  const keyword = String(q).trim().toLowerCase();
  let list = db.users.filter((u) => !u.deleted);
  if (status !== 'all') list = list.filter((u) => u.status === status);
  if (role !== 'all') list = list.filter((u) => u.role === role);
  if (keyword) {
    list = list.filter(
      (u) =>
        (u.email || '').toLowerCase().includes(keyword) ||
        (u.username || '').toLowerCase().includes(keyword) ||
        (u.phone || '').includes(keyword) ||
        u.nickname.toLowerCase().includes(keyword) ||
        u.id === keyword,
    );
  }
  const sorters = {
    latest: (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
    oldest: (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
    active: (a, b) => new Date(b.lastLoginAt || 0) - new Date(a.lastLoginAt || 0),
    claims: (a, b) => (b.stats?.claims || 0) - (a.stats?.claims || 0),
  };
  list = [...list].sort(sorters[sort] || sorters.latest);
  const result = paginate(list, page, pageSize);
  res.json({
    ...result,
    items: result.items.map((u) => ({
      ...publicUser(u),
      maskedEmail: maskEmail(u.email),
      phoneMasked: u.phone ? `${u.phone.slice(0, 3)}****${u.phone.slice(7)}` : '',
      lastIp: u.lastIp || '',
      loginCount: u.loginCount || 0,
      names: db.names.filter((n) => n.ownerId === u.id).map((n) => n.name),
      claimsTotal: db.claims.filter((c) => c.userId === u.id).length,
      appealsTotal: db.appeals.filter((a) => a.userId === u.id).length,
    })),
    counts: {
      all: db.users.filter((u) => !u.deleted).length,
      active: db.users.filter((u) => u.status === 'active' && !u.deleted).length,
      banned: db.users.filter((u) => u.status === 'banned' && !u.deleted).length,
      admin: db.users.filter((u) => u.role === 'admin' && !u.deleted).length,
      assessor: db.users.filter((u) => u.role === 'assessor' && !u.deleted).length,
      user: db.users.filter((u) => u.role === 'user' && !u.deleted).length,
    },
    roles: ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] })),
  });
});

router.patch('/users/:id', requirePermission('users'), (req, res) => {
  const user = findUserById(req.params.id);
  if (!user || user.deleted) return res.status(404).json({ error: '用户不存在' });
  const { status, role, nickname, banReason } = req.body || {};

  if (status && !['active', 'banned'].includes(status)) return res.status(400).json({ error: '用户状态不合法' });
  if (role && !ROLES.includes(role)) return res.status(400).json({ error: '用户角色不合法' });

  if (user.id === req.user.id && (status === 'banned' || (role && role !== 'admin'))) {
    return res.status(400).json({ error: '不能封禁自己或撤销自己的管理员权限' });
  }
  if (status === 'banned' && user.role !== 'user') {
    return res.status(400).json({ error: '请先将该用户降级为普通用户，再执行封禁' });
  }
  if (role && role !== 'user' && user.id === req.user.id) {
    return res.status(400).json({ error: '不能修改自己的角色' });
  }

  const changes = [];
  if (status && status !== user.status) {
    user.status = status;
    if (status === 'banned') {
      user.banReason = String(banReason || '违反平台规则').slice(0, 120);
      db.sessions = db.sessions.filter((s) => s.userId !== user.id);
      notifyUser(user.id, {
        category: 'system',
        level: 'danger',
        title: '账号已被封禁',
        content: `你的账号因「${user.banReason}」被封禁，如有疑问请加入交流群联系管理员。`,
      });
    }
    changes.push(`状态 → ${status}`);
  }
  if (role && role !== user.role) {
    const from = ROLE_LABELS[user.role];
    user.role = role;
    changes.push(`权限组 ${from} → ${ROLE_LABELS[role]}`);
    notifyUser(user.id, {
      category: 'system',
      level: 'info',
      title: '账号权限组已调整',
      content: `你的账号权限组已由「${from}」调整为「${ROLE_LABELS[role]}」。${role === 'user' ? '如对调整有疑问，请联系管理员。' : '现在可以进入管理后台执行对应操作。'}`,
      link: role === 'user' ? null : '/admin',
    });
  }
  if (nickname) user.nickname = String(nickname).trim().slice(0, 16);
  save();
  eventLog(req, '更新用户信息', `${user.email} · ${changes.join(' / ') || '昵称更新'}`);
  res.json({ user: publicUser(user) });
});

/** 批量设置权限组 */
router.post('/users/roles', requirePermission('users'), (req, res) => {
  const { ids = [], role } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: '请选择用户' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: '角色不合法' });
  let done = 0;
  let skipped = 0;
  for (const id of ids) {
    const user = findUserById(id);
    if (!user || user.deleted || user.id === req.user.id) {
      skipped += 1;
      continue;
    }
    if (user.role === role) {
      skipped += 1;
      continue;
    }
    const from = ROLE_LABELS[user.role];
    user.role = role;
    notifyUser(user.id, {
      category: 'system',
      level: 'info',
      title: '账号权限组已调整',
      content: `你的账号权限组已由「${from}」调整为「${ROLE_LABELS[role]}」。`,
    });
    done += 1;
  }
  save();
  eventLog(req, '批量调整权限组', `${done} 位用户 → ${ROLE_LABELS[role]}`);
  res.json({ ok: true, done, skipped });
});

/** 管理员代改指定用户的社交平台绑定（不受每月 3 次限制，但会记录并通知用户） */
router.put('/users/:id/bindings', requirePermission('users'), (req, res) => {
  const user = findUserById(req.params.id);
  if (!user || user.deleted) return res.status(404).json({ error: '用户不存在' });

  const { platform, handle } = req.body || {};
  const conf = PLATFORM_RULES[platform];
  if (!conf) return res.status(400).json({ error: '暂不支持该平台' });

  const value = String(handle || '').trim();
  user.bindings = user.bindings || {};

  // 空值 = 解绑
  if (!value) {
    if (!user.bindings[platform]) return res.status(400).json({ error: `该用户尚未绑定${conf.label}` });
    const old = user.bindings[platform].handle;
    delete user.bindings[platform];
    save();
    eventLog(req, `代改${conf.label}绑定`, `${user.email || user.username}：解绑 ${old}`);
    notifyUser(user.id, {
      category: 'system',
      level: 'warning',
      title: `你的${conf.label}绑定已被管理员解除`,
      content: `管理员解除了你账号上的${conf.label}绑定（原账号：${old}）。如有疑问请加入交流群联系管理员。`,
      link: '/me?tab=bindings',
    });
    return res.json({ user: publicUser(user) });
  }

  if (!conf.pattern.test(value)) return res.status(400).json({ error: conf.hint });

  const taken = db.users.find(
    (u) => !u.deleted && u.id !== user.id && u.bindings?.[platform]?.handle?.toLowerCase() === value.toLowerCase(),
  );
  if (taken) return res.status(409).json({ error: `该${conf.label}账号已被其他用户（${taken.nickname}）绑定` });

  const old = user.bindings[platform]?.handle || '';
  if (old && old.toLowerCase() === value.toLowerCase()) {
    return res.status(400).json({ error: `该用户当前已绑定此${conf.label}账号` });
  }

  user.bindings[platform] = {
    handle: value,
    boundAt: user.bindings[platform]?.boundAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    verified: true,
    updatedBy: req.user.nickname,
  };
  save();

  eventLog(req, `代改${conf.label}绑定`, `${user.email || user.username}：${old || '未绑定'} → ${value}`);
  notifyUser(user.id, {
    category: 'system',
    level: 'info',
    title: `你的${conf.label}绑定已被管理员修改`,
    content: `管理员将你的${conf.label}绑定由「${old || '未绑定'}」修改为「${value}」。如有疑问请加入交流群联系管理员。`,
    link: '/me?tab=bindings',
  });
  res.json({ user: publicUser(user) });
});

/** 管理员重置用户本月的绑定修改次数 */
router.post('/users/:id/bindings/reset-quota', requirePermission('users'), (req, res) => {
  const user = findUserById(req.params.id);
  if (!user || user.deleted) return res.status(404).json({ error: '用户不存在' });
  user.bindingChanges = { month: '', count: 0 };
  save();
  eventLog(req, '重置绑定修改次数', user.email || user.username);
  notifyUser(user.id, {
    category: 'system',
    level: 'info',
    title: '绑定修改次数已重置',
    content: '管理员已重置你本月的社交账号绑定修改次数，现在可以继续修改绑定信息。',
    link: '/me?tab=bindings',
  });
  res.json({ user: publicUser(user) });
});

router.delete('/users/:id', requirePermission('users'), (req, res) => {
  const user = findUserById(req.params.id);
  if (!user || user.deleted) return res.status(404).json({ error: '用户不存在' });
  if (user.id === req.user.id) return res.status(400).json({ error: '不能删除自己的账号' });
  if (user.role !== 'user') return res.status(400).json({ error: '请先将该用户降级为普通用户' });

  user.deleted = true;
  user.status = 'banned';
  user.email = `deleted+${user.id}@qq.com`;
  db.sessions = db.sessions.filter((s) => s.userId !== user.id);
  db.names.filter((n) => n.ownerId === user.id).forEach((n) => {
    n.status = 'hidden';
  });
  save();
  eventLog(req, '删除用户', user.id);
  res.json({ ok: true });
});

/* ============ 圈名管理 ============ */
router.get('/names', requirePermission('names'), (req, res) => {
  const { q = '', status = 'all', page = 1, pageSize = 10 } = req.query;
  const keyword = String(q).trim().toLowerCase();
  let list = [...db.names];
  if (status !== 'all') list = list.filter((n) => n.status === status);
  if (keyword) list = list.filter((n) => n.name.toLowerCase().includes(keyword));
  list.sort((a, b) => new Date(b.approvedAt || b.createdAt) - new Date(a.approvedAt || a.createdAt));
  const result = paginate(list, page, pageSize);
  res.json({
    ...result,
    items: result.items.map((n) => ({
      ...shapeName(n),
      ownerEmail: db.users.find((u) => u.id === n.ownerId)?.email || '—',
      transferCount: n.transferCount || 0,
    })),
  });
});

router.patch('/names/:id', requirePermission('names'), (req, res) => {
  const name = db.names.find((n) => n.id === req.params.id);
  if (!name) return res.status(404).json({ error: '圈名不存在' });
  const { status, description, ownerId } = req.body || {};
  if (status && !['active', 'hidden'].includes(status)) return res.status(400).json({ error: '状态不合法' });
  if (status) name.status = status;
  if (typeof description === 'string') name.description = sanitizeText(description, 300);
  if (ownerId && ownerId !== name.ownerId) {
    const target = findUserById(ownerId);
    if (!target || target.deleted) return res.status(400).json({ error: '目标用户不存在' });
    if (target.status === 'banned') return res.status(400).json({ error: '目标用户已被封禁，无法接收圈名' });
    const prev = findUserById(name.ownerId);
    name.ownerId = ownerId;
    name.history = name.history || [];
    name.history.push({
      at: new Date().toISOString(),
      action: 'transfer',
      note: `管理员手动转移归属：${prev?.nickname || '—'} → ${target.nickname}`,
      by: req.user.nickname,
    });
    notifyUser(target.id, {
      category: 'system',
      level: 'info',
      title: `圈名「${name.name}」已划归你的账号`,
      content: `管理员将该圈名的归属划归到你的账号，现在可在个人中心查看。`,
      link: `/names/${name.id}`,
    });
    if (prev) {
      notifyUser(prev.id, {
        category: 'system',
        level: 'warning',
        title: `圈名「${name.name}」的归属已被划出`,
        content: `管理员将该圈名的归属从你的账号划出，如有疑问请加入交流群联系管理员。`,
        link: `/names/${name.id}`,
      });
    }
  }
  save();
  eventLog(req, status === 'hidden' ? '下架圈名' : '更新圈名信息', name.name);
  res.json({ name: shapeName(name) });
});

router.delete('/names/:id', requirePermission('names'), (req, res) => {
  const name = db.names.find((n) => n.id === req.params.id);
  if (!name) return res.status(404).json({ error: '圈名不存在' });
  db.names = db.names.filter((n) => n.id !== name.id);
  deleteName(name.id);
  save();
  eventLog(req, '删除圈名', name.name);
  res.json({ ok: true });
});

/* ============ 访问日志 ============ */
router.get('/logs', requirePermission('logs'), (req, res) => {
  const { q = '', level = 'all', page = 1, pageSize = 20 } = req.query;
  const keyword = String(q).trim().toLowerCase();
  let list = [...db.logs];
  if (level === 'error') list = list.filter((l) => l.status >= 400 || l.level === 'error');
  if (level === 'auth') list = list.filter((l) => /登录|注册|验证码|退出/.test(l.action));
  if (level === 'review') list = list.filter((l) => /审核|驳回|通过|申诉|圈名/.test(l.action));
  if (level === 'security') list = list.filter((l) => /限制|拉黑|封禁|频繁/.test(l.action) || l.code === 'RATE_LIMITED');
  if (keyword) {
    list = list.filter(
      (l) =>
        (l.path || '').toLowerCase().includes(keyword) ||
        (l.email || '').toLowerCase().includes(keyword) ||
        (l.ip || '').includes(keyword) ||
        (l.action || '').toLowerCase().includes(keyword),
    );
  }
  const result = paginate(list, page, pageSize);
  res.json({
    ...result,
    counts: {
      all: db.logs.length,
      error: db.logs.filter((l) => l.status >= 400 || l.level === 'error').length,
      auth: db.logs.filter((l) => /登录|注册|验证码|退出/.test(l.action)).length,
      review: db.logs.filter((l) => /审核|驳回|通过|申诉|圈名/.test(l.action)).length,
      security: db.logs.filter((l) => /限制|拉黑|封禁|频繁/.test(l.action)).length,
    },
  });
});

export default router;
