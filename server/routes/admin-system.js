import express from 'express';
import { db, save, publicUser, findUserById, bindingMonthlyLimit, dbStats, ROOT, UPLOAD_DIR } from '../lib/db.js';
import { requireAdmin } from '../lib/auth.js';
import { paginate } from '../lib/util.js';
import { eventLog, verifyLogChain } from '../lib/logger.js';
import { broadcastNotification, createNotification, notifyUser } from '../lib/notify.js';
import { deleteNotification } from '../lib/repo.js';
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
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// archiver 是 CommonJS 模块，ESM 下需用 require 引入
const archiver = require('archiver');
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyPassword } from '../lib/password.js';
import {
  adminGeetestConfig,
  saveGeetestConfig,
  clearGeetestConfig,
  verifyGeetest,
  SCENE_LABELS,
} from '../lib/geetest.js';

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
      // 日志量直读数据库（内存只加载最近 2000 条）
      logs: Number(getDb().prepare('SELECT COUNT(*) c FROM access_logs').get().c) || 0,
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
  // 显式删除数据库行，避免重启后已删除通知重新出现
  deleteNotification(req.params.id);
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


/* ================= 数据导出 ================= */

/**
 * 导出完整数据库（SQLite 文件）
 *
 * 安全措施：
 * - 仅 admin 可调用（verify 密码二次确认）
 * - 用 SQLite 在线备份 API 生成一致性快照，避免读到写一半的数据
 * - 快照文件写临时目录，下载后立即删除
 * - 全流程记审计日志
 */
router.post('/export/database', requireAdmin, async (req, res) => {
  const password = String(req.body?.password || '');
  if (!password) return res.status(400).json({ error: '请输入当前账号密码以确认导出' });

  const me = findUserById(req.user.id);
  if (!verifyPassword(password, me.passwordHash)) {
    eventLog(req, '数据库导出失败', '密码校验不通过', 'error');
    return res.status(403).json({ error: '密码不正确' });
  }

  const src = path.join(ROOT, 'data', 'quanming.db');
  const tmp = path.join(os.tmpdir(), `qm-export-${Date.now()}.db`);

  try {
    // 优先用 sqlite3 .backup 保证一致性；不可用时退回复制
    try {
      execFileSync('sqlite3', [src, `.backup '${tmp}'`], { timeout: 60000 });
    } catch {
      execFileSync('sqlite3', [src, 'PRAGMA wal_checkpoint(TRUNCATE);'], { timeout: 30000 });
      fs.copyFileSync(src, tmp);
    }

    const stat = fs.statSync(tmp);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const filename = `quanming-db-${stamp}.db`;

    eventLog(req, '导出数据库', `${filename} · ${(stat.size / 1024 / 1024).toFixed(2)}MB`);
    res.download(tmp, filename, () => {
      // 无论成功失败都清理临时文件，避免残留敏感数据
      try { fs.unlinkSync(tmp); } catch {}
    });
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch {}
    eventLog(req, '数据库导出失败', String(err.message).slice(0, 100), 'error');
    res.status(500).json({ error: '导出失败：' + String(err.message).slice(0, 120) });
  }
});

/**
 * 导出全部上传图片（ZIP 打包）
 *
 * 只打包 <UPLOAD_DIR> 下的文件，排除隐藏文件与空目录。
 * 大文件通过流式压缩写入临时文件，避免占满内存。
 */
router.post('/export/uploads', requireAdmin, async (req, res) => {
  const password = String(req.body?.password || '');
  if (!password) return res.status(400).json({ error: '请输入当前账号密码以确认导出' });

  const me = findUserById(req.user.id);
  if (!verifyPassword(password, me.passwordHash)) {
    eventLog(req, '图片导出失败', '密码校验不通过', 'error');
    return res.status(403).json({ error: '密码不正确' });
  }

  const tmp = path.join(os.tmpdir(), `qm-uploads-${Date.now()}.zip`);

  try {
    if (!fs.existsSync(UPLOAD_DIR)) {
      return res.status(404).json({ error: '没有可导出的图片' });
    }

    // 收集文件清单（跳过占位文件）
    const files = [];
    const walk = (dir, prefix = '') => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(full, rel);
        else files.push({ full, rel });
      }
    };
    walk(UPLOAD_DIR);

    if (!files.length) return res.status(404).json({ error: '没有可导出的图片' });

    // 流式压缩
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(tmp);
      const archive = archiver('zip', { zlib: { level: 6 } });
      output.on('close', resolve);
      output.on('error', reject);
      archive.on('error', reject);
      archive.pipe(output);
      for (const f of files) archive.file(f.full, { name: f.rel });
      archive.finalize();
    });

    const stat = fs.statSync(tmp);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const filename = `quanming-uploads-${stamp}.zip`;

    eventLog(req, '导出图片', `${filename} · ${files.length} 个 · ${(stat.size / 1024 / 1024).toFixed(2)}MB`);
    res.download(tmp, filename, () => {
      try { fs.unlinkSync(tmp); } catch {}
    });
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch {}
    eventLog(req, '图片导出失败', String(err.message).slice(0, 100), 'error');
    res.status(500).json({ error: '导出失败：' + String(err.message).slice(0, 120) });
  }
});

/** 导出前的统计预览（让管理员知道会导出多少数据） */
router.get('/export/info', requireAdmin, (_req, res) => {
  const dbPath = path.join(ROOT, 'data', 'quanming.db');
  let dbSize = 0;
  try { dbSize = fs.statSync(dbPath).size; } catch {}

  let fileCount = 0;
  let fileSize = 0;
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        fileCount += 1;
        try { fileSize += fs.statSync(full).size; } catch {}
      }
    }
  };
  walk(UPLOAD_DIR);

  res.json({
    database: { size: dbSize, path: 'data/quanming.db' },
    uploads: { count: fileCount, size: fileSize },
    counts: {
      users: db.users.filter((u) => !u.deleted).length,
      names: db.names.length,
      claims: db.claims.length,
      appeals: db.appeals.length,
    },
  });
});


/* ================= 极验人机验证配置 ================= */

/** 读取两个场景的配置（key 打码） */
router.get('/geetest', requireAdmin, (_req, res) => {
  res.json({ scenes: adminGeetestConfig() });
});

/** 保存某场景配置 */
router.put('/geetest/:scene', requireAdmin, (req, res) => {
  const scene = String(req.params.scene || '');
  const result = saveGeetestConfig(scene, {
    captchaId: req.body?.captchaId,
    captchaKey: req.body?.captchaKey,
  });
  if (!result.ok) return res.status(400).json({ error: result.error });

  eventLog(req, '修改人机验证配置', `${SCENE_LABELS[scene] || scene} · ${req.body?.captchaId ? '已设置' : '已清空'}`);
  res.json({ ok: true, scenes: adminGeetestConfig() });
});

/** 清空某场景配置 */
router.delete('/geetest/:scene', requireAdmin, (req, res) => {
  const scene = String(req.params.scene || '');
  const result = clearGeetestConfig(scene);
  if (!result.ok) return res.status(400).json({ error: result.error });

  eventLog(req, '清空人机验证配置', SCENE_LABELS[scene] || scene);
  res.json({ ok: true, scenes: adminGeetestConfig() });
});

/** 测试某场景配置是否可用（用极验官方接口探测 captcha_id 是否有效） */
router.post('/geetest/:scene/test', requireAdmin, async (req, res) => {
  const scene = String(req.params.scene || '');
  const cfg = adminGeetestConfig().find((s) => s.scene === scene);
  if (!cfg) return res.status(400).json({ error: '不支持的场景' });
  if (!cfg.configured) return res.status(400).json({ error: '该场景尚未配置完整（需要 captchaId 与 captchaKey）' });

  // 用假凭据直接探测极验接口：
  //   - 返回 sign_token error / pass_token error → captcha_id 与 key 匹配，配置有效
  //   - 返回 invalid captcha_id / 403 / 404   → 配置无效
  //   - 网络超时                              → 无法判断
  const body = new URLSearchParams({
    lot_number: `probe${Date.now()}`,
    captcha_output: 'probe',
    pass_token: 'probe',
    gen_time: String(Math.floor(Date.now() / 1000)),
    sign_token: 'probe',
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const r = await fetch(
      `https://gcaptcha4.geetest.com/validate?captcha_id=${encodeURIComponent(cfg.captchaId)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: controller.signal,
      },
    );
    clearTimeout(timer);

    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* 非 JSON */ }
    const reason = String(data?.reason || '').toLowerCase();

    // captcha_id 不存在时极验会明确报错
    const invalid = /invalid|captcha_id/.test(reason) || r.status === 403 || r.status === 404;
    const ok = !invalid && r.ok;

    eventLog(req, '测试人机验证配置', `${SCENE_LABELS[scene] || scene} · ${ok ? '有效' : '无效'}`);
    res.json({
      ok,
      reachable: true,
      reason: data?.reason || `HTTP_${r.status}`,
      hint: ok
        ? '配置有效：极验接口可正常响应，captchaId 与 captchaKey 匹配'
        : '配置可能无效：请检查 captchaId 与 captchaKey 是否来自同一个极验应用',
    });
  } catch (err) {
    clearTimeout(timer);
    res.json({
      ok: false,
      reachable: false,
      reason: 'NETWORK',
      hint: `无法连接极验接口：${String(err.message || '').slice(0, 80)}`,
    });
  }
});


/** 批量删除通知 */
router.post('/notifications/batch-delete', requireAdmin, (req, res) => {
  const { ids = [] } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) {
    return res.status(400).json({ error: '请选择要删除的通知' });
  }

  const before = db.notifications.length;
  db.notifications = db.notifications.filter((n) => !ids.includes(n.id));
  const removed = before - db.notifications.length;
  if (removed) {
    save('notifications');
    eventLog(req, '批量删除通知', `${removed} 条`);
  }
  res.json({ ok: true, done: removed });
});

export default router;
