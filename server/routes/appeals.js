import express from 'express';
import { db, save, uid } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { upload, fileRecord } from '../lib/upload.js';
import { sanitizeText } from '../lib/util.js';
import { eventLog } from '../lib/logger.js';
import { notifyUser } from '../lib/notify.js';

const router = express.Router();

export const APPEAL_REASONS = [
  '该圈名实际由我使用，原归属材料不实',
  '原归属账号冒用/盗用我的圈名',
  '圈名归属账号已转让给我',
  '原归属账号长期不活跃，本人持续使用',
  '其他情况（请在补充说明中详述）',
];

export function shapeAppeal(a, { withUser = false } = {}) {
  const user = db.users.find((u) => u.id === a.userId);
  const owner = db.users.find((u) => u.id === a.ownerId);
  const name = db.names.find((n) => n.id === a.nameId);
  return {
    id: a.id,
    nameId: a.nameId,
    name: a.name || name?.name || '—',
    ownerId: a.ownerId,
    ownerNickname: owner?.nickname || '—',
    reason: a.reason,
    description: a.description || '',
    images: a.images || [],
    status: a.status,
    rejectReason: a.rejectReason || '',
    createdAt: a.createdAt,
    updatedAt: a.updatedAt || a.createdAt,
    reviewedAt: a.reviewedAt || null,
    reviewer: a.reviewerName || null,
    transfer: Boolean(a.transfer),
    user: withUser && user
      ? {
          id: user.id,
          email: user.email,
          nickname: user.nickname,
          avatarHue: user.avatarHue,
          createdAt: user.createdAt,
        }
      : undefined,
  };
}

/** 提交申诉（圈名详情页） */
router.post('/', requireAuth, upload.array('images', 6), (req, res) => {
  const { nameId, reason, description = '', evidence = '' } = req.body || {};
  const safeReason = sanitizeText(reason, 80);
  const safeDesc = sanitizeText(description, 500);
  const name = db.names.find((n) => n.id === nameId || n.name === nameId);
  if (!name || name.status === 'hidden') return res.status(404).json({ error: '该圈名不存在或已下架' });
  if (name.ownerId === req.user.id) return res.status(400).json({ error: '你已是该圈名的归属者，无需申诉' });
  if (!safeReason) return res.status(400).json({ error: '请选择申诉类型' });

  let images = [];
  if (req.files?.length) images = req.files.map(fileRecord);
  else if (evidence) {
    try {
      images = JSON.parse(evidence);
    } catch {
      images = [];
    }
  }
  if (!images.length) return res.status(400).json({ error: '请至少上传 1 张申诉证明材料' });
  if (images.length > 6) return res.status(400).json({ error: '最多上传 6 张材料图片' });
  if (String(description).length > 500) return res.status(400).json({ error: '补充说明请控制在 500 字以内' });

  const dup = db.appeals.find((a) => a.userId === req.user.id && a.nameId === name.id && a.status === 'pending');
  if (dup) return res.status(409).json({ error: '你对该圈名的申诉正在审核中，请耐心等待结果' });

  const now = new Date().toISOString();
  const appeal = {
    id: uid('ap_'),
    userId: req.user.id,
    nameId: name.id,
    name: name.name,
    ownerId: name.ownerId,
    reason: safeReason,
    description: safeDesc,
    images: images.map((i) => ({
      url: i.url,
      name: i.name || '申诉材料',
      size: i.size || 0,
      mime: i.mime || '',
      sha256: i.sha256 || '',
      uploadedAt: i.uploadedAt || now,
    })),
    status: 'pending',
    rejectReason: '',
    createdAt: now,
    updatedAt: now,
    reviewedAt: null,
    reviewedBy: null,
    reviewerName: null,
    history: [{ at: now, action: 'submit', note: '提交圈名归属申诉' }],
  };
  db.appeals.unshift(appeal);
  save();

  // 通知原归属者
  notifyUser(name.ownerId, {
    category: 'appeal',
    level: 'warning',
    title: `你的圈名「${name.name}」收到一条归属申诉`,
    content: `用户「${req.user.nickname}」对该圈名提交了归属申诉，理由：${appeal.reason}。审核期间圈名归属保持不变，若申诉通过将转移归属并通知你。如你有异议，请加入交流群联系管理员。`,
    link: `/names/${name.id}`,
    meta: { appealId: appeal.id, nameId: name.id },
    by: req.user.id,
  });

  eventLog(req, '提交圈名归属申诉', `${name.name} · ${appeal.reason}`);
  res.status(201).json({ appeal: shapeAppeal(appeal) });
});

/** 我的申诉 */
router.get('/mine', requireAuth, (req, res) => {
  const items = db.appeals.filter((a) => a.userId === req.user.id).map((a) => shapeAppeal(a));
  res.json({
    items,
    counts: {
      pending: items.filter((a) => a.status === 'pending').length,
      approved: items.filter((a) => a.status === 'approved').length,
      rejected: items.filter((a) => a.status === 'rejected').length,
    },
  });
});

/** 撤回待审申诉 */
router.delete('/:id', requireAuth, (req, res) => {
  const appeal = db.appeals.find((a) => a.id === req.params.id && a.userId === req.user.id);
  if (!appeal) return res.status(404).json({ error: '申诉不存在' });
  if (appeal.status !== 'pending') return res.status(400).json({ error: '仅可撤回审核中的申诉' });
  db.appeals = db.appeals.filter((a) => a.id !== appeal.id);
  save();
  eventLog(req, '撤回圈名归属申诉', appeal.name);
  res.json({ ok: true });
});

export default router;
