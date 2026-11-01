import express from 'express';
import { requireAuth } from '../lib/auth.js';
import { listNotifications, markRead, unreadCount } from '../lib/notify.js';

const router = express.Router();
router.use(requireAuth);

/** 通知列表：category = all | personal | system | appeal | review */
router.get('/', (req, res) => {
  const { category = 'all', unreadOnly = 'false', page = 1, pageSize = 20 } = req.query;
  const data = listNotifications(req.user.id, {
    category,
    unreadOnly: unreadOnly === 'true',
    page,
    pageSize,
  });
  res.json({ ...data, unreadAll: unreadCount(req.user.id) });
});

/** 未读数（导航红点轮询） */
router.get('/unread-count', (req, res) => {
  res.json({ unread: unreadCount(req.user.id) });
});

/** 标记已读 */
router.post('/read', (req, res) => {
  const { ids = null, all = false } = req.body || {};
  const count = markRead(req.user.id, all ? null : Array.isArray(ids) ? ids : null);
  res.json({ ok: true, count, unread: unreadCount(req.user.id) });
});

export default router;
