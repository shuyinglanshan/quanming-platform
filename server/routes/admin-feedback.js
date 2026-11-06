import express from 'express';
import { db, save, findUserById } from '../lib/db.js';
import { requirePermission } from '../lib/auth.js';
import { sanitizeText, paginate } from '../lib/util.js';
import { eventLog } from '../lib/logger.js';
import { notifyUser } from '../lib/notify.js';
import { shapeFeedback } from './feedback.js';

const router = express.Router();

/* 列表 */
router.get('/feedback', requirePermission('feedback'), (req, res) => {
  const { status = 'all', kind = 'all', q = '', page = 1, pageSize = 10 } = req.query;
  const keyword = String(q).trim().toLowerCase();

  let list = [...db.feedback];
  if (status !== 'all') list = list.filter((f) => f.status === status);
  if (kind !== 'all') list = list.filter((f) => f.kind === kind);
  if (keyword) {
    list = list.filter((f) => {
      const user = f.userId ? findUserById(f.userId) : null;
      return (
        f.title.toLowerCase().includes(keyword) ||
        f.content.toLowerCase().includes(keyword) ||
        (f.kindOther || '').toLowerCase().includes(keyword) ||
        (f.contact || '').toLowerCase().includes(keyword) ||
        (user?.username || '').toLowerCase().includes(keyword)
      );
    });
  }

  // 未读优先，其次按时间倒序
  const order = { pending: 0, read: 1, replied: 2, closed: 3 };
  list.sort((a, b) => (order[a.status] - order[b.status]) || (new Date(b.createdAt) - new Date(a.createdAt)));

  const result = paginate(list, page, pageSize);
  res.json({
    ...result,
    items: result.items.map((f) => shapeFeedback(f, { withUser: true })),
    counts: {
      all: db.feedback.length,
      pending: db.feedback.filter((f) => f.status === 'pending').length,
      read: db.feedback.filter((f) => f.status === 'read').length,
      replied: db.feedback.filter((f) => f.status === 'replied').length,
      vulnerability: db.feedback.filter((f) => f.kind === 'vulnerability').length,
    },
  });
});

/* 标记已读 —— 同时给提交者发通知 */
router.post('/feedback/:id/read', requirePermission('feedback'), (req, res) => {
  const f = db.feedback.find((x) => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: '反馈不存在' });
  if (f.status !== 'pending') return res.json({ ok: true, already: true, feedback: shapeFeedback(f, { withUser: true }) });

  f.status = 'read';
  f.readAt = new Date().toISOString();
  save('feedback');

  if (f.userId) {
    notifyUser(f.userId, {
      category: 'feedback',
      level: 'info',
      title: '您的建议已提交',
      content: '您的建议已提交，等待管理员处理，请耐心等待。',
      link: '/me?tab=feedback',
    });
  }

  eventLog(req, '已读反馈', f.title);
  res.json({ ok: true, feedback: shapeFeedback(f, { withUser: true }) });
});

/* 答复 */
router.post('/feedback/:id/reply', requirePermission('feedback'), (req, res) => {
  const f = db.feedback.find((x) => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: '反馈不存在' });

  const reply = sanitizeText(req.body?.reply, 1000);
  if (reply.length < 2) return res.status(400).json({ error: '请填写答复内容（至少 2 个字）' });

  const now = new Date().toISOString();
  f.reply = reply;
  f.repliedAt = now;
  f.repliedBy = req.user.nickname;
  f.status = 'replied';
  if (!f.readAt) f.readAt = now;
  save('feedback');

  if (f.userId) {
    notifyUser(f.userId, {
      category: 'feedback',
      level: 'success',
      title: '你的反馈已收到答复',
      content: `关于「${f.title}」的答复：${reply}`,
      link: '/me?tab=feedback',
    });
  }

  eventLog(req, '答复反馈', f.title);
  res.json({ ok: true, feedback: shapeFeedback(f, { withUser: true }) });
});

/* 关闭 */
router.post('/feedback/:id/close', requirePermission('feedback'), (req, res) => {
  const f = db.feedback.find((x) => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: '反馈不存在' });
  f.status = 'closed';
  save('feedback');
  eventLog(req, '关闭反馈', f.title);
  res.json({ ok: true, feedback: shapeFeedback(f, { withUser: true }) });
});

/* 删除 */
router.delete('/feedback/:id', requirePermission('feedback'), (req, res) => {
  const f = db.feedback.find((x) => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: '反馈不存在' });
  db.feedback = db.feedback.filter((x) => x.id !== f.id);
  save('feedback');
  eventLog(req, '删除反馈', f.title);
  res.json({ ok: true });
});

/* ================= 角色与功能开关 ================= */

/** 查看可授权的功能项 + 当前配置 */
router.get('/roles', requirePermission('users'), (_req, res) => {
  res.json({
    roles: [
      { key: 'admin', label: '管理员', desc: '最高权限，拥有全部功能，不可被限制' },
      { key: 'superadmin', label: '超级管理员', desc: '权限仅次于管理员，高于审核员' },
      { key: 'assessor', label: '审核员', desc: '负责审核圈名归属、申诉与头像' },
      { key: 'user', label: '普通用户', desc: '前台功能，无后台入口' },
    ],
    features: [
      { key: 'review', label: '归属审核', desc: '审核圈名归属申请' },
      { key: 'appeal', label: '归属申诉', desc: '处理圈名归属申诉' },
      { key: 'avatars', label: '头像审核', desc: '审核用户头像修改申请' },
      { key: 'feedback', label: '反馈处理', desc: '查看并答复用户反馈与漏洞' },
      { key: 'logs', label: '访问日志', desc: '查看站点访问与操作日志' },
      { key: 'users', label: '用户管理', desc: '管理用户、权限、头像与头衔' },
      { key: 'names', label: '圈名管理', desc: '下架、转让、删除圈名' },
      { key: 'notify', label: '通知发布', desc: '发布系统公告与定向通知' },
    ],
    grants: {
      superadmin: db.settings?.staffPermissions?.grants?.superadmin || [],
      assessor: db.settings?.staffPermissions?.grants?.assessor || [],
    },
  });
});

/** 保存某角色的功能开关 */
router.put('/roles/:role/features', requirePermission('users'), (req, res) => {
  const role = req.params.role;
  if (!['superadmin', 'assessor'].includes(role)) {
    return res.status(400).json({ error: '只能为超级管理员或审核员配置功能权限' });
  }
  const features = Array.isArray(req.body?.features) ? req.body.features : [];
  const ALLOWED = ['review', 'appeal', 'avatars', 'feedback', 'logs', 'users', 'names', 'notify'];
  const clean = [...new Set(features.filter((f) => ALLOWED.includes(f)))];

  db.settings.staffPermissions = db.settings.staffPermissions || { grants: {} };
  db.settings.staffPermissions.grants = db.settings.staffPermissions.grants || {};
  db.settings.staffPermissions.grants[role] = clean;
  save('settings');

  eventLog(req, '更新角色功能权限', `${role} → ${clean.join(',') || '（仅基础权限）'}`);
  res.json({ ok: true, role, features: clean });
});

export default router;
