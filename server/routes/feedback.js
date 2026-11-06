import express from 'express';
import { db, save, uid, publicUser } from '../lib/db.js';
import { attachUser, requireAuth, requirePermission } from '../lib/auth.js';
import { sanitizeText, clientIp, paginate } from '../lib/util.js';
import { eventLog } from '../lib/logger.js';
import { notifyUser } from '../lib/notify.js';
import { upload, fileRecord } from '../lib/upload.js';

const router = express.Router();

export const FEEDBACK_KINDS = [
  { key: 'bug', label: '功能异常 / Bug', hint: '页面报错、按钮无反应、数据异常等' },
  { key: 'suggestion', label: '产品建议', hint: '希望新增或优化的功能' },
  { key: 'vulnerability', label: '安全漏洞', hint: '发现的安全问题，我们会优先处理' },
  { key: 'other', label: '其他', hint: '请在下方的「类型说明」中自行填写' },
];

const KIND_KEYS = new Set(FEEDBACK_KINDS.map((k) => k.key));

export function shapeFeedback(f, { withUser = false } = {}) {
  const user = f.userId ? db.users.find((u) => u.id === f.userId) : null;
  return {
    id: f.id,
    kind: f.kind,
    kindLabel: FEEDBACK_KINDS.find((k) => k.key === f.kind)?.label || f.kind,
    kindOther: f.kindOther || '',
    title: f.title,
    content: f.content,
    contact: f.contact || '',
    pagePath: f.pagePath || '',
    imageUrl: f.imageUrl || '',
    status: f.status,
    readAt: f.readAt || null,
    reply: f.reply || '',
    repliedAt: f.repliedAt || null,
    repliedBy: f.repliedBy || null,
    createdAt: f.createdAt,
    user: withUser
      ? user
        ? { id: user.id, nickname: user.nickname, username: user.username, email: user.email, avatarUrl: user.avatarUrl || '', avatarHue: user.avatarHue }
        : null
      : undefined,
  };
}

/* ---------------- 公开：类型列表 ---------------- */
router.get('/kinds', (_req, res) => {
  res.json({ kinds: FEEDBACK_KINDS });
});

/* ---------------- 提交反馈（登录可选，支持匿名） ---------------- */
router.post('/', attachUser, upload.array('image', 1), (req, res) => {
  const { kind, kindOther = '', title, content, contact = '', pagePath = '' } = req.body || {};

  if (!KIND_KEYS.has(kind)) return res.status(400).json({ error: '请选择反馈类型' });

  const safeTitle = sanitizeText(title, 80);
  const safeContent = sanitizeText(content, 2000);
  const safeOther = sanitizeText(kindOther, 30);
  const safeContact = sanitizeText(contact, 60);
  const safePage = sanitizeText(pagePath, 120);

  if (safeTitle.length < 2) return res.status(400).json({ error: '标题至少 2 个字符' });
  if (safeContent.length < 5) return res.status(400).json({ error: '内容至少 5 个字符' });
  if (kind === 'other' && !safeOther) return res.status(400).json({ error: '选择「其他」时请填写类型说明' });

  // 防刷：同一 IP/用户 10 分钟内最多 5 条
  const now = Date.now();
  const ip = clientIp(req);
  const recent = db.feedback.filter(
    (f) => now - new Date(f.createdAt).getTime() < 10 * 60 * 1000 &&
      ((req.user && f.userId === req.user.id) || f.ip === ip),
  );
  if (recent.length >= 5) {
    return res.status(429).json({ error: '提交过于频繁，请 10 分钟后再试', code: 'FEEDBACK_RATE_LIMITED' });
  }

  const images = req.files?.length ? req.files.map(fileRecord) : [];

  const record = {
    id: uid('fb_'),
    userId: req.user?.id || null,
    ip,
    kind,
    kindOther: safeOther,
    title: safeTitle,
    content: safeContent,
    contact: safeContact,
    pagePath: safePage,
    imageUrl: images[0]?.url || '',
    status: 'pending',
    readAt: null,
    reply: '',
    repliedAt: null,
    repliedBy: null,
    createdAt: new Date().toISOString(),
  };
  db.feedback.unshift(record);
  save('feedback');

  eventLog(req, '提交反馈', `${record.kindLabel || kind} · ${safeTitle}`);

  // 给提交者一条确认通知（仅登录用户）
  if (req.user) {
    notifyUser(req.user.id, {
      category: 'feedback',
      level: 'info',
      title: '反馈已提交成功',
      content: `你的反馈「${safeTitle}」已提交，等待管理员处理，请耐心等待。处理后会再次通知你。`,
      link: '/me?tab=feedback',
    });
  }

  res.status(201).json({ ok: true, id: record.id, message: '反馈已提交，感谢你的建议' });
});

/* ---------------- 我的反馈 ---------------- */
router.get('/mine', requireAuth, (req, res) => {
  const items = db.feedback
    .filter((f) => f.userId === req.user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((f) => shapeFeedback(f));
  res.json({
    items,
    counts: {
      total: items.length,
      pending: items.filter((f) => f.status === 'pending').length,
      replied: items.filter((f) => f.status === 'replied').length,
    },
  });
});

export default router;
