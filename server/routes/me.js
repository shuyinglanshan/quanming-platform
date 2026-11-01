import express from 'express';
import { hashPassword, verifyPassword, isSha256Hex } from '../lib/password.js';
import {
  db,
  save,
  publicUser,
  bindingUsage,
  consumeBindingQuota,
  bindingMonthlyLimit,
} from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { validatePassword } from '../lib/util.js';
import { validateNickname, normalizePhone, sanitizeText } from '../lib/util.js';
import { eventLog } from '../lib/logger.js';
import { shapeName } from './names.js';
import { shapeClaim } from './claims.js';
import { shapeAppeal } from './appeals.js';
import { unreadCount } from '../lib/notify.js';

const router = express.Router();
router.use(requireAuth);

export const PLATFORMS = {
  qq: { label: 'QQ', pattern: /^\d{5,12}$/, hint: '请输入 5-12 位 QQ 号' },
  wechat: { label: '微信', pattern: /^[a-zA-Z][-_a-zA-Z0-9]{5,19}$/, hint: '请输入 6-20 位微信号（字母开头）' },
  xiaohongshu: { label: '小红书', pattern: /^[a-zA-Z0-9_.]{2,24}$/, hint: '请输入小红书号（2-24 位字母、数字、下划线）' },
};

router.get('/profile', (req, res) => {
  const u = req.user;
  const myNames = db.names.filter((n) => n.ownerId === u.id).map(shapeName);
  const myClaims = db.claims.filter((c) => c.userId === u.id).map((c) => shapeClaim(c));
  const myAppeals = db.appeals.filter((a) => a.userId === u.id).map((a) => shapeAppeal(a));
  res.json({
    user: publicUser(u),
    names: myNames,
    claims: myClaims,
    appeals: myAppeals,
    unread: unreadCount(u.id),
    stats: {
      claims: myClaims.length,
      pending: myClaims.filter((c) => c.status === 'pending').length,
      approved: myClaims.filter((c) => c.status === 'approved').length,
      rejected: myClaims.filter((c) => c.status === 'rejected').length,
      names: myNames.length,
      appeals: myAppeals.length,
      appealsPending: myAppeals.filter((a) => a.status === 'pending').length,
    },
    binding: {
      usage: bindingUsage(u),
      limit: bindingMonthlyLimit(),
    },
    platforms: Object.fromEntries(Object.entries(PLATFORMS).map(([k, v]) => [k, { label: v.label, hint: v.hint }])),
  });
});

router.patch('/profile', (req, res) => {
  const { nickname, bio, avatarHue } = req.body || {};
  if (nickname !== undefined) {
    const err = validateNickname(nickname);
    if (err) return res.status(400).json({ error: err });
    req.user.nickname = sanitizeText(nickname, 16);
  }
  if (bio !== undefined) req.user.bio = sanitizeText(bio, 120);
  if (avatarHue !== undefined && Number.isFinite(Number(avatarHue))) {
    req.user.avatarHue = Math.max(0, Math.min(359, Number(avatarHue)));
  }
  save();
  eventLog(req, '更新个人资料', req.user.email || req.user.username);
  res.json({ user: publicUser(req.user) });
});

/* ---------------- 账号信息（手机号 / QQ / 微信 / 小红书） ---------------- */
router.get('/accounts', (req, res) => {
  const u = req.user;
  res.json({
    username: u.username || '',
    email: u.email || '',
    phone: u.phone || '',
    phoneMasked: u.phone ? `${u.phone.slice(0, 3)}****${u.phone.slice(7)}` : '',
    bindings: u.bindings || {},
    usage: bindingUsage(u),
    limit: bindingMonthlyLimit(),
    platforms: Object.fromEntries(Object.entries(PLATFORMS).map(([k, v]) => [k, { label: v.label, hint: v.hint }])),
  });
});

/** 绑定 / 修改绑定（每月限 3 次） */
router.post('/bindings/:platform', (req, res) => {
  const platform = req.params.platform;
  const conf = PLATFORMS[platform];
  if (!conf) return res.status(400).json({ error: '暂不支持该平台' });

  const handle = sanitizeText(req.body?.handle, 64);
  if (!handle) return res.status(400).json({ error: `请输入${conf.label}账号` });
  if (!conf.pattern.test(handle)) return res.status(400).json({ error: conf.hint });

  const current = req.user.bindings?.[platform]?.handle || '';
  if (current && current.toLowerCase() === handle.toLowerCase()) {
    return res.status(400).json({ error: `该${conf.label}账号已是当前绑定，无需修改` });
  }

  const taken = db.users.find(
    (u) => u.id !== req.user.id && !u.deleted && u.bindings?.[platform]?.handle?.toLowerCase() === handle.toLowerCase(),
  );
  if (taken) return res.status(409).json({ error: `该${conf.label}账号已被其他用户绑定` });

  // 每月修改次数限制（首次绑定不占用额度）
  const isFirstBind = !current;
  const quota = consumeBindingQuota(req.user, { skipLimit: isFirstBind });
  if (!quota.ok) {
    return res.status(429).json({ error: quota.error, usage: quota.usage, code: 'BINDING_LIMIT' });
  }

  req.user.bindings = req.user.bindings || {};
  req.user.bindings[platform] = {
    handle,
    boundAt: new Date().toISOString(),
    verified: true,
    updatedAt: new Date().toISOString(),
  };
  save();

  eventLog(req, current ? `修改${conf.label}绑定` : `绑定${conf.label}`, `${req.user.username || req.user.email} → ${handle}`);
  res.json({ user: publicUser(req.user), usage: quota.usage, changed: Boolean(current) });
});

/** 解绑（同样计入修改次数） */
router.delete('/bindings/:platform', (req, res) => {
  const platform = req.params.platform;
  const conf = PLATFORMS[platform];
  if (!conf) return res.status(400).json({ error: '暂不支持该平台' });
  req.user.bindings = req.user.bindings || {};
  if (!req.user.bindings[platform]) return res.status(400).json({ error: `尚未绑定${conf.label}` });

  const quota = consumeBindingQuota(req.user);
  if (!quota.ok) return res.status(429).json({ error: quota.error, usage: quota.usage, code: 'BINDING_LIMIT' });

  delete req.user.bindings[platform];
  save();
  eventLog(req, `解绑${conf.label}`, req.user.username || req.user.email);
  res.json({ user: publicUser(req.user), usage: quota.usage });
});

/* ---------------- 修改手机号 ---------------- */
router.post('/phone', (req, res) => {
  const { phone, password } = req.body || {};
  if (!verifyPassword(String(password || ''), req.user.passwordHash)) {
    return res.status(400).json({ error: '请输入正确的登录密码以确认身份' });
  }
  const target = normalizePhone(phone);
  if (!/^1[3-9]\d{9}$/.test(target)) return res.status(400).json({ error: '请输入有效的手机号' });
  if (target === req.user.phone) return res.status(400).json({ error: '新手机号与当前手机号相同' });

  const taken = db.users.find((u) => !u.deleted && u.id !== req.user.id && u.phone === target);
  if (taken) return res.status(409).json({ error: '该手机号已被其他账号使用' });

  req.user.phone = target;
  save();
  eventLog(req, '修改手机号', `${req.user.username || req.user.email} → ${target}`);
  res.json({ user: publicUser(req.user) });
});

/* ---------------- 修改密码 ---------------- */
router.post('/password', (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!verifyPassword(String(currentPassword || ''), req.user.passwordHash)) {
    return res.status(400).json({ error: '当前密码不正确' });
  }
  const pwdErr = isSha256Hex(newPassword) ? null : validatePassword(newPassword);
  if (pwdErr) return res.status(400).json({ error: pwdErr });
  req.user.passwordHash = hashPassword(newPassword);
  // 安全：失效其他会话（保留当前登录）
  const currentToken = req.session?.token;
  db.sessions = db.sessions.filter((s) => s.userId !== req.user.id || s.token === currentToken);
  save();
  eventLog(req, '修改登录密码', req.user.email || req.user.username);
  res.json({ ok: true, revokedOthers: true });
});

export default router;
