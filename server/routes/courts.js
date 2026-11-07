import express from 'express';
import { db, save, uid, publicUser } from '../lib/db.js';
import { attachUser, requireAuth, requirePermission } from '../lib/auth.js';
import { sanitizeText, paginate, clientIp } from '../lib/util.js';
import { eventLog } from '../lib/logger.js';
import { notifyUser } from '../lib/notify.js';
import { upload, fileRecord } from '../lib/upload.js';

const router = express.Router();

/** 投票时长选项（小时） */
export const VOTE_DURATIONS = [24, 48, 72, 168];
/** 每方最多提交的材料轮数 */
const MAX_ROUNDS = 6;

export function shapeCourt(c, { withDetail = false, viewerId = null } = {}) {
  const claimant = db.users.find((u) => u.id === c.claimantId);
  const respondent = c.respondentId ? db.users.find((u) => u.id === c.respondentId) : null;
  const votes = db.courtVotes.filter((v) => v.courtId === c.id);
  const claimantVotes = votes.filter((v) => v.side === 'claimant').length;
  const respondentVotes = votes.filter((v) => v.side === 'respondent').length;

  const base = {
    id: c.id,
    nameId: c.nameId,
    nameText: c.nameText,
    status: c.status,
    createdAt: c.createdAt,
    startedAt: c.startedAt || null,
    votingEndsAt: c.votingEndsAt || null,
    closedAt: c.closedAt || null,
    winnerId: c.winnerId || null,
    verdict: c.verdict || null,
    verdictReason: c.verdictReason || '',
    judgedBy: c.judgedBy || null,
    claimant: claimant
      ? { id: claimant.id, nickname: claimant.nickname, avatarUrl: claimant.avatarUrl || '', avatarHue: claimant.avatarHue, title: claimant.title || '' }
      : null,
    respondent: respondent
      ? { id: respondent.id, nickname: respondent.nickname, avatarUrl: respondent.avatarUrl || '', avatarHue: respondent.avatarHue, title: respondent.title || '' }
      : null,
    votes: {
      claimant: claimantVotes,
      respondent: respondentVotes,
      total: votes.length,
    },
    // 当前访问者的身份与投票状态
    viewer: viewerId
      ? {
          isClaimant: viewerId === c.claimantId,
          isRespondent: viewerId === c.respondentId,
          votedSide: votes.find((v) => v.userId === viewerId)?.side || null,
        }
      : null,
  };

  if (!withDetail) return base;

  const statements = db.courtStatements
    .filter((s) => s.courtId === c.id)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .map((s) => {
      const u = db.users.find((x) => x.id === s.userId);
      return {
        id: s.id,
        side: s.side,
        round: s.round,
        content: s.content,
        images: s.images || [],
        createdAt: s.createdAt,
        user: u ? { id: u.id, nickname: u.nickname, avatarHue: u.avatarHue, avatarUrl: u.avatarUrl || '' } : null,
      };
    });

  return {
    ...base,
    statements,
    voteDetails: votes
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((v) => {
        const u = db.users.find((x) => x.id === v.userId);
        return {
          id: v.id,
          side: v.side,
          reason: v.reason,
          createdAt: v.createdAt,
          user: u ? { id: u.id, nickname: u.nickname, avatarHue: u.avatarHue, avatarUrl: u.avatarUrl || '' } : null,
        };
      }),
  };
}

/** 用户是否被允许参与投票（管理员封禁 courtPermission 后不可投） */
function canVote(u) {
  if (!u) return { ok: false, error: '请先登录后再投票' };
  if (u.status === 'banned') return { ok: false, error: '账号已被封禁，无法参与投票' };
  if (u.courtPermission === false) {
    return { ok: false, error: '你的小法庭投票权限已被管理员收回，如有疑问请联系管理员' };
  }
  return { ok: true };
}

/* ---------------- 列表（登录可见） ---------------- */
router.get('/', attachUser, (req, res) => {
  if (!req.user) return res.status(401).json({ error: '请先登录后再访问小法庭' });
  const { status = 'all', page = 1, pageSize = 10 } = req.query;

  let list = [...db.courts];
  if (status !== 'all') list = list.filter((c) => c.status === status);

  // 进行中的优先，其次按时间倒序
  const order = { voting: 0, running: 1, pending: 2, closed: 3 };
  list.sort((a, b) => (order[a.status] - order[b.status]) || (new Date(b.createdAt) - new Date(a.createdAt)));

  const result = paginate(list, page, pageSize);
  res.json({
    ...result,
    items: result.items.map((c) => shapeCourt(c, { viewerId: req.user.id })),
    counts: {
      all: db.courts.length,
      voting: db.courts.filter((c) => c.status === 'voting').length,
      running: db.courts.filter((c) => c.status === 'running').length,
      closed: db.courts.filter((c) => c.status === 'closed').length,
    },
    canVote: req.user.courtPermission !== false && req.user.status !== 'banned',
  });
});

/* ---------------- 详情 ---------------- */
router.get('/:id', attachUser, (req, res) => {
  if (!req.user) return res.status(401).json({ error: '请先登录后再访问小法庭' });
  const c = db.courts.find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: '小法庭不存在' });
  res.json({ court: shapeCourt(c, { withDetail: true, viewerId: req.user.id }) });
});

/* ---------------- 发起小法庭 ----------------
 * 规则：
 * - 必须在**人工归属申诉判决之后**发起
 * - 只有**未获得归属权**的一方（申诉被驳回者）可发起；胜诉方无需也不能申请
 * - 同一申诉只能发起一次
 * - 若该用户曾在小法庭败诉，则永久禁止再申诉该圈名
 */
router.post('/', requireAuth, (req, res) => {
  const { appealId } = req.body || {};
  const appeal = db.appeals.find((a) => a.id === appealId);
  if (!appeal) return res.status(404).json({ error: '申诉不存在' });

  if (appeal.status === 'pending') {
    return res.status(400).json({ error: '该申诉尚在人工审核中，判决后才能申请小法庭' });
  }
  if (appeal.status !== 'rejected' || appeal.userId !== req.user.id) {
    return res.status(403).json({
      error: '只有申诉被驳回的一方可以申请小法庭介入；已获得归属权的无需申请',
    });
  }
  if (db.courts.some((c) => c.appealId === appealId)) {
    return res.status(409).json({ error: '该申诉已进入小法庭流程，不能重复发起' });
  }

  const name = db.names.find((n) => n.id === appeal.nameId);
  if (!name) return res.status(404).json({ error: '圈名不存在' });

  const banned = (db.nameBans || []).find((b) => b.userId === req.user.id && b.nameId === name.id);
  if (banned) {
    return res.status(403).json({
      error: `你在小法庭中未能获得圈名「${name.name}」的归属，已永久禁止再次申诉该圈名`,
      code: 'NAME_APPEAL_BANNED',
    });
  }

  const now = new Date().toISOString();
  const court = {
    id: uid('ct_'),
    nameId: name.id,
    nameText: name.name,
    appealId,
    claimantId: req.user.id,
    respondentId: name.ownerId || null,
    status: 'running',
    startedAt: now,
    votingEndsAt: null,
    closedAt: null,
    winnerId: null,
    verdict: null,
    verdictReason: '',
    judgedBy: null,
    createdAt: now,
    durationHours: 48,
    deadlineSetBy: null,
  };
  db.courts.unshift(court);
  save('courts');

  eventLog(req, '发起小法庭', `${name.name} · 申诉被驳回后申请`);

  if (court.respondentId) {
    notifyUser(court.respondentId, {
      category: 'system',
      level: 'warning',
      title: `圈名「${name.name}」进入小法庭`,
      content: '对方在人工申诉被驳回后申请小法庭介入。你是当前归属方，请进入小法庭提交你的材料与理由。',
      link: `/court/${court.id}`,
    });
  }

  res.status(201).json({ court: shapeCourt(court, { viewerId: req.user.id }) });
});

/* ---------------- 管理员开启投票（截止时间仅管理员可设） ---------------- */
router.post('/:id/start', requireAuth, requirePermission('appeal'), (req, res) => {
  const c = db.courts.find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: '小法庭不存在' });
  if (c.status !== 'running') return res.status(400).json({ error: '当前状态无法开启投票' });

  const sides = new Set(db.courtStatements.filter((s) => s.courtId === c.id).map((s) => s.side));
  if (!sides.has('claimant') || !sides.has('respondent')) {
    return res.status(400).json({ error: '双方都需至少提交一次材料后才能开启投票' });
  }

  const hours = Number(req.body?.durationHours);
  if (!VOTE_DURATIONS.includes(hours)) {
    return res.status(400).json({
      error: `请设置投票时长，可选：${VOTE_DURATIONS.map((h) => h + '小时').join(' / ')}`,
      allowed: VOTE_DURATIONS,
    });
  }

  c.status = 'voting';
  c.durationHours = hours;
  c.deadlineSetBy = req.user.nickname;
  c.votingEndsAt = new Date(Date.now() + hours * 3600_000).toISOString();
  save('courts');

  for (const target of [c.claimantId, c.respondentId].filter(Boolean)) {
    notifyUser(target, {
      category: 'system',
      level: 'info',
      title: `小法庭「${c.nameText}」开始投票`,
      content: `管理员已设置投票时长为 ${hours} 小时，截止后按票数自动判定归属。`,
      link: `/court/${c.id}`,
    });
  }

  eventLog(req, '小法庭开启投票', `${c.nameText} · ${hours}小时`);
  res.json({ court: shapeCourt(c, { viewerId: req.user.id }) });
});

/* ---------------- 提交材料（轮番） ---------------- */
router.post('/:id/statements', requireAuth, upload.array('images', 4), (req, res) => {
  const c = db.courts.find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: '小法庭不存在' });

  const isClaimant = c.claimantId === req.user.id;
  const isRespondent = c.respondentId === req.user.id;
  if (!isClaimant && !isRespondent) return res.status(403).json({ error: '只有争议双方可以提交材料' });
  if (!['running', 'voting'].includes(c.status)) return res.status(400).json({ error: '当前状态无法提交材料' });

  const side = isClaimant ? 'claimant' : 'respondent';
  const mine = db.courtStatements.filter((s) => s.courtId === c.id && s.side === side);
  if (mine.length >= MAX_ROUNDS) {
    return res.status(400).json({ error: `每方最多提交 ${MAX_ROUNDS} 次材料` });
  }

  const content = sanitizeText(req.body?.content, 3000);
  const images = req.files?.length ? req.files.map(fileRecord) : [];
  if (content.length < 5 && images.length === 0) {
    return res.status(400).json({ error: '请填写理由或上传材料图片' });
  }

  const record = {
    id: uid('cs_'),
    courtId: c.id,
    userId: req.user.id,
    side,
    round: mine.length + 1,
    content,
    images,
    createdAt: new Date().toISOString(),
  };
  db.courtStatements.push(record);
  save('court_statements');

  eventLog(req, '小法庭提交材料', `${c.nameText} · ${side} 第${record.round}轮`);

  // 通知对方有新材料
  const otherId = isClaimant ? c.respondentId : c.claimantId;
  if (otherId) {
    notifyUser(otherId, {
      category: 'system',
      level: 'info',
      title: `小法庭「${c.nameText}」有新材料`,
      content: `${req.user.nickname} 提交了第 ${record.round} 轮材料，请及时查看并回应。`,
      link: `/court/${c.id}`,
    });
  }

  res.status(201).json({ court: shapeCourt(c, { withDetail: true, viewerId: req.user.id }) });
});

/* ---------------- 投票 ---------------- */
router.post('/:id/vote', requireAuth, (req, res) => {
  const c = db.courts.find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: '小法庭不存在' });
  if (c.status !== 'voting') return res.status(400).json({ error: '当前不在投票阶段' });
  if (c.votingEndsAt && Date.now() > new Date(c.votingEndsAt).getTime()) {
    return res.status(400).json({ error: '投票已结束' });
  }

  // 争议双方不可投票
  if (c.claimantId === req.user.id || c.respondentId === req.user.id) {
    return res.status(403).json({ error: '争议双方不能参与投票' });
  }

  const allowed = canVote(req.user);
  if (!allowed.ok) return res.status(403).json({ error: allowed.error });

  const { side, reason = '' } = req.body || {};
  if (!['claimant', 'respondent'].includes(side)) {
    return res.status(400).json({ error: '请选择支持的一方' });
  }

  const safeReason = sanitizeText(reason, 300);
  if (safeReason.length < 2) return res.status(400).json({ error: '请填写支持理由（至少 2 个字）' });

  const existing = db.courtVotes.find((v) => v.courtId === c.id && v.userId === req.user.id);
  if (existing) {
    existing.side = side;
    existing.reason = safeReason;
  } else {
    db.courtVotes.push({
      id: uid('cv_'),
      courtId: c.id,
      userId: req.user.id,
      side,
      reason: safeReason,
      createdAt: new Date().toISOString(),
    });
  }
  save('court_votes');
  eventLog(req, '小法庭投票', `${c.nameText} · 支持${side === 'claimant' ? '主张方' : '应诉方'}`);

  res.json({ court: shapeCourt(c, { withDetail: true, viewerId: req.user.id }) });
});

/* ---------------- 结算（自动） ---------------- */
export function settleCourt(courtId, { by = 'system' } = {}) {
  const c = db.courts.find((x) => x.id === courtId);
  if (!c || c.status !== 'voting') return null;

  const votes = db.courtVotes.filter((v) => v.courtId === c.id);
  const claim = votes.filter((v) => v.side === 'claimant').length;
  const respond = votes.filter((v) => v.side === 'respondent').length;

  let winnerId = null;
  let reason = '';
  if (claim > respond) {
    winnerId = c.claimantId;
    reason = `主张方以 ${claim}:${respond} 胜出`;
  } else if (respond > claim) {
    winnerId = c.respondentId;
    reason = `应诉方以 ${respond}:${claim} 胜出`;
  } else {
    reason = `双方 ${claim}:${respond} 平票，维持原归属`;
    winnerId = c.respondentId;
  }

  c.status = 'closed';
  c.closedAt = new Date().toISOString();
  c.winnerId = winnerId;
  c.verdict = by;
  c.verdictReason = reason;
  save('courts');

  applyVerdict(c);
  return c;
}

/** 将判决结果落到圈名归属 */
function applyVerdict(c) {
  const name = db.names.find((n) => n.id === c.nameId);
  if (!name || !c.winnerId) return;

  // 仅在胜出方变化时才转移归属；但下面的「败诉禁令」必须始终执行
  if (name.ownerId !== c.winnerId) {
    const prev = db.users.find((u) => u.id === name.ownerId);
    const next = db.users.find((u) => u.id === c.winnerId);
    name.ownerId = c.winnerId;
    name.transferCount = (name.transferCount || 0) + 1;
    name.history = name.history || [];
    name.history.push({
      at: new Date().toISOString(),
      action: 'court',
      note: `小法庭判决归属：${prev?.nickname || '—'} → ${next?.nickname || '—'}`,
      by: '小法庭',
    });
    save('names');

    if (next) {
      notifyUser(next.id, {
        category: 'system',
        level: 'success',
        title: `小法庭判决：圈名「${name.name}」归你所有`,
        content: c.verdictReason,
        link: `/names/${name.id}`,
      });
    }
    if (prev && prev.id !== c.winnerId) {
      notifyUser(prev.id, {
        category: 'system',
        level: 'warning',
        title: `小法庭判决：圈名「${name.name}」归属变更`,
        content: c.verdictReason,
        link: `/court/${c.id}`,
      });
    }
  }

  // 小法庭落败的申诉方：永久禁止再申诉该圈名（不可撤销）
  const loserId = c.winnerId === c.claimantId ? c.respondentId : c.claimantId;
  if (loserId && loserId === c.claimantId) {
    const exists = (db.nameBans || []).find((b) => b.userId === loserId && b.nameId === name.id);
    if (!exists) {
      db.nameBans = db.nameBans || [];
      db.nameBans.push({
        id: uid('nb_'),
        userId: loserId,
        nameId: name.id,
        courtId: c.id,
        reason: `小法庭败诉（${c.verdictReason}）`,
        createdAt: new Date().toISOString(),
      });
      save('name_bans');

      notifyUser(loserId, {
        category: 'appeal',
        level: 'danger',
        title: `已永久禁止申诉圈名「${name.name}」`,
        content: `你在小法庭中未能获得该圈名归属（${c.verdictReason}）。根据规则，你将永久无法再申诉该圈名。`,
        link: `/names/${name.id}`,
      });
    }
  }
}

/* ---------------- 管理员改判 ---------------- */
router.post('/:id/override', requireAuth, requirePermission('appeal'), (req, res) => {
  const c = db.courts.find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: '小法庭不存在' });
  if (c.status !== 'closed') return res.status(400).json({ error: '只能对已结案的判决改判' });

  const { winnerId, reason } = req.body || {};
  if (![c.claimantId, c.respondentId].includes(winnerId)) {
    return res.status(400).json({ error: '胜出方必须是争议双方之一' });
  }
  const safeReason = sanitizeText(reason, 500);
  if (safeReason.length < 2) return res.status(400).json({ error: '请填写改判理由' });

  c.winnerId = winnerId;
  c.verdict = 'admin';
  c.verdictReason = safeReason;
  c.judgedBy = req.user.nickname;
  save('courts');

  applyVerdict(c);
  eventLog(req, '小法庭改判', `${c.nameText} → ${winnerId}`);

  res.json({ court: shapeCourt(c, { withDetail: true, viewerId: req.user.id }) });
});

/* ---------------- 管理员：立即结算所有到期案件 ---------------- */
router.post('/admin/settle-expired', requireAuth, requirePermission('appeal'), (req, res) => {
  const now = Date.now();
  // 补充：把已过期但仍是 voting 的案件一并结算
  const expired = db.courts.filter(
    (c) => c.status === 'voting' && c.votingEndsAt && new Date(c.votingEndsAt).getTime() <= now,
  );
  const settled = [];
  for (const c of expired) {
    const r = settleCourt(c.id, { by: 'votes' });
    if (r) settled.push({ id: r.id, nameText: r.nameText, winnerId: r.winnerId, reason: r.verdictReason });
  }
  if (settled.length) eventLog(req, '手动结算小法庭', `${settled.length} 个案件`);
  res.json({ ok: true, settled, checked: db.courts.filter((c) => c.status === 'voting').length });
});

/* ---------------- 我的小法庭 ---------------- */
router.get('/mine/list', requireAuth, (req, res) => {
  const items = db.courts
    .filter((c) => c.claimantId === req.user.id || c.respondentId === req.user.id)
    .map((c) => shapeCourt(c, { viewerId: req.user.id }));
  res.json({ items });
});

export default router;
