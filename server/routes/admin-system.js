import express from 'express';
import { db, save, publicUser, findUserById, bindingMonthlyLimit, dbStats } from '../lib/db.js';
import { requireAdmin } from '../lib/auth.js';
import { paginate } from '../lib/util.js';
import { eventLog, verifyLogChain } from '../lib/logger.js';
import { broadcastNotification, createNotification, notifyUser } from '../lib/notify.js';
import {
  publicMailConfig,
  saveMailConfig,
  sendTestMail,
  verifyMailer,
  getMailConfig,
  DEFAULT_TEMPLATE,
  previewMail,
} from '../lib/mailer.js';
import {
  securitySnapshot,
  saveRateConfig,
  blockIpPermanently,
  unblockIp,
  tempBlockIp,
  clearSecurityEvents,
  normalizeIp,
} from '../lib/guard.js';

import {
  registerGuardSnapshot,
  saveRegisterGuardConfig,
} from '../lib/register-guard.js';

const router = express.Router();

/* ============ 系统信息 ============ */
router.get('/system', requireAdmin, (req, res) => {
  res.json({
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    uptime: Math.round(process.uptime()),
    memory: process.memoryUsage().rss,
    admin: publicUser(req.user),
    counts: {
      users: db.users.filter((u) => !u.deleted).length,
      names: db.names.length,
      claims: db.claims.length,
      appeals: db.appeals.length,
      notifications: db.notifications.length,
      logs: db.logs.length,
      sessions: db.sessions.length,
    },
    storage: { db: 'server/data/db.json', uploads: 'server/uploads' },
  });
});

/* ============ 邮件配置 ============ */
router.get('/mail', requireAdmin, (_req, res) => {
  const conf = getMailConfig();
  res.json({
    config: publicMailConfig(),
    defaultTemplate: DEFAULT_TEMPLATE,
    variables: [
      { key: '{{code}}', desc: '6 位数字验证码' },
      { key: '{{action}}', desc: '操作名称，如「注册账号」' },
      { key: '{{year}}', desc: '当前年份' },
      { key: '{{site}}', desc: '站点名称' },
    ],
    smtpHint: conf.configured ? `当前生效：${conf.user}` : '尚未配置 QQ 邮箱账号与 SMTP 授权码，注册与登录验证码将无法发送',
  });
});

router.put('/mail', requireAdmin, (req, res) => {
  const { host, port, secure, user, pass, fromName, fromEmail, subject, template, clearPass } = req.body || {};
  if (user && !/^[a-z0-9._%+-]+@qq\.com$/i.test(String(user).trim())) {
    return res.status(400).json({ error: '发件邮箱需为 QQ 邮箱（@qq.com）' });
  }
  if (template && !String(template).includes('{{code}}')) {
    return res.status(400).json({ error: '邮件模板必须包含 {{code}} 验证码变量' });
  }
  const saved = saveMailConfig({ host, port, secure, user, pass, fromName, fromEmail, subject, template, clearPass });
  eventLog(req, '更新 QQ 邮箱配置', saved.user || '未配置');
  res.json({ ok: true, config: saved });
});

router.post('/mail/test', requireAdmin, async (req, res) => {
  const to = String(req.body?.to || '').trim();
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(to)) {
    return res.status(400).json({ error: '请输入正确的收件邮箱' });
  }
  try {
    const result = await sendTestMail(to);
    eventLog(req, '发送测试邮件', to);
    res.json({ ok: true, ...result });
  } catch (err) {
    if (err.code === 'MAIL_NOT_CONFIGURED') return res.status(503).json({ error: err.message });
    res.status(502).json({ error: `发送失败：${err.message}` });
  }
});

router.post('/mail/verify', requireAdmin, async (req, res) => {
  const result = await verifyMailer();
  res.json(result);
});

router.get('/mail/preview', requireAdmin, (req, res) => {
  res.json(previewMail({ code: String(req.query.code || '246810'), action: String(req.query.action || '注册账号') }));
});

/* ============ 通知管理 ============ */
router.get('/notifications', requireAdmin, (req, res) => {
  const { q = '', type = 'all', page = 1, pageSize = 12 } = req.query;
  const keyword = String(q).trim().toLowerCase();
  let list = [...db.notifications];
  if (type !== 'all') list = list.filter((n) => n.type === type);
  if (keyword) {
    list = list.filter(
      (n) => n.title.toLowerCase().includes(keyword) || n.content.toLowerCase().includes(keyword),
    );
  }
  list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const result = paginate(list, page, pageSize);
  const target = (n) => {
    const u = n.userId ? findUserById(n.userId) : null;
    return u ? { id: u.id, nickname: u.nickname, email: u.email } : null;
  };
  res.json({
    ...result,
    items: result.items.map((n) => ({
      ...n,
      target: target(n),
      readCount: n.readAt ? 1 : 0,
    })),
    counts: {
      all: db.notifications.length,
      system: db.notifications.filter((n) => n.type === 'system').length,
      personal: db.notifications.filter((n) => n.type === 'personal').length,
      unread: db.notifications.filter((n) => !n.readAt).length,
    },
  });
});

/** 发布系统公告（全员） */
router.post('/notifications/broadcast', requireAdmin, (req, res) => {
  const { title, content, level = 'info', category = 'system', link = null } = req.body || {};
  if (!String(title || '').trim()) return res.status(400).json({ error: '请填写通知标题' });
  if (String(title).length > 60) return res.status(400).json({ error: '标题请控制在 60 字以内' });
  if (!String(content || '').trim()) return res.status(400).json({ error: '请填写通知内容' });
  if (String(content).length > 1500) return res.status(400).json({ error: '内容请控制在 1500 字以内' });

  const result = broadcastNotification({ title, content, level, category, link, by: req.user.nickname });
  eventLog(req, '发布系统通知', `${title}（${result.count} 人）`);
  res.json({ ok: true, ...result });
});

/** 给指定用户发通知 */
router.post('/notifications/send', requireAdmin, (req, res) => {
  const { userIds = [], title, content, level = 'info', category = 'personal', link = null } = req.body || {};
  if (!Array.isArray(userIds) || !userIds.length) return res.status(400).json({ error: '请选择接收用户' });
  if (!String(title || '').trim()) return res.status(400).json({ error: '请填写通知标题' });
  if (!String(content || '').trim()) return res.status(400).json({ error: '请填写通知内容' });

  let sent = 0;
  const missing = [];
  for (const id of userIds) {
    const u = findUserById(id);
    if (!u || u.deleted) {
      missing.push(id);
      continue;
    }
    notifyUser(u.id, { title, content, level, category, link, by: req.user.nickname });
    sent += 1;
  }
  eventLog(req, '发送指定用户通知', `${title}（${sent} 人）`);
  res.json({ ok: true, sent, missing });
});

/** 按邮箱搜索用户（发送通知时选择收件人） */
router.get('/notifications/recipients', requireAdmin, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  let list = db.users.filter((u) => !u.deleted);
  if (q) {
    list = list.filter((u) => u.email.toLowerCase().includes(q) || u.nickname.toLowerCase().includes(q));
  }
  res.json({
    items: list.slice(0, 20).map((u) => ({
      id: u.id,
      email: u.email,
      nickname: u.nickname,
      role: u.role,
      avatarHue: u.avatarHue,
    })),
  });
});

router.delete('/notifications/:id', requireAdmin, (req, res) => {
  const before = db.notifications.length;
  db.notifications = db.notifications.filter((n) => n.id !== req.params.id);
  if (db.notifications.length === before) return res.status(404).json({ error: '通知不存在' });
  save();
  eventLog(req, '删除通知', req.params.id);
  res.json({ ok: true });
});

/* ============ IP 风控 ============ */
router.get('/security', requireAdmin, (_req, res) => {
  res.json(securitySnapshot());
});

router.put('/security/config', requireAdmin, (req, res) => {
  const config = saveRateConfig(req.body || {});
  eventLog(req, '更新风控配置', `阈值 ${config.maxRequests}/${config.windowSeconds}s`);
  res.json({ ok: true, config });
});

router.post('/security/block', requireAdmin, (req, res) => {
  const { ip, reason, seconds } = req.body || {};
  if (!String(ip || '').trim()) return res.status(400).json({ error: '请输入要限制的 IP 地址' });
  if (!/^[\d.:a-fA-F]{3,45}$/.test(String(ip).trim())) return res.status(400).json({ error: 'IP 格式不正确' });

  if (seconds) {
    const result = tempBlockIp(ip, seconds, reason || '管理员手动临时限制');
    eventLog(req, '临时限制 IP', `${normalizeIp(ip)} · ${seconds}s`);
    return res.json({ ok: true, mode: 'temp', ...result });
  }
  const result = blockIpPermanently(ip, { reason: reason || '管理员手动拉黑', by: req.user.nickname });
  if (!result.ok) return res.status(409).json({ error: result.message });
  eventLog(req, '永久拉黑 IP', normalizeIp(ip));
  res.json({ ok: true, mode: 'permanent' });
});

router.post('/security/unblock', requireAdmin, (req, res) => {
  const ip = String(req.body?.ip || '').trim();
  if (!ip) return res.status(400).json({ error: '请输入要解除的 IP' });
  const result = unblockIp(ip);
  eventLog(req, '解除 IP 限制', normalizeIp(ip));
  res.json({ ok: true, ...result });
});

router.delete('/security/events', requireAdmin, (req, res) => {
  // 审计要求：清理动作本身必须先落日志，避免「静默抹除痕迹」
  const count = (db.security.events || []).length;
  eventLog(req, '清空风控事件记录', `清理 ${count} 条（操作者：${req.user.nickname}）`, 'warn');
  clearSecurityEvents();
  res.json({ ok: true, cleared: count });
});

/* ============ 运行时性能指标 ============ */
router.get('/metrics', requireAdmin, (_req, res) => {
  const mem = process.memoryUsage();
  res.json({
    uptime: Math.round(process.uptime()),
    memory: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal },
    db: dbStats(),
    sessions: db.sessions.length,
  });
});

/* ============ 日志完整性校验 ============ */
router.get('/logs/integrity', requireAdmin, (_req, res) => {
  res.json(verifyLogChain());
});

/* ============ 注册风控 & 绑定限额 ============ */
router.get('/register-guard', requireAdmin, (_req, res) => {
  res.json(registerGuardSnapshot());
});

router.put('/register-guard', requireAdmin, (req, res) => {
  const config = saveRegisterGuardConfig(req.body || {});
  eventLog(req, '更新注册风控配置', `${config.windowMinutes} 分钟 / ${config.maxPerWindow} 次`);
  res.json({ ok: true, config });
});

router.get('/binding-limit', requireAdmin, (_req, res) => {
  res.json({
    monthlyLimit: bindingMonthlyLimit(),
    description: '每个用户每月可修改社交账号绑定的次数，首次绑定不占用额度',
  });
});

router.put('/binding-limit', requireAdmin, (req, res) => {
  const limit = Math.max(1, Math.min(20, Number(req.body?.monthlyLimit) || 3));
  db.settings.binding = { ...(db.settings.binding || {}), monthlyLimit: limit };
  save();
  eventLog(req, '更新绑定修改限额', `每月 ${limit} 次`);
  res.json({ ok: true, monthlyLimit: limit });
});

export default router;
