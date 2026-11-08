import express from 'express';
import { db, save, publicUser, findUserById, maskEmail, ROLES, ROLE_LABELS } from '../lib/db.js';
import { requirePermission } from '../lib/auth.js';
import { paginate, sanitizeText } from '../lib/util.js';
import { shapeName } from './names.js';
import { eventLog } from '../lib/logger.js';
import { notifyUser } from '../lib/notify.js';
import { shapeAvatarRequest, removeAvatarFile } from '../lib/avatar.js';
import { updateUser } from '../lib/repo-user.js';
import { lookupIp } from '../lib/ip-geo.js';
import { resolveIp } from '../lib/ip-geo-remote.js';
import { isPermanentlyBlocked, activeTempBlock } from '../lib/guard.js';
import { hashPassword } from '../lib/password.js';
import crypto from 'node:crypto';
import { deleteName } from '../lib/repo.js';

const router = express.Router();

/* ================= 角色等级与提权防护 ================= */
/** 角色等级：数字越大权限越高 */
const ROLE_RANK = { user: 0, assessor: 1, superadmin: 2, admin: 3 };

/**
 * 判断操作者能否把目标用户设为某个角色
 *
 * 规则（防止「审核员 → 提升自己人 → 拿到 admin」的提权链）：
 * - 只有真正的 admin 才能授予 admin
 * - 不能授予高于自己等级的角色
 * - 不能修改等级高于或等于自己的用户（除非自己是 admin 且目标是普通用户）
 */
function canAssignRole(operator, target, nextRole) {
  const me = ROLE_RANK[operator.role] ?? -1;
  const targetRank = ROLE_RANK[target.role] ?? -1;
  const next = ROLE_RANK[nextRole] ?? -1;

  // 仅 admin 可授予 admin
  if (next >= ROLE_RANK.admin && operator.role !== 'admin') {
    return { ok: false, error: '只有管理员可以授予管理员权限' };
  }
  // 不能授予超过自身等级的角色
  if (next > me) {
    return { ok: false, error: '不能授予高于自己权限等级的角色' };
  }
  // 不能操作等级不低于自己的账号（admin 可管理除自己外所有人）
  if (operator.role !== 'admin' && targetRank >= me) {
    return { ok: false, error: '无权修改同级或更高权限的账号' };
  }
  return { ok: true };
}


/** 生成 12 位强随机密码（大小写+数字+符号） */
function randomPassword(len = 12) {
  const U = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const L = 'abcdefghijkmnopqrstuvwxyz';
  const D = '23456789';
  const S = '!@#$%^&*';
  const all = U + L + D + S;
  const pick = (c) => c[crypto.randomInt(0, c.length)];
  const chars = [pick(U), pick(L), pick(D), pick(S)];
  while (chars.length < len) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

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
      // 超级管理员数量：此前遗漏该字段，导致前端「超级管理员」始终显示 0
      superadmin: db.users.filter((u) => u.role === 'superadmin' && !u.deleted).length,
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
  // 提权防护：非 admin 封禁他人时同样受等级约束
  if (status === 'banned' && req.user.role !== 'admin' && ROLE_RANK[user.role] >= (ROLE_RANK[req.user.role] ?? -1)) {
    return res.status(403).json({ error: '无权封禁同级或更高权限的账号' });
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
    const check = canAssignRole(req.user, user, role);
    if (!check.ok) return res.status(403).json({ error: check.error });
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
  // 批量操作同样受等级约束，避免绕过单用户接口的限制
  const batchCheck = canAssignRole(req.user, { role: 'user' }, role);
  if (!batchCheck.ok) return res.status(403).json({ error: batchCheck.error });

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
    if (!canAssignRole(req.user, user, role).ok) {
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

/** 设置用户的小法庭投票权限（封禁/开启） */
router.patch('/users/:id/court-permission', requirePermission('users'), (req, res) => {
  const user = findUserById(req.params.id);
  if (!user || user.deleted) return res.status(404).json({ error: '用户不存在' });
  if (user.role !== 'user') {
    return res.status(400).json({ error: '仅可对普通用户设置小法庭投票权限' });
  }

  const allow = Boolean(req.body?.allow);
  user.courtPermission = allow;
  save('users');

  notifyUser(user.id, {
    category: 'system',
    level: allow ? 'success' : 'warning',
    title: allow ? '小法庭投票权限已恢复' : '小法庭投票权限已被收回',
    content: allow
      ? '管理员已恢复你的小法庭投票权限，你可以继续参与投票。'
      : '管理员已收回你的小法庭投票权限，你将无法在小法庭投票。如有疑问请联系管理员。',
    link: '/court',
  });

  eventLog(req, allow ? '恢复小法庭投票权限' : '收回小法庭投票权限', user.username || user.email);
  res.json({ ok: true, courtPermission: allow });
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

/* ============ 头像审核 ============ */
router.get('/avatars', requirePermission('users'), (req, res) => {
  const { status = 'pending', q = '', page = 1, pageSize = 10 } = req.query;
  const keyword = String(q).trim().toLowerCase();
  let list = [...db.avatarRequests];
  if (status !== 'all') list = list.filter((a) => a.status === status);
  if (keyword) {
    list = list.filter((a) => {
      const u = findUserById(a.userId);
      return (
        (u?.username || '').toLowerCase().includes(keyword) ||
        (u?.nickname || '').toLowerCase().includes(keyword) ||
        (u?.email || '').toLowerCase().includes(keyword)
      );
    });
  }
  const order = { pending: 0, approved: 1, rejected: 2 };
  list.sort((a, b) => (order[a.status] - order[b.status]) || (new Date(b.createdAt) - new Date(a.createdAt)));

  const result = paginate(list, page, pageSize);
  res.json({
    ...result,
    items: result.items.map((a) => {
      const item = shapeAvatarRequest(a, findUserById(a.userId));
      // 圈名图片：附带圈名名称，便于审核时识别审核对象
      if (item.targetType === 'name' && item.targetId) {
        const n = db.names.find((x) => x.id === item.targetId);
        item.targetName = n?.name || '';
      }
      return item;
    }),
    counts: {
      all: db.avatarRequests.length,
      pending: db.avatarRequests.filter((a) => a.status === 'pending').length,
      approved: db.avatarRequests.filter((a) => a.status === 'approved').length,
      rejected: db.avatarRequests.filter((a) => a.status === 'rejected').length,
    },
  });
});

router.post('/avatars/:id/approve', requirePermission('users'), (req, res) => {
  const record = db.avatarRequests.find((a) => a.id === req.params.id);
  if (!record) return res.status(404).json({ error: '申请不存在' });
  if (record.status !== 'pending') return res.status(400).json({ error: '该申请已处理' });

  const u = findUserById(record.userId);
  if (!u) return res.status(404).json({ error: '申请用户不存在' });

  // 根据目标类型决定写回用户头像还是圈名图片
  const isNameImage = record.targetType === 'name' && record.targetId;
  let oldUrl = '';
  if (isNameImage) {
    const target = db.names.find((n) => n.id === record.targetId);
    if (!target) return res.status(404).json({ error: '目标圈名不存在' });
    oldUrl = target.imageUrl || '';
    target.imageUrl = record.imageUrl;
    target.imageSha256 = record.imageSha256;
    save('names');
  } else {
    oldUrl = u.avatarUrl;
    updateUser(u.id, { avatarUrl: record.imageUrl, avatarSha256: record.imageSha256 });
  }

  record.status = 'approved';
  record.reviewedBy = req.user.id;
  record.reviewedAt = new Date().toISOString();
  save('avatar_requests');

  // 旧头像不在被任何申请引用时删除，避免磁盘堆积
  if (oldUrl && !db.avatarRequests.some((a) => a.imageUrl === oldUrl)) removeAvatarFile(oldUrl);

  const targetName = isNameImage ? db.names.find((n) => n.id === record.targetId) : null;
  notifyUser(u.id, {
    category: 'system',
    level: 'success',
    title: isNameImage ? `圈名「${targetName?.name || ''}」图片已通过审核` : '头像修改申请已通过',
    content: isNameImage
      ? '你提交的圈名图片已通过审核并生效，可在圈名详情页查看。'
      : '你提交的头像已通过审核并生效，可在个人中心查看。',
    link: isNameImage ? `/names/${record.targetId}` : '/me',
  });
  eventLog(req, isNameImage ? '通过圈名图片' : '通过头像申请', isNameImage ? targetName?.name || '' : `${u.username}`);
  res.json({ ok: true, avatarUrl: record.imageUrl });
});

router.post('/avatars/:id/reject', requirePermission('users'), (req, res) => {
  const record = db.avatarRequests.find((a) => a.id === req.params.id);
  if (!record) return res.status(404).json({ error: '申请不存在' });
  if (record.status !== 'pending') return res.status(400).json({ error: '该申请已处理' });

  const reason = sanitizeText(req.body?.reason, 200);
  if (!reason || reason.length < 2) return res.status(400).json({ error: '请填写驳回理由（至少 2 个字）' });

  record.status = 'rejected';
  record.rejectReason = reason;
  record.reviewedBy = req.user.id;
  record.reviewedAt = new Date().toISOString();
  save('avatar_requests');

  const u = findUserById(record.userId);
  if (u) {
    const isNameImg = record.targetType === 'name' && record.targetId;
    const tName = isNameImg ? db.names.find((n) => n.id === record.targetId) : null;
    notifyUser(u.id, {
      category: 'system',
      level: 'warning',
      title: isNameImg ? `圈名「${tName?.name || ''}」图片被驳回` : '头像修改申请被驳回',
      content: `驳回理由：${reason}`,
      link: isNameImg ? `/names/${record.targetId}` : '/me',
    });
    eventLog(req, '驳回头像申请', `${u.username} · ${reason.slice(0, 30)}`);
  }
  res.json({ ok: true });
});

/* ============ 重置用户密码 ============ */
router.post('/users/:id/reset-password', requirePermission('users'), (req, res) => {
  const u = findUserById(req.params.id);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  if (u.id === req.user.id) return res.status(400).json({ error: '不能在此重置自己的密码，请到个人中心修改' });

  // 提权防护：重置密码等于接管账号，必须严格限制
  // - 非 admin 不能重置任何管理员/超管密码
  // - 非 admin 只能重置比自己等级低的账号
  if (req.user.role !== 'admin') {
    if (ROLE_RANK[u.role] >= ROLE_RANK.superadmin) {
      return res.status(403).json({ error: '无权重置管理员或超级管理员的密码' });
    }
    if (ROLE_RANK[u.role] >= (ROLE_RANK[req.user.role] ?? -1)) {
      return res.status(403).json({ error: '无权重置同级或更高权限账号的密码' });
    }
  }

  const mode = String(req.body?.mode || 'random');
  let plain;
  if (mode === 'manual') {
    plain = String(req.body?.password || '');
    const err = validatePassword(plain);
    if (err) return res.status(400).json({ error: err });
  } else {
    plain = randomPassword();
  }

  updateUser(u.id, { passwordHash: hashPassword(plain) });
  // 失效该用户全部会话，强制重新登录
  db.sessions = db.sessions.filter((s) => s.userId !== u.id);
  save('sessions');

  notifyUser(u.id, {
    category: 'system',
    level: 'warning',
    title: '登录密码已被管理员重置',
    content: '你的账号密码已由管理员重置，请使用新密码登录，并尽快在个人中心自行修改。',
    link: '/login',
  });
  eventLog(req, '重置用户密码', u.username);

  // 明文仅在本次响应返回一次，不入库、不进日志
  res.json({ ok: true, password: plain, username: u.username });
});

/* ============ 自定义头衔 ============ */
router.post('/users/:id/title', requirePermission('users'), (req, res) => {
  const u = findUserById(req.params.id);
  if (!u) return res.status(404).json({ error: '用户不存在' });

  const raw = req.body?.title;
  const title = raw === null || raw === '' ? '' : sanitizeText(raw, 20);
  if (title && [...title].length > 20) return res.status(400).json({ error: '头衔最多 20 个字符' });

  updateUser(u.id, { title });
  notifyUser(u.id, {
    category: 'system',
    level: 'info',
    title: title ? '你获得了新的头衔' : '你的头衔已被移除',
    content: title ? `管理员为你设置了头衔「${title}」，将展示在个人中心与圈名详情页。` : '管理员移除了你的自定义头衔。',
    link: '/me',
  });
  eventLog(req, title ? '设置用户头衔' : '清除用户头衔', `${u.username} · ${title || '（空）'}`);
  res.json({ ok: true, title });
});

router.delete('/users/:id', requirePermission('users'), (req, res) => {
  const user = findUserById(req.params.id);
  if (!user || user.deleted) return res.status(404).json({ error: '用户不存在' });

  // 提权防护：非 admin 不能删除同级或更高权限账号
  if (req.user.role !== 'admin' && ROLE_RANK[user.role] >= (ROLE_RANK[req.user.role] ?? -1)) {
    return res.status(403).json({ error: '无权删除同级或更高权限的账号' });
  }
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
/**
 * 访问日志列表
 *
 * 注意：查询日志本身也会产生访问日志。若把这类记录计入统计，
 * 每次翻页/查看详情都会让「全部记录」「异常请求」等数字变化，
 * 造成「点击其他记录时数量减少」的错觉。
 * 因此统计与列表都排除日志面板自身产生的请求。
 */
const SELF_PATHS = [
  /^\/api\/admin\/logs(?:\/|\?|$)/,
  /^\/api\/admin\/stats(?:\?|$)/,
  /^\/api\/admin\/security(?:\?|$)/,
  /^\/api\/admin\/ip\//,
  /^\/api\/notifications\/unread-count(?:\?|$)/,
];
const isSelfRequest = (l) => SELF_PATHS.some((re) => re.test(l.path || ''));

router.get('/logs', requirePermission('logs'), (req, res) => {
  const { q = '', level = 'all', page = 1, pageSize = 20 } = req.query;
  const keyword = String(q).trim().toLowerCase();

  // 统计基准：排除后台自身轮询/查询产生的噪声
  const base = db.logs.filter((l) => !isSelfRequest(l));

  let list = [...base];
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

  // 列表内附带归属地与封禁状态，便于快速筛查
  const decorate = (l) => {
    const geo = lookupIp(l.ip);
    const perm = isPermanentlyBlocked(l.ip);
    const temp = activeTempBlock(l.ip);
    return {
      ...l,
      geo: geo.region,
      geoKind: geo.kind,
      isPrivate: geo.isPrivate,
      blocked: Boolean(perm),
      tempBlocked: Boolean(temp),
      tempUntil: temp?.until || null,
    };
  };

  res.json({
    ...result,
    items: result.items.map(decorate),
    counts: {
      all: base.length,
      error: base.filter((l) => l.status >= 400 || l.level === 'error').length,
      auth: base.filter((l) => /登录|注册|验证码|退出/.test(l.action)).length,
      review: base.filter((l) => /审核|驳回|通过|申诉|圈名/.test(l.action)).length,
      security: base.filter((l) => /限制|拉黑|封禁|频繁/.test(l.action)).length,
    },
  });
});

/* ---------------- 访问日志详情 ---------------- */
router.get('/logs/:id', requirePermission('logs'), async (req, res, next) => {
  // 路由冲突防护：/logs/integrity 是独立端点，不能被 :id 抢先匹配
  if (req.params.id === 'integrity') return next();

  const log = db.logs.find((l) => l.id === req.params.id);
  if (!log) return res.status(404).json({ error: '日志不存在或已过期' });

  // 完整地址解析：本地库优先，必要时调用外部 API（带缓存与限流）
  const geo = await resolveIp(log.ip);
  const perm = isPermanentlyBlocked(log.ip);
  const temp = activeTempBlock(log.ip);

  // 同一 IP 的近期行为（最多 20 条），用于判断是否为攻击源
  const sameIp = db.logs.filter((l) => l.ip === log.ip).slice(0, 20).map((l) => ({
    id: l.id,
    ts: l.ts,
    method: l.method,
    path: l.path,
    status: l.status,
    ms: l.ms,
    action: l.action,
  }));

  const sameIpStats = (() => {
    const all = db.logs.filter((l) => l.ip === log.ip && !isSelfRequest(l));
    const last1h = all.filter((l) => Date.now() - l.ts < 3600_000);
    return {
      total: all.length,
      last1h: last1h.length,
      errors: all.filter((l) => l.status >= 400).length,
      rateLimited: all.filter((l) => l.status === 429).length,
      firstSeen: all.length ? all[all.length - 1].ts : null,
      lastSeen: all.length ? all[0].ts : null,
    };
  })();

  res.json({
    log: {
      ...log,
      geo: geo.region,
      geoKind: geo.kind,
      isPrivate: geo.isPrivate,
      isIpv6: geo.isIpv6,
    },
    ip: {
      ...geo,
      blocked: Boolean(perm),
      blockReason: perm?.reason || '',
      blockedAt: perm?.createdAt || null,
      tempBlocked: Boolean(temp),
      tempUntil: temp?.until || null,
      tempReason: temp?.reason || '',
    },
    sameIp,
    sameIpStats,
  });
});

/* ---------------- 统计某 IP 的概况（风控页用） ---------------- */
router.get('/ip/:ip/profile', requirePermission('logs'), async (req, res) => {
  const ip = String(req.params.ip || '').trim();
  if (!ip) return res.status(400).json({ error: '缺少 IP 参数' });

  const geo = await resolveIp(ip);
  const perm = isPermanentlyBlocked(ip);
  const temp = activeTempBlock(ip);

  const logs = db.logs.filter((l) => l.ip === ip && !isSelfRequest(l));
  const recent = logs.slice(0, 30).map((l) => ({
    id: l.id, ts: l.ts, method: l.method, path: l.path, status: l.status, ms: l.ms, action: l.action,
  }));

  const users = [...new Set(logs.map((l) => l.email).filter(Boolean))].slice(0, 10);

  res.json({
    ip: {
      ...geo,
      blocked: Boolean(perm),
      blockReason: perm?.reason || '',
      blockedAt: perm?.createdAt || null,
      tempBlocked: Boolean(temp),
      tempUntil: temp?.until || null,
      tempReason: temp?.reason || '',
    },
    stats: {
      total: logs.length,
      last1h: logs.filter((l) => Date.now() - l.ts < 3600_000).length,
      errors: logs.filter((l) => l.status >= 400).length,
      rateLimited: logs.filter((l) => l.status === 429).length,
      firstSeen: logs.length ? logs[logs.length - 1].ts : null,
      lastSeen: logs.length ? logs[0].ts : null,
    },
    recent,
    users,
  });
});


/* ================= 会话管理（基于 sessionId） ================= */

/** 列出所有活跃会话 */
router.get('/sessions', requirePermission('users'), (req, res) => {
  const now = Date.now();
  const list = db.sessions
    .filter((s) => s.expiresAt > now)
    .map((s) => {
      const u = findUserById(s.userId);
      return {
        sessionId: s.sessionId || '—',
        userId: s.userId,
        username: u?.username || '—',
        nickname: u?.nickname || '—',
        role: s.role || u?.role || 'user',
        ip: s.ip || '',
        ua: s.ua || '',
        createdAt: s.createdAt,
        lastActiveAt: s.lastActiveAt || s.createdAt,
        expiresAt: s.expiresAt,
        // 是否为本请求所在会话
        current: s.sessionId === req.sessionId,
      };
    })
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt);

  res.json({
    items: list,
    counts: {
      total: list.length,
      admin: list.filter((s) => s.role === 'admin').length,
      superadmin: list.filter((s) => s.role === 'superadmin').length,
      assessor: list.filter((s) => s.role === 'assessor').length,
      user: list.filter((s) => s.role === 'user').length,
    },
  });
});

/** 踢出指定会话（按 sessionId） */
router.post('/sessions/:sessionId/kick', requirePermission('users'), (req, res) => {
  const target = db.sessions.find((s) => s.sessionId === req.params.sessionId);
  if (!target) return res.status(404).json({ error: '会话不存在或已失效' });

  // 防越权：非 admin 不能踢出同级或更高权限的会话
  if (req.user.role !== 'admin') {
    const targetUser = findUserById(target.userId);
    const rank = { user: 0, assessor: 1, superadmin: 2, admin: 3 };
    if ((rank[targetUser?.role] ?? 9) >= (rank[req.user.role] ?? 0)) {
      return res.status(403).json({ error: '无权限踢出同级或更高权限的会话' });
    }
  }

  target.expiredReason = 'kicked';
  db.sessions = db.sessions.filter((s) => s.sessionId !== req.params.sessionId);
  save('sessions');

  eventLog(req, '踢出会话', `${req.params.sessionId} · ${findUserById(target.userId)?.username || '-'}`);
  res.json({ ok: true });
});

/** 踢出某用户的全部会话 */
router.post('/sessions/user/:userId/kick', requirePermission('users'), (req, res) => {
  const u = findUserById(req.params.userId);
  if (!u) return res.status(404).json({ error: '用户不存在' });

  if (req.user.role !== 'admin') {
    const rank = { user: 0, assessor: 1, superadmin: 2, admin: 3 };
    if ((rank[u.role] ?? 9) >= (rank[req.user.role] ?? 0)) {
      return res.status(403).json({ error: '无权限踢出同级或更高权限账号的会话' });
    }
  }

  const before = db.sessions.length;
  db.sessions = db.sessions.filter((s) => s.userId !== u.id);
  const removed = before - db.sessions.length;
  save('sessions');

  notifyUser(u.id, {
    category: 'system',
    level: 'warning',
    title: '你的登录状态已被管理员下线',
    content: '你的所有登录会话已被管理员终止，请重新登录。',
    link: '/login',
  });
  eventLog(req, '踢出用户全部会话', `${u.username} · ${removed} 个`);
  res.json({ ok: true, removed });
});

export default router;
