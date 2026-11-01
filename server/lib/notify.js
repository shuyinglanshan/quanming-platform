import { db, save, uid } from './db.js';

/**
 * 通知中心
 * type: system（系统公告）/ personal（个人通知，如审核结果、申诉结果、归属变动）
 * 存储时按 userId 落库；系统公告广播时给每个用户写一条 userNotice 引用
 */

export function createNotification({
  userId = null,
  type = 'system',
  title,
  content,
  level = 'info',
  category = 'system',
  link = null,
  meta = null,
  by = null,
}) {
  const notice = {
    id: uid('nt_'),
    userId, // null 表示全员公告
    type,
    category,
    title: String(title || '').slice(0, 80),
    content: String(content || '').slice(0, 2000),
    level,
    link,
    meta,
    createdBy: by,
    createdAt: new Date().toISOString(),
  };
  db.notifications.unshift(notice);
  if (db.notifications.length > 5000) db.notifications.length = 5000;
  save();
  return notice;
}

/** 给单个用户发通知 */
export function notifyUser(userId, payload) {
  if (!userId) return null;
  return createNotification({ ...payload, userId, type: payload.type || 'personal' });
}

/** 群发（给当前所有未删除用户各写一条，便于统计已读） */
export function broadcastNotification(payload, { excludeUserIds = [] } = {}) {
  const targets = db.users.filter((u) => !u.deleted && !excludeUserIds.includes(u.id));
  const now = new Date().toISOString();
  const batchId = uid('bc_');
  const created = [];
  for (const u of targets) {
    const notice = {
      id: uid('nt_'),
      userId: u.id,
      type: 'system',
      category: payload.category || 'system',
      title: String(payload.title || '').slice(0, 80),
      content: String(payload.content || '').slice(0, 2000),
      level: payload.level || 'info',
      link: payload.link || null,
      batchId,
      createdBy: payload.by || null,
      createdAt: now,
    };
    created.push(notice);
  }
  db.notifications.unshift(...created);
  if (db.notifications.length > 5000) db.notifications.length = 5000;
  save();
  return { batchId, count: created.length };
}

export function listNotifications(userId, { category = 'all', unreadOnly = false, page = 1, pageSize = 20 } = {}) {
  let list = db.notifications.filter((n) => n.userId === userId);
  if (category !== 'all') list = list.filter((n) => n.category === category);
  if (unreadOnly) list = list.filter((n) => !n.readAt);
  list = [...list].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const total = list.length;
  const size = Math.min(Math.max(Number(pageSize) || 20, 1), 100);
  const current = Math.max(Number(page) || 1, 1);
  return {
    items: list.slice((current - 1) * size, current * size),
    total,
    page: current,
    pageSize: size,
    pages: Math.max(Math.ceil(total / size), 1),
    unread: db.notifications.filter((n) => n.userId === userId && !n.readAt).length,
  };
}

export function markRead(userId, ids = null) {
  const now = new Date().toISOString();
  let count = 0;
  for (const n of db.notifications) {
    if (n.userId !== userId || n.readAt) continue;
    if (ids && !ids.includes(n.id)) continue;
    n.readAt = now;
    count += 1;
  }
  if (count) save();
  return count;
}

export function unreadCount(userId) {
  return db.notifications.filter((n) => n.userId === userId && !n.readAt).length;
}
