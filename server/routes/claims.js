import express from 'express';
import { db, save, uid, isNameTaken } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { validateName, sanitizeText } from '../lib/util.js';
import { upload, fileRecord, discardUploads, chargeUploadQuota, uploadByteQuota } from '../lib/upload.js';
import { normalizeEvidenceImages } from '../lib/file-integrity.js';
import { eventLog } from '../lib/logger.js';
import { deleteClaim } from '../lib/repo.js';

const router = express.Router();

export function shapeClaim(c, { withUser = false } = {}) {
  const user = db.users.find((u) => u.id === c.userId);
  return {
    id: c.id,
    name: c.name,
    description: c.description || '',
    images: c.images || [],
    status: c.status,
    rejectReason: c.rejectReason || '',
    reviewedAt: c.reviewedAt || null,
    reviewer: c.reviewerName || null,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt || c.createdAt,
    nameId: c.nameId || null,
    history: c.history || [],
    user: withUser && user
      ? {
          id: user.id,
          email: user.email,
          nickname: user.nickname,
          avatarUrl: user.avatarUrl || '',
          avatarHue: user.avatarHue,
          createdAt: user.createdAt,
          bindings: user.bindings || {},
        }
      : undefined,
  };
}

/* 上传归属证明材料（最多 6 张） */
router.post('/upload', requireAuth, uploadByteQuota, upload.array('images', 6), (req, res) => {
  chargeUploadQuota(req);
  if (!req.files?.length) return res.status(400).json({ error: '请选择要上传的图片' });
  res.json({ files: req.files.map(fileRecord) });
});

/* 提交圈名归属申请 */
router.post('/', requireAuth, uploadByteQuota, upload.array('images', 6), (req, res) => {
  chargeUploadQuota(req);
  // 业务校验失败时删除已落盘文件，避免遗留垃圾文件被反复上传撑爆磁盘
  const fail = (status, body) => {
    discardUploads(req.files);
    return res.status(status).json(body);
  };
  const { name, description = '', evidence = '' } = req.body || {};
  // 名称与描述统一清洗，防止存储型 XSS
  const safeName = sanitizeText(name, 16);
  const nameError = validateName(safeName);
  if (nameError) return fail(400, { error: nameError });

  let images = [];
  if (req.files?.length) images = req.files.map(fileRecord);
  else if (evidence) {
    let parsed;
    try {
      parsed = JSON.parse(evidence);
    } catch {
      parsed = null;
    }
    // 服务端重新校验 URL、文件存在性与 SHA-256，不信任客户端提交的图片元数据
    const checked = normalizeEvidenceImages(parsed, 6);
    if (!checked.ok) return fail(400, { error: checked.error });
    images = checked.images;
  }
  if (!Array.isArray(images) || images.length === 0) {
    return fail(400, { error: '请至少上传 1 张归属权证明材料图片' });
  }
  if (images.length > 6) return fail(400, { error: '最多上传 6 张材料图片' });

  const pending = db.claims.find(
    (c) => c.userId === req.user.id && c.name.toLowerCase() === safeName.toLowerCase() && c.status === 'pending',
  );
  if (pending) return fail(409, { error: '该圈名的申请正在审核中，请耐心等待结果' });

  if (isNameTaken(safeName)) return fail(409, { error: '该圈名已被其他用户绑定，如有异议可在圈名详情页提交申诉' });

  const now = new Date().toISOString();
  const claim = {
    id: uid('c_'),
    userId: req.user.id,
    name: safeName,
    description: sanitizeText(description, 300),
    images: images.map((i) => ({
      url: i.url,
      name: i.name || '材料图片',
      size: i.size || 0,
      mime: i.mime || '',
      // 内容哈希：用于后续完整性校验
      sha256: i.sha256 || '',
      uploadedAt: i.uploadedAt || now,
    })),
    status: 'pending',
    rejectReason: '',
    createdAt: now,
    updatedAt: now,
    reviewedAt: null,
    reviewedBy: null,
    nameId: null,
    history: [{ at: now, action: 'submit', note: '提交归属权申请' }],
  };
  db.claims.unshift(claim);
  req.user.stats = req.user.stats || { claims: 0, approved: 0, rejected: 0 };
  req.user.stats.claims = (req.user.stats.claims || 0) + 1;
  save();

  eventLog(req, '提交圈名归属申请', claim.name);
  res.status(201).json({ claim: shapeClaim(claim) });
});

/* 我的申请列表 */
router.get('/mine', requireAuth, (req, res) => {
  const list = db.claims.filter((c) => c.userId === req.user.id).map((c) => shapeClaim(c));
  const counts = {
    pending: list.filter((c) => c.status === 'pending').length,
    approved: list.filter((c) => c.status === 'approved').length,
    rejected: list.filter((c) => c.status === 'rejected').length,
  };
  res.json({ items: list, counts });
});

/* 撤回待审核申请 */
router.delete('/:id', requireAuth, (req, res) => {
  const claim = db.claims.find((c) => c.id === req.params.id && c.userId === req.user.id);
  if (!claim) return res.status(404).json({ error: '申请不存在' });
  if (claim.status !== 'pending') return res.status(400).json({ error: '仅可撤回待审核的申请' });
  db.claims = db.claims.filter((c) => c.id !== claim.id);
  // 显式删除数据库行，否则进程重启后已撤回的申请会重新出现
  deleteClaim(claim.id);
  save();
  eventLog(req, '撤回圈名归属申请', claim.name);
  res.json({ ok: true });
});

export default router;
