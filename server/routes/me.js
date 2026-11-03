import express from 'express';
import { get, all } from '../lib/db-sqlite.js';
import { db, save } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { validatePassword, sanitizeText, normalizePhone } from '../lib/util.js';
import { hashPassword, verifyPassword, isSha256Hex } from '../lib/password.js';
import { eventLog } from '../lib/logger.js';
import { unreadCount } from '../lib/notify.js';
import {
  findUserById,
  shapeUser,
  updateUser,
  consumeBindQuota,
  userStats,
} from '../lib/repo-user.js';

const router = express.Router();
router.use(requireAuth);

const PLATFORMS = {
  qq: { label: 'QQ', hint: '由管理员核对账号信息后手动绑定' },
  wechat: { label: '微信', hint: '由管理员核对账号信息后手动绑定' },
  xiaohongshu: { label: '小红书', hint: '由管理员核对账号信息后手动绑定' },
};

/** 个人中心数据 */
router.get('/profile', (req, res) => {
  const u = findUserById(req.user.id);
  const user = shapeUser(u);
  const uid = u.id;

  const names = all(
    `SELECT n.*, u.nickname owner_nickname, u.avatar_hue owner_hue FROM names n
     LEFT JOIN users u ON u.id = n.owner_id
     WHERE n.owner_id = ? AND n.status = 'active' ORDER BY n.approved_at DESC`,
    uid,
  ).map((n) => ({
    id: n.id,
    name: n.name,
    description: n.description,
    tags: JSON.parse(n.tags || '[]'),
    views: n.views,
    createdAt: n.created_at,
    approvedAt: n.approved_at,
    owner: { id: n.owner_id, nickname: n.owner_nickname, avatarHue: n.owner_hue },
  }));

  const claims = all('SELECT * FROM claims WHERE user_id = ? ORDER BY created_at DESC', uid).map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    // 图片统一取自主数据层，避免读取不存在的 attachments 表导致接口报错
    images: db.claims.find((x) => x.id === c.id)?.images || [],
    status: c.status,
    rejectReason: c.reject_reason,
    reviewedAt: c.reviewed_at,
    reviewer: c.reviewer_name,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    nameId: c.name_id,
    history: JSON.parse(c.history || '[]'),
  }));

  const appeals = all('SELECT * FROM appeals WHERE user_id = ? ORDER BY created_at DESC', uid).map((a) => ({
    id: a.id,
    nameId: a.name_id,
    name: a.name,
    reason: a.reason,
    description: a.description,
    images: db.appeals.find((x) => x.id === a.id)?.images || [],
    status: a.status,
    rejectReason: a.reject_reason,
    createdAt: a.created_at,
    updatedAt: a.updated_at,
    reviewedAt: a.reviewed_at,
    reviewer: a.reviewer_name,
  }));

  res.json({
    user,
    names,
    claims,
    appeals,
    unread: unreadCount(uid),
    stats: userStats(uid),
    binding: { usage: user.bindingUsage, limit: 3 },
    platforms: Object.fromEntries(
      Object.entries(PLATFORMS).map(([k, v]) => [k, { label: v.label, hint: v.hint }]),
    ),
  });
});

/** 更新资料 */
router.patch('/profile', (req, res) => {
  const { nickname, bio, avatarHue } = req.body || {};
  const patch = {};
  if (nickname !== undefined) {
    const v = sanitizeText(nickname, 16);
    if ([...v].length < 2) return res.status(400).json({ error: '昵称至少 2 个字符' });
    patch.nickname = v;
  }
  if (bio !== undefined) patch.bio = sanitizeText(bio, 120);
  if (avatarHue !== undefined && Number.isFinite(Number(avatarHue))) {
    patch.avatar_hue = Math.max(0, Math.min(359, Number(avatarHue)));
  }
  const updated = updateUser(req.user.id, patch);
  eventLog(req, '更新个人资料', req.user.email || req.user.username);
  res.json({ user: shapeUser(updated) });
});

/** 账号信息 */
router.get('/accounts', (req, res) => {
  const u = findUserById(req.user.id);
  const user = shapeUser(u);
  res.json({
    username: u.username,
    email: u.email || '',
    phone: u.phone || '',
    phoneMasked: user.phoneMasked,
    bindings: user.bindings,
    usage: user.bindingUsage,
    limit: 3,
    platforms: PLATFORMS,
  });
});

/** 修改手机号（需密码确认） */
router.post('/phone', (req, res) => {
  const { phone, password } = req.body || {};
  const u = findUserById(req.user.id);
  if (!verifyPassword(String(password || ''), u.passwordHash)) {
    return res.status(400).json({ error: '请输入正确的登录密码以确认身份' });
  }
  const target = normalizePhone(phone);
  if (!/^1[3-9]\d{9}$/.test(target)) return res.status(400).json({ error: '请输入有效的手机号' });
  if (target === u.phone) return res.status(400).json({ error: '新手机号与当前手机号相同' });

  const taken = get('SELECT id FROM users WHERE phone = ? AND id != ? AND deleted = 0', target, u.id);
  if (taken) return res.status(409).json({ error: '该手机号已被其他账号使用' });

  updateUser(u.id, { phone: target });
  eventLog(req, '修改手机号', `${u.username} → ${target}`);
  res.json({ user: shapeUser(findUserById(u.id)) });
});

/** 修改密码 */
router.post('/password', (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const u = findUserById(req.user.id);
  if (!verifyPassword(String(currentPassword || ''), u.passwordHash)) {
    return res.status(400).json({ error: '当前密码不正确' });
  }
  const err = isSha256Hex(newPassword) ? null : validatePassword(newPassword);
  if (err) return res.status(400).json({ error: err });

  updateUser(u.id, { passwordHash: hashPassword(newPassword) });
  // 失效其他会话
  const token = req.session?.token;
  if (token) {
    db.sessions = db.sessions.filter((s) => !(s.userId === u.id && s.token !== token));
    save('sessions');
  }
  eventLog(req, '修改登录密码', u.email || u.username);
  res.json({ ok: true, revokedOthers: true });
});

export default router;
