import express from 'express';
import { db } from '../lib/db.js';
import { insertSearch, incrementNameViews, pruneSearches } from '../lib/repo.js';
import { paginate } from '../lib/util.js';

const router = express.Router();

/** 搜索写入计数，用于周期性清理旧记录 */
let searchWriteCount = 0;

export function shapeName(n, { withEvidence = false } = {}) {
  const owner = db.users.find((u) => u.id === n.ownerId);

  // 归属证明材料：来自该圈名对应的通过审核的申请记录
  let evidence = [];
  if (withEvidence) {
    const claim =
      (n.claimId && db.claims.find((c) => c.id === n.claimId)) ||
      db.claims.find((c) => c.nameId === n.id && c.status === 'approved') ||
      null;
    evidence = Array.isArray(claim?.images) ? claim.images : [];
  }

  return {
    id: n.id,
    name: n.name,
    description: n.description || '',
    tags: n.tags || [],
    createdAt: n.createdAt,
    approvedAt: n.approvedAt || n.createdAt,
    views: n.views || 0,
    status: n.status || 'active',
    owner: owner
      ? {
          id: owner.id,
          nickname: owner.nickname,
          avatarHue: owner.avatarHue,
          // 头像地址必须返回，否则前端只能显示首字母占位
          avatarUrl: owner.avatarUrl || '',
          bindings: {
            qq: Boolean(owner.bindings?.qq),
            wechat: Boolean(owner.bindings?.wechat),
            xiaohongshu: Boolean(owner.bindings?.xiaohongshu),
          },
        }
      : null,
    openAppeals: db.appeals.filter((a) => a.nameId === n.id && a.status === 'pending').length,
    // 圈名自定义图片（审核通过后生效）
    imageUrl: n.imageUrl || '',
    imageSha256: n.imageSha256 || '',
    // 仅详情页返回材料图片，列表接口不返回以免体积过大
    ...(withEvidence ? { evidence } : {}),
  };
}

/* 搜索建议（必须定义在 /:id 之前） */
router.get('/suggest', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (!q) return res.json({ items: [] });
  const items = db.names
    .filter((n) => n.status !== 'hidden' && n.name.toLowerCase().includes(q))
    .slice(0, 8)
    .map((n) => {
      const owner = db.users.find((u) => u.id === n.ownerId);
      return { id: n.id, name: n.name, owner: owner?.nickname || '圈友' };
    });
  res.json({ items });
});

/* 搜索行为记录（用于后台统计热词） */
router.post('/search-log', (req, res) => {
  const q = String(req.body?.q || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 60);
  // 忽略空白词与纯符号，避免污染热词统计
  if (q && /[\p{L}\p{N}]/u.test(q)) {
    const record = {
      q,
      ts: Date.now(),
      userId: req.user?.id || null,
      hit: Boolean(req.body?.hit),
    };
    // 内存缓存（供列表展示）
    db.searches.unshift(record);
    if (db.searches.length > 2000) db.searches.length = 2000;
    // 立即落库：后台热词是直接查库的，延迟写会导致「热词不更新」
    insertSearch(record);
    // 轻度清理，避免表无限增长（每 200 次触发一次）
    searchWriteCount += 1;
    if (searchWriteCount % 200 === 0) pruneSearches(5000);
  }
  res.json({ ok: true });
});

/* 公开统计（首页展示） */
router.get('/stats/overview', (_req, res) => {
  res.json({
    names: db.names.filter((n) => n.status !== 'hidden').length,
    users: db.users.filter((u) => u.status !== 'banned' && !u.deleted).length,
    approved: db.claims.filter((c) => c.status === 'approved').length,
    pending: db.claims.filter((c) => c.status === 'pending').length,
    appeals: db.appeals.filter((a) => a.status === 'pending').length,
  });
});

/* 热门圈名：按真实浏览量排名，仅返回已绑定归属的圈名 */
router.get('/hot', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 6, 1), 20);
  const items = db.names
    .filter((n) => n.status !== 'hidden')
    .map((n) => ({ name: n.name, views: n.views || 0, id: n.id }))
    .sort((a, b) => b.views - a.views || a.name.localeCompare(b.name, 'zh-Hans-CN'))
    .slice(0, limit);
  res.json({ items, total: db.names.filter((n) => n.status !== 'hidden').length });
});

/* 全部已绑定归属的圈名 */
router.get('/', (req, res) => {
  const { q = '', sort = 'latest', page = 1, pageSize = 12 } = req.query;
  const keyword = String(q).trim().toLowerCase();

  let list = db.names.filter((n) => n.status !== 'hidden');
  if (keyword) {
    list = list.filter(
      (n) =>
        n.name.toLowerCase().includes(keyword) ||
        (n.description || '').toLowerCase().includes(keyword) ||
        (n.tags || []).some((t) => t.toLowerCase().includes(keyword)),
    );
  }

  const sorters = {
    latest: (a, b) => new Date(b.approvedAt || b.createdAt) - new Date(a.approvedAt || a.createdAt),
    oldest: (a, b) => new Date(a.approvedAt || a.createdAt) - new Date(b.approvedAt || b.createdAt),
    hot: (a, b) => (b.views || 0) - (a.views || 0),
    name: (a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'),
  };
  list = [...list].sort(sorters[sort] || sorters.latest);

  const result = paginate(list, page, pageSize);
  res.json({
    ...result,
    items: result.items.map(shapeName),
    totalAll: db.names.filter((n) => n.status !== 'hidden').length,
  });
});

/* 圈名详情 */
router.get('/:id', (req, res) => {
  const name = db.names.find((n) => n.id === req.params.id || n.name === req.params.id);
  if (!name || name.status === 'hidden') return res.status(404).json({ error: '该圈名不存在或已下架' });
  name.views = (name.views || 0) + 1;
  // 单条 UPDATE 立即生效，避免全表重写与延迟导致列表/热门榜数据不同步
  incrementNameViews(name.id);
  res.json({ name: shapeName(name, { withEvidence: true }) });
});

export default router;
