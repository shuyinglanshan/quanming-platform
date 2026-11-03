import express from 'express';
import { db, save, uid, findUserById, publicUser } from '../lib/db.js';
import { requireStaff, requirePermission } from '../lib/auth.js';
import { paginate, timeBucket } from '../lib/util.js';
import { shapeClaim } from './claims.js';
import { shapeName } from './names.js';
import { shapeAppeal } from './appeals.js';
import { eventLog } from '../lib/logger.js';
import { verifyImageRecords } from '../lib/file-integrity.js';
import { notifyUser } from '../lib/notify.js';
import manageRoutes from './admin-manage.js';
import systemRoutes from './admin-system.js';

const router = express.Router();
router.use(requireStaff);

/* ============ 概览统计（admin + assessor） ============ */
router.get('/stats', (req, res) => {
  const now = Date.now();
  const day = 86400000;
  const users = db.users.filter((u) => !u.deleted);
  const claims = db.claims;
  const appeals = db.appeals;
  const logs = db.logs;

  const days = [];
  for (let i = 13; i >= 0; i -= 1) {
    const d = new Date(now - i * day);
    const key = timeBucket(d.getTime());
    days.push({
      date: key,
      label: key.slice(5),
      users: users.filter((u) => timeBucket(new Date(u.createdAt).getTime()) === key).length,
      claims: claims.filter((c) => timeBucket(new Date(c.createdAt).getTime()) === key).length,
      approved: claims.filter((c) => c.reviewedAt && timeBucket(new Date(c.reviewedAt).getTime()) === key && c.status === 'approved').length,
      rejected: claims.filter((c) => c.reviewedAt && timeBucket(new Date(c.reviewedAt).getTime()) === key && c.status === 'rejected').length,
      appeals: appeals.filter((a) => timeBucket(new Date(a.createdAt).getTime()) === key).length,
      visits: logs.filter((l) => timeBucket(l.ts) === key).length,
    });
  }

  const searchMap = {};
  for (const s of db.searches) searchMap[s.q] = (searchMap[s.q] || 0) + 1;
  const topSearches = Object.entries(searchMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([q, count]) => ({ q, count }));

  const approvedClaims = claims.filter((c) => c.status === 'approved');
  const avgReview = approvedClaims.length
    ? Math.round(
        approvedClaims.reduce((sum, c) => sum + (new Date(c.reviewedAt) - new Date(c.createdAt)), 0) /
          approvedClaims.length /
          3600000,
      )
    : 0;

  const mine = (list) => list.filter((x) => x.reviewedBy === req.user.id).length;

  res.json({
    cards: {
      users: users.length,
      activeUsers: users.filter((u) => u.status === 'active').length,
      banned: users.filter((u) => u.status === 'banned').length,
      assessors: users.filter((u) => u.role === 'assessor').length,
      newUsers7d: users.filter((u) => now - new Date(u.createdAt).getTime() < 7 * day).length,
      names: db.names.filter((n) => n.status !== 'hidden').length,
      pending: claims.filter((c) => c.status === 'pending').length,
      approved: approvedClaims.length,
      rejected: claims.filter((c) => c.status === 'rejected').length,
      appeals: appeals.length,
      appealsPending: appeals.filter((a) => a.status === 'pending').length,
      visits: logs.length,
      visits24h: logs.filter((l) => now - l.ts < day).length,
      passRate: claims.length ? Math.round((approvedClaims.length / claims.length) * 100) : 0,
      avgReviewHours: avgReview,
      searches: db.searches.length,
      myReviewed: mine(claims) + mine(appeals),
      blockedIps: (db.security?.blockedIps || []).length,
      tempBlocked: (db.security?.tempBlocks || []).filter((b) => b.until > now).length,
    },
    role: req.user.role,
    trend: days,
    topSearches,
    recentLogs: db.logs.slice(0, 8),
    recentClaims: claims.filter((c) => c.status === 'pending').slice(0, 5).map((c) => shapeClaim(c, { withUser: true })),
    recentAppeals: appeals.filter((a) => a.status === 'pending').slice(0, 5).map((a) => shapeAppeal(a, { withUser: true })),
  });
});

/* ============ 归属申请审核 ============ */

/**
 * 审核通过单个归属申请（单条审核与批量审核共用）
 * 统一处理：材料哈希校验、冲突检查、用户统计、重复申请自动驳回、通知。
 * 返回 { ok, status, error, code, failed, name, autoRejected }
 */
function approveClaimRecord(req, claim, note = '') {
  if (!claim) return { ok: false, status: 404, error: '申请不存在' };
  if (claim.status !== 'pending') return { ok: false, status: 400, error: '该申请已处理，请勿重复操作' };

  // 防篡改：审核前核对材料哈希，若文件被替换则阻断并告警
  const integrity = verifyImageRecords(claim.images);
  if (!integrity.ok) {
    eventLog(
      req,
      '材料完整性校验失败，已阻断审核',
      `${claim.name} · ${JSON.stringify(integrity.failed).slice(0, 120)}`,
      'error',
    );
    return {
      ok: false,
      status: 409,
      code: 'INTEGRITY_FAILED',
      error: '材料文件校验失败（可能已被替换或损坏），请驳回并要求重新上传',
      failed: integrity.failed,
    };
  }

  const owner = findUserById(claim.userId);
  if (!owner || owner.deleted) return { ok: false, status: 404, error: '申请用户不存在' };
  // 封禁账号不允许获得圈名归属，否则封禁形同虚设
  if (owner.status === 'banned') {
    return { ok: false, status: 409, code: 'OWNER_BANNED', error: '申请用户已被封禁，无法通过审核，请驳回该申请' };
  }

  // 数据库 names(name) 有唯一索引，hidden 记录同样占用名称，必须一并检查
  const conflict = db.names.find((n) => n.name.toLowerCase() === claim.name.toLowerCase());
  if (conflict) return { ok: false, status: 409, error: '该圈名已被绑定，请先处理已有绑定' };

  const now = new Date().toISOString();
  const nameRecord = {
    id: uid('n_'),
    name: claim.name,
    description: claim.description || '',
    tags: [],
    ownerId: claim.userId,
    status: 'active',
    createdAt: now,
    approvedAt: now,
    views: 0,
    claimId: claim.id,
    reviewerId: req.user.id,
  };
  db.names.unshift(nameRecord);

  claim.status = 'approved';
  claim.reviewedAt = now;
  claim.reviewedBy = req.user.id;
  claim.reviewerName = req.user.nickname;
  claim.reviewNote = note;
  claim.rejectReason = '';
  claim.nameId = nameRecord.id;
  claim.updatedAt = now;
  claim.history = claim.history || [];
  claim.history.push({ at: now, action: 'approve', note: note || '审核通过', by: req.user.nickname });

  owner.stats = owner.stats || { claims: 0, approved: 0, rejected: 0 };
  owner.stats.approved = (owner.stats.approved || 0) + 1;

  const others = db.claims.filter(
    (c) => c.id !== claim.id && c.status === 'pending' && c.name.toLowerCase() === claim.name.toLowerCase(),
  );
  for (const other of others) {
    other.status = 'rejected';
    other.rejectReason = '该圈名已由其他用户完成绑定，如为本人的圈名请加入交流群申诉';
    other.reviewedAt = now;
    other.reviewedBy = req.user.id;
    other.reviewerName = req.user.nickname;
    other.updatedAt = now;
    notifyUser(other.userId, {
      category: 'review',
      level: 'warning',
      title: `圈名「${other.name}」归属申请未通过`,
      content: other.rejectReason,
      link: '/me?tab=claims',
      meta: { claimId: other.id },
    });
  }

  notifyUser(owner.id, {
    category: 'review',
    level: 'success',
    title: `圈名「${claim.name}」归属审核已通过`,
    content: `恭喜！你提交的圈名归属申请已通过审核，圈名已绑定到你的账号，并已展示在圈名广场。${note ? `管理员备注：${note}` : ''}`,
    link: '/me?tab=names',
    meta: { claimId: claim.id, nameId: nameRecord.id },
  });

  return { ok: true, claim, name: nameRecord, autoRejected: others.length };
}

router.get('/claims', requirePermission('review'), (req, res) => {
  const { status = 'all', q = '', page = 1, pageSize = 10 } = req.query;
  const keyword = String(q).trim().toLowerCase();
  let list = [...db.claims];
  if (status !== 'all') list = list.filter((c) => c.status === status);
  if (keyword) {
    list = list.filter((c) => {
      const user = findUserById(c.userId);
      return (
        c.name.toLowerCase().includes(keyword) ||
        (user?.email || '').toLowerCase().includes(keyword) ||
        (user?.nickname || '').toLowerCase().includes(keyword)
      );
    });
  }
  const order = { pending: 0, approved: 1, rejected: 2 };
  list.sort((a, b) => {
    if (a.status !== b.status) return order[a.status] - order[b.status];
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  const result = paginate(list, page, pageSize);
  res.json({
    ...result,
    items: result.items.map((c) => shapeClaim(c, { withUser: true })),
    counts: {
      all: db.claims.length,
      pending: db.claims.filter((c) => c.status === 'pending').length,
      approved: db.claims.filter((c) => c.status === 'approved').length,
      rejected: db.claims.filter((c) => c.status === 'rejected').length,
    },
  });
});

router.get('/claims/:id', requirePermission('review'), (req, res) => {
  const claim = db.claims.find((c) => c.id === req.params.id);
  if (!claim) return res.status(404).json({ error: '申请不存在' });
  res.json({ claim: shapeClaim(claim, { withUser: true }) });
});

router.post('/claims/:id/approve', requirePermission('review'), (req, res) => {
  const claim = db.claims.find((c) => c.id === req.params.id);
  const note = String(req.body?.note || '').slice(0, 300);
  const result = approveClaimRecord(req, claim, note);
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error, code: result.code, failed: result.failed });
  }

  save();
  eventLog(req, '审核通过圈名归属', `${claim.name} · ${findUserById(claim.userId)?.email || ''}`);
  res.json({
    ok: true,
    claim: shapeClaim(claim, { withUser: true }),
    name: shapeName(result.name),
    autoRejected: result.autoRejected,
  });
});

router.post('/claims/:id/reject', requirePermission('review'), (req, res) => {
  const claim = db.claims.find((c) => c.id === req.params.id);
  if (!claim) return res.status(404).json({ error: '申请不存在' });
  if (claim.status !== 'pending') return res.status(400).json({ error: '该申请已处理，请勿重复操作' });

  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 2) return res.status(400).json({ error: '请填写拒绝理由（至少 2 个字），用户将看到该理由' });
  if (reason.length > 300) return res.status(400).json({ error: '拒绝理由请控制在 300 字以内' });

  const now = new Date().toISOString();
  claim.status = 'rejected';
  claim.rejectReason = reason;
  claim.reviewedAt = now;
  claim.reviewedBy = req.user.id;
  claim.reviewerName = req.user.nickname;
  claim.updatedAt = now;
  claim.history = claim.history || [];
  claim.history.push({ at: now, action: 'reject', note: reason, by: req.user.nickname });

  const owner = findUserById(claim.userId);
  if (owner) {
    owner.stats = owner.stats || { claims: 0, approved: 0, rejected: 0 };
    owner.stats.rejected = (owner.stats.rejected || 0) + 1;
    notifyUser(owner.id, {
      category: 'review',
      level: 'danger',
      title: `圈名「${claim.name}」归属申请被驳回`,
      content: `驳回理由：${reason}\n你可以补充材料后重新提交，或加入交流群与管理员沟通。`,
      link: '/me?tab=claims',
      meta: { claimId: claim.id },
    });
  }
  save();

  eventLog(req, '驳回圈名归属', `${claim.name} · ${reason.slice(0, 40)}`);
  res.json({ ok: true, claim: shapeClaim(claim, { withUser: true }) });
});

router.post('/claims/batch', requirePermission('review'), (req, res) => {
  const { ids = [], action, reason = '' } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '请选择要处理的申请' });
  if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: '未知操作' });
  if (action === 'reject' && String(reason).trim().length < 2) {
    return res.status(400).json({ error: '批量驳回需要填写拒绝理由' });
  }
  let done = 0;
  let skipped = 0;
  let integrityBlocked = 0;
  const now = new Date().toISOString();
  for (const id of ids) {
    const claim = db.claims.find((c) => c.id === id);
    if (!claim || claim.status !== 'pending') {
      skipped += 1;
      continue;
    }
    if (action === 'reject') {
      claim.status = 'rejected';
      claim.rejectReason = String(reason).trim().slice(0, 300);
      claim.reviewedAt = now;
      claim.reviewedBy = req.user.id;
      claim.reviewerName = req.user.nickname;
      claim.updatedAt = now;
      const owner = findUserById(claim.userId);
      if (owner) {
        owner.stats = owner.stats || { claims: 0, approved: 0, rejected: 0 };
        owner.stats.rejected = (owner.stats.rejected || 0) + 1;
      }
      notifyUser(claim.userId, {
        category: 'review',
        level: 'danger',
        title: `圈名「${claim.name}」归属申请被驳回`,
        content: `驳回理由：${claim.rejectReason}`,
        link: '/me?tab=claims',
      });
      done += 1;
    } else {
      // 与单条审核共用同一套校验：材料哈希、冲突、统计、重复申请自动驳回
      const result = approveClaimRecord(req, claim);
      if (!result.ok) {
        skipped += 1;
        if (result.code === 'INTEGRITY_FAILED') integrityBlocked += 1;
        continue;
      }
      done += 1;
    }
  }
  save();
  eventLog(
    req,
    action === 'approve' ? '批量通过圈名归属' : '批量驳回圈名归属',
    `成功 ${done} 条 / 跳过 ${skipped} 条${integrityBlocked ? ` / 材料校验失败 ${integrityBlocked} 条` : ''}`,
  );
  res.json({ ok: true, done, skipped, integrityBlocked });
});

/* ============ 申诉审核 ============ */
router.get('/appeals', requirePermission('appeal'), (req, res) => {
  const { status = 'all', q = '', page = 1, pageSize = 10 } = req.query;
  const keyword = String(q).trim().toLowerCase();
  let list = [...db.appeals];
  if (status !== 'all') list = list.filter((a) => a.status === status);
  if (keyword) {
    list = list.filter((a) => {
      const user = findUserById(a.userId);
      const owner = findUserById(a.ownerId);
      return (
        (a.name || '').toLowerCase().includes(keyword) ||
        (user?.email || '').toLowerCase().includes(keyword) ||
        (owner?.email || '').toLowerCase().includes(keyword)
      );
    });
  }
  const order = { pending: 0, approved: 1, rejected: 2 };
  list.sort((a, b) => {
    if (a.status !== b.status) return order[a.status] - order[b.status];
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
  const result = paginate(list, page, pageSize);
  res.json({
    ...result,
    items: result.items.map((a) => shapeAppeal(a, { withUser: true })),
    counts: {
      all: db.appeals.length,
      pending: db.appeals.filter((a) => a.status === 'pending').length,
      approved: db.appeals.filter((a) => a.status === 'approved').length,
      rejected: db.appeals.filter((a) => a.status === 'rejected').length,
    },
    reasons: db.appeals.map((a) => a.reason),
  });
});

/** 通过申诉：转移归属 + 通知原归属账号 */
router.post('/appeals/:id/approve', requirePermission('appeal'), (req, res) => {
  const appeal = db.appeals.find((a) => a.id === req.params.id);
  if (appeal && appeal.status === 'pending') {
    const integrity = verifyImageRecords(appeal.images);
    if (!integrity.ok) {
      eventLog(
        req,
        '申诉材料完整性校验失败，已阻断审核',
        `${appeal.name} · ${JSON.stringify(integrity.failed).slice(0, 120)}`,
        'error',
      );
      return res.status(409).json({
        error: '申诉材料校验失败（可能已被替换或损坏），请驳回并要求重新上传',
        code: 'INTEGRITY_FAILED',
        failed: integrity.failed,
      });
    }
  }
  if (!appeal) return res.status(404).json({ error: '申诉不存在' });
  if (appeal.status !== 'pending') return res.status(400).json({ error: '该申诉已处理，请勿重复操作' });

  const name = db.names.find((n) => n.id === appeal.nameId);
  if (!name) return res.status(404).json({ error: '对应圈名已不存在，无法转移归属' });

  const appellant = findUserById(appeal.userId);
  const previousOwner = findUserById(name.ownerId);
  if (!appellant || appellant.deleted) return res.status(404).json({ error: '申诉用户不存在' });
  if (appellant.status === 'banned') {
    return res.status(409).json({ error: '申诉用户已被封禁，无法转移圈名归属，请驳回该申诉' });
  }

  const now = new Date().toISOString();
  const note = String(req.body?.note || '').slice(0, 300);
  const previousOwnerId = name.ownerId;
  const previousOwnerNickname = previousOwner?.nickname || '原归属用户';

  // 转移归属
  name.ownerId = appeal.userId;
  name.approvedAt = now;
  name.transferredAt = now;
  name.transferCount = (name.transferCount || 0) + 1;
  name.history = name.history || [];
  name.history.push({
    at: now,
    action: 'transfer',
    note: `归属由「${previousOwnerNickname}」转移至「${appellant.nickname}」`,
    by: req.user.nickname,
    appealId: appeal.id,
  });

  appeal.status = 'approved';
  appeal.transfer = true;
  appeal.reviewedAt = now;
  appeal.reviewedBy = req.user.id;
  appeal.reviewerName = req.user.nickname;
  appeal.reviewNote = note;
  appeal.updatedAt = now;
  appeal.history = appeal.history || [];
  appeal.history.push({ at: now, action: 'approve', note: note || '申诉通过，归属已转移', by: req.user.nickname });

  // 同圈名其它待审申诉自动驳回
  const others = db.appeals.filter((a) => a.id !== appeal.id && a.nameId === name.id && a.status === 'pending');
  for (const other of others) {
    other.status = 'rejected';
    other.rejectReason = '该圈名归属已通过其它申诉完成转移';
    other.reviewedAt = now;
    other.reviewedBy = req.user.id;
    other.reviewerName = req.user.nickname;
    other.updatedAt = now;
    notifyUser(other.userId, {
      category: 'appeal',
      level: 'warning',
      title: `你对圈名「${name.name}」的申诉未通过`,
      content: '该圈名归属已通过其它申诉完成转移，如仍有异议请加入交流群联系管理员。',
      link: '/me?tab=appeals',
    });
  }
  save();

  // 通知新归属者
  notifyUser(appellant.id, {
    category: 'appeal',
    level: 'success',
    title: `申诉成功：圈名「${name.name}」已归你所有`,
    content: `你对圈名「${name.name}」提交的归属申诉已通过审核，圈名归属已转移至你的账号。${note ? `管理员备注：${note}` : ''}`,
    link: `/names/${name.id}`,
    meta: { appealId: appeal.id, nameId: name.id },
  });

  // 通知原归属账号
  if (previousOwner) {
    notifyUser(previousOwner.id, {
      category: 'appeal',
      level: 'danger',
      title: `圈名「${name.name}」的归属已转移`,
      content: `你的圈名「${name.name}」因归属申诉审核通过，已转移至用户「${appellant.nickname}」。原因：${appeal.reason}。${note ? `管理员备注：${note}` : ''} 如对结果有异议，请加入交流群联系管理员。`,
      link: `/names/${name.id}`,
      meta: { appealId: appeal.id, nameId: name.id, previousOwnerId },
    });
  }

  eventLog(req, '申诉通过并转移圈名归属', `${name.name}：${previousOwnerNickname} → ${appellant.email}`);
  res.json({ ok: true, appeal: shapeAppeal(appeal, { withUser: true }), name: shapeName(name), autoRejected: others.length });
});

router.post('/appeals/:id/reject', requirePermission('appeal'), (req, res) => {
  const appeal = db.appeals.find((a) => a.id === req.params.id);
  if (!appeal) return res.status(404).json({ error: '申诉不存在' });
  if (appeal.status !== 'pending') return res.status(400).json({ error: '该申诉已处理，请勿重复操作' });

  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 2) return res.status(400).json({ error: '请填写驳回理由（至少 2 个字）' });
  if (reason.length > 300) return res.status(400).json({ error: '驳回理由请控制在 300 字以内' });

  const now = new Date().toISOString();
  appeal.status = 'rejected';
  appeal.rejectReason = reason;
  appeal.reviewedAt = now;
  appeal.reviewedBy = req.user.id;
  appeal.reviewerName = req.user.nickname;
  appeal.updatedAt = now;
  appeal.history = appeal.history || [];
  appeal.history.push({ at: now, action: 'reject', note: reason, by: req.user.nickname });
  save();

  notifyUser(appeal.userId, {
    category: 'appeal',
    level: 'danger',
    title: `你对圈名「${appeal.name}」的申诉被驳回`,
    content: `驳回理由：${reason}\n你可以补充材料后重新提交，或加入交流群与管理员沟通。`,
    link: '/me?tab=appeals',
    meta: { appealId: appeal.id },
  });

  eventLog(req, '驳回圈名归属申诉', `${appeal.name} · ${reason.slice(0, 40)}`);
  res.json({ ok: true, appeal: shapeAppeal(appeal, { withUser: true }) });
});

/* ============ 子路由：用户/圈名/日志、系统设置 ============ */
router.use(manageRoutes);
router.use(systemRoutes);

export default router;
