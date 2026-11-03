import express from 'express';
import { db, saveDebounced } from '../lib/db.js';
import { paginate } from '../lib/util.js';

const router = express.Router();

export function shapeName(n) {
  const owner = db.users.find((u) => u.id === n.ownerId);
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
          bindings: {
            qq: Boolean(owner.bindings?.qq),
            wechat: Boolean(owner.bindings?.wechat),
            xiaohongshu: Boolean(owner.bindings?.xiaohongshu),
          },
        }
      : null,
    openAppeals: db.appeals.filter((a) => a.nameId === n.id && a.status === 'pending').length,
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
  const q = String(req.body?.q || '').trim();
  if (q) {
    db.searches.unshift({ q: q.slice(0, 60), ts: Date.now(), userId: req.user?.id || null, hit: Boolean(req.body?.hit) });
    if (db.searches.length > 2000) db.searches.length = 2000;
    saveDebounced('searches');
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
  // 浏览计数属于高频可容忍延迟写入，合并 3 秒落库，避免每个请求重写整张 names 表
  saveDebounced('names');
  res.json({ name: shapeName(name) });
});

export default router;
