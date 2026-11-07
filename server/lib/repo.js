import { getDb, transaction } from './sqlite.js';

/**
 * 数据映射层
 * 在「JS 对象」与「SQLite 行」之间做双向转换。
 * 复杂但查询频率低的字段（bindings/stats/images/history）以 JSON 文本存储，
 * 常用查询字段（email/username/status/views）建独立列并加索引。
 */

/* ---------------- 通用工具 ---------------- */
const J = {
  parse: (v, fallback) => {
    if (v === null || v === undefined || v === '') return fallback;
    try {
      return JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  stringify: (v, fallback = null) => {
    if (v === undefined) return fallback;
    try {
      return JSON.stringify(v);
    } catch {
      return fallback;
    }
  },
};
const int = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const bool = (v) => (v ? 1 : 0);

/* ================= users ================= */
export function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email || '',
    emailDomain: row.email_domain || '',
    phone: row.phone || '',
    username: row.username,
    nickname: row.nickname,
    passwordHash: row.password_hash,
    role: row.role,
    status: row.status,
    bio: row.bio || '',
    avatarHue: int(row.avatar_hue, 260),
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at || null,
    loginCount: int(row.login_count),
    lastIp: row.last_ip || '',
    bindings: J.parse(row.bindings, { qq: null, wechat: null, xiaohongshu: null }),
    bindingChanges: J.parse(row.binding_changes, { month: '', count: 0 }),
    stats: J.parse(row.stats, { claims: 0, approved: 0, rejected: 0 }),
    banReason: row.ban_reason || '',
    deleted: Boolean(row.deleted),
    avatarUrl: row.avatar_url || '',
    avatarSha256: row.avatar_sha256 || '',
    title: row.title || '',
    courtPermission: row.court_permission === 0 ? false : true,
  };
}

export function toUserRow(u) {
  return {
    id: u.id,
    email: u.email || null,
    email_domain: u.emailDomain || '',
    phone: u.phone || null,
    username: u.username,
    nickname: u.nickname,
    password_hash: u.passwordHash,
    role: u.role || 'user',
    status: u.status || 'active',
    bio: u.bio || '',
    avatar_hue: int(u.avatarHue, 260),
    created_at: u.createdAt,
    last_login_at: u.lastLoginAt || null,
    login_count: int(u.loginCount),
    last_ip: u.lastIp || '',
    bindings: J.stringify(u.bindings, '{"qq":null,"wechat":null,"xiaohongshu":null}'),
    binding_changes: J.stringify(u.bindingChanges, '{"month":"","count":0}'),
    stats: J.stringify(u.stats, '{"claims":0,"approved":0,"rejected":0}'),
    ban_reason: u.banReason || null,
    deleted: bool(u.deleted),
    avatar_url: u.avatarUrl || null,
    avatar_sha256: u.avatarSha256 || null,
    title: u.title || null,
    court_permission: u.courtPermission === false ? 0 : 1,
  };
}

export function saveUser(u) {
  const r = toUserRow(u);
  getDb()
    .prepare(
      `INSERT INTO users (id,email,email_domain,phone,username,nickname,password_hash,role,status,bio,
        avatar_hue,created_at,last_login_at,login_count,last_ip,bindings,binding_changes,stats,ban_reason,deleted,
        avatar_url,avatar_sha256,title,court_permission)
       VALUES (@id,@email,@email_domain,@phone,@username,@nickname,@password_hash,@role,@status,@bio,
        @avatar_hue,@created_at,@last_login_at,@login_count,@last_ip,@bindings,@binding_changes,@stats,@ban_reason,@deleted,
        @avatar_url,@avatar_sha256,@title,@court_permission)
       ON CONFLICT(id) DO UPDATE SET
        email=excluded.email, email_domain=excluded.email_domain, phone=excluded.phone,
        username=excluded.username, nickname=excluded.nickname, password_hash=excluded.password_hash,
        role=excluded.role, status=excluded.status, bio=excluded.bio, avatar_hue=excluded.avatar_hue,
        last_login_at=excluded.last_login_at, login_count=excluded.login_count, last_ip=excluded.last_ip,
        bindings=excluded.bindings, binding_changes=excluded.binding_changes, stats=excluded.stats,
        ban_reason=excluded.ban_reason, deleted=excluded.deleted,
        avatar_url=excluded.avatar_url, avatar_sha256=excluded.avatar_sha256, title=excluded.title,
        court_permission=excluded.court_permission`,
    )
    .run(r);
}

export function deleteUser(id) {
  getDb().prepare('DELETE FROM users WHERE id=?').run(id);
}

/* ================= sessions ================= */
export const mapSession = (row) =>
  row
    ? {
        token: row.token,
        userId: row.user_id,
        createdAt: row.created_at,
        lastActiveAt: row.last_active_at || row.created_at,
        expiresAt: row.expires_at,
      }
    : null;

export function saveSession(s) {
  getDb()
    .prepare(
      `INSERT INTO sessions (token,user_id,created_at,last_active_at,expires_at) VALUES (?,?,?,?,?)
       ON CONFLICT(token) DO UPDATE SET expires_at=excluded.expires_at, last_active_at=excluded.last_active_at`,
    )
    .run(s.token, s.userId, s.createdAt, s.lastActiveAt || s.createdAt || null, s.expiresAt);
}
export const deleteSession = (token) => getDb().prepare('DELETE FROM sessions WHERE token=?').run(token);
export const deleteSessionsByUser = (uid) => getDb().prepare('DELETE FROM sessions WHERE user_id=?').run(uid);
export const pruneSessions = (before) => getDb().prepare('DELETE FROM sessions WHERE expires_at < ?').run(before);

/**
 * 全量替换会话表
 * 注销、封禁、修改密码等场景会从内存移除会话，只有全量替换才能真正删除数据库行；
 * 否则进程重启后已注销/已封禁的会话会被重新加载，导致会话复活。
 */
export function replaceSessions(list = []) {
  const conn = getDb();
  conn.prepare('DELETE FROM sessions').run();
  const stmt = conn.prepare(
    'INSERT INTO sessions (token,user_id,created_at,last_active_at,expires_at) VALUES (?,?,?,?,?)',
  );
  for (const s of list) {
    stmt.run(s.token, s.userId, s.createdAt, s.lastActiveAt || s.createdAt || null, s.expiresAt);
  }
}

/* ================= names ================= */
export function mapName(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    tags: J.parse(row.tags, []),
    ownerId: row.owner_id,
    status: row.status,
    views: int(row.views),
    createdAt: row.created_at,
    approvedAt: row.approved_at || row.created_at,
    claimId: row.claim_id,
    reviewerId: row.reviewer_id,
  };
}

export function toNameRow(n) {
  return {
    id: n.id,
    name: n.name,
    description: n.description || '',
    tags: J.stringify(n.tags, '[]'),
    owner_id: n.ownerId || null,
    status: n.status || 'active',
    views: int(n.views),
    created_at: n.createdAt,
    approved_at: n.approvedAt || n.createdAt,
    claim_id: n.claimId || null,
    reviewer_id: n.reviewerId || null,
  };
}

export function saveName(n) {
  getDb()
    .prepare(
      `INSERT INTO names (id,name,description,tags,owner_id,status,views,created_at,approved_at,claim_id,reviewer_id)
       VALUES (@id,@name,@description,@tags,@owner_id,@status,@views,@created_at,@approved_at,@claim_id,@reviewer_id)
       ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, description=excluded.description, tags=excluded.tags, owner_id=excluded.owner_id,
        status=excluded.status, views=excluded.views, approved_at=excluded.approved_at,
        claim_id=excluded.claim_id, reviewer_id=excluded.reviewer_id`,
    )
    .run(toNameRow(n));
}
export const deleteName = (id) => getDb().prepare('DELETE FROM names WHERE id=?').run(id);

/* ================= claims ================= */
export function mapClaim(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description || '',
    images: J.parse(row.images, []),
    status: row.status,
    rejectReason: row.reject_reason || '',
    reviewedAt: row.reviewed_at || null,
    reviewedBy: row.reviewed_by || null,
    reviewerName: row.reviewer_name || null,
    reviewNote: row.review_note || '',
    nameId: row.name_id || null,
    history: J.parse(row.history, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
  };
}

export function saveClaim(c) {
  getDb()
    .prepare(
      `INSERT INTO claims (id,user_id,name,description,images,status,reject_reason,reviewed_at,reviewed_by,
        reviewer_name,review_note,name_id,history,created_at,updated_at)
       VALUES (@id,@user_id,@name,@description,@images,@status,@reject_reason,@reviewed_at,@reviewed_by,
        @reviewer_name,@review_note,@name_id,@history,@created_at,@updated_at)
       ON CONFLICT(id) DO UPDATE SET
        description=excluded.description, images=excluded.images, status=excluded.status,
        reject_reason=excluded.reject_reason, reviewed_at=excluded.reviewed_at, reviewed_by=excluded.reviewed_by,
        reviewer_name=excluded.reviewer_name, review_note=excluded.review_note, name_id=excluded.name_id,
        history=excluded.history, updated_at=excluded.updated_at`,
    )
    .run({
      id: c.id,
      user_id: c.userId,
      name: c.name,
      description: c.description || '',
      images: J.stringify(c.images, '[]'),
      status: c.status,
      reject_reason: c.rejectReason || '',
      reviewed_at: c.reviewedAt || null,
      reviewed_by: c.reviewedBy || null,
      reviewer_name: c.reviewerName || null,
      review_note: c.reviewNote || '',
      name_id: c.nameId || null,
      history: J.stringify(c.history, '[]'),
      created_at: c.createdAt,
      updated_at: c.updatedAt || c.createdAt,
    });
}
export const deleteClaim = (id) => getDb().prepare('DELETE FROM claims WHERE id=?').run(id);

/* ================= appeals ================= */
export function mapAppeal(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    nameId: row.name_id,
    name: row.name,
    ownerId: row.owner_id,
    reason: row.reason,
    description: row.description || '',
    images: J.parse(row.images, []),
    status: row.status,
    rejectReason: row.reject_reason || '',
    reviewedAt: row.reviewed_at || null,
    reviewedBy: row.reviewed_by || null,
    reviewerName: row.reviewer_name || null,
    history: J.parse(row.history, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
  };
}

export function saveAppeal(a) {
  getDb()
    .prepare(
      `INSERT INTO appeals (id,user_id,name_id,name,owner_id,reason,description,images,status,reject_reason,
        reviewed_at,reviewed_by,reviewer_name,history,created_at,updated_at)
       VALUES (@id,@user_id,@name_id,@name,@owner_id,@reason,@description,@images,@status,@reject_reason,
        @reviewed_at,@reviewed_by,@reviewer_name,@history,@created_at,@updated_at)
       ON CONFLICT(id) DO UPDATE SET
        status=excluded.status, reject_reason=excluded.reject_reason, reviewed_at=excluded.reviewed_at,
        reviewed_by=excluded.reviewed_by, reviewer_name=excluded.reviewer_name, history=excluded.history,
        updated_at=excluded.updated_at`,
    )
    .run({
      id: a.id,
      user_id: a.userId,
      name_id: a.nameId || null,
      name: a.name,
      owner_id: a.ownerId || null,
      reason: a.reason,
      description: a.description || '',
      images: J.stringify(a.images, '[]'),
      status: a.status,
      reject_reason: a.rejectReason || '',
      reviewed_at: a.reviewedAt || null,
      reviewed_by: a.reviewedBy || null,
      reviewer_name: a.reviewerName || null,
      history: J.stringify(a.history, '[]'),
      created_at: a.createdAt,
      updated_at: a.updatedAt || a.createdAt,
    });
}
export const deleteAppeal = (id) => getDb().prepare('DELETE FROM appeals WHERE id=?').run(id);

/* ================= notifications ================= */
export function mapNotification(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    category: row.category,
    title: row.title,
    content: row.content || '',
    level: row.level,
    link: row.link || null,
    batchId: row.batch_id || null,
    createdBy: row.created_by || null,
    readAt: row.read_at || null,
    createdAt: row.created_at,
  };
}

export function saveNotification(n) {
  getDb()
    .prepare(
      `INSERT INTO notifications (id,user_id,type,category,title,content,level,link,batch_id,created_by,read_at,created_at)
       VALUES (@id,@user_id,@type,@category,@title,@content,@level,@link,@batch_id,@created_by,@read_at,@created_at)
       ON CONFLICT(id) DO UPDATE SET read_at=excluded.read_at`,
    )
    .run({
      id: n.id,
      user_id: n.userId,
      type: n.type || 'personal',
      category: n.category || 'system',
      title: n.title,
      content: n.content || '',
      level: n.level || 'info',
      link: n.link || null,
      batch_id: n.batchId || null,
      created_by: n.createdBy || null,
      read_at: n.readAt || null,
      created_at: n.createdAt,
    });
}
export const deleteNotification = (id) => getDb().prepare('DELETE FROM notifications WHERE id=?').run(id);

/** 只保留最近 keep 条通知，避免数据库无限增长 */
export function pruneNotifications(keep = 5000) {
  getDb()
    .prepare(
      'DELETE FROM notifications WHERE id NOT IN (SELECT id FROM notifications ORDER BY created_at DESC LIMIT ?)',
    )
    .run(keep);
}

/* ================= logs ================= */
export function mapLog(row) {
  if (!row) return null;
  return {
    id: row.id,
    ts: row.ts,
    ip: row.ip,
    method: row.method,
    path: row.path,
    status: row.status,
    ms: row.ms,
    action: row.action,
    detail: row.detail || '',
    level: row.level || 'info',
    userId: row.user_id || null,
    email: row.email || null,
    ua: row.ua || '',
    browser: row.browser || '',
    os: row.os || '',
    device: row.device || '',
    prev: row.prev_hash || null,
    chain: row.chain_hash || null,
    v: row.v || null,
  };
}

export function saveLog(l) {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO access_logs (id,ts,ip,method,path,status,ms,action,detail,level,user_id,email,ua,browser,os,device,prev_hash,chain_hash,v)
       VALUES (@id,@ts,@ip,@method,@path,@status,@ms,@action,@detail,@level,@user_id,@email,@ua,@browser,@os,@device,@prev,@chain,@v)`,
    )
    .run({
      id: l.id,
      ts: l.ts,
      ip: l.ip || '',
      method: l.method || 'GET',
      path: l.path || '',
      status: int(l.status, 200),
      ms: int(l.ms),
      action: l.action || '',
      detail: l.detail || '',
      level: l.level || 'info',
      user_id: l.userId || null,
      email: l.email || null,
      ua: l.ua || '',
      browser: l.browser || '',
      os: l.os || '',
      device: l.device || '',
      prev: l.prev || null,
      chain: l.chain || null,
      v: l.v || 1,
    });
}

/** 只保留最近 keep 条访问日志 */
export function pruneLogs(keep = 2000) {
  const n = Math.max(1, int(keep, 2000));
  getDb()
    .prepare(
      `DELETE FROM access_logs WHERE id NOT IN (
         SELECT id FROM access_logs ORDER BY ts DESC, rowid DESC LIMIT ${n}
       )`,
    )
    .run();
}

/* ================= codes ================= */
export const mapCode = (row) =>
  row
    ? {
        id: row.id,
        email: row.email,
        domain: row.domain,
        purpose: row.purpose,
        codeHash: row.code_hash,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        attempts: row.attempts,
        ip: row.ip,
        consumed: Boolean(row.consumed),
      }
    : null;

export function saveCode(c) {
  getDb()
    .prepare(
      `INSERT INTO email_codes (id,email,domain,purpose,code_hash,created_at,expires_at,attempts,ip,consumed)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET attempts=excluded.attempts, consumed=excluded.consumed`,
    )
    .run(c.id, c.email, c.domain || '', c.purpose, c.codeHash, c.createdAt, c.expiresAt, int(c.attempts), c.ip || '', bool(c.consumed));
}
export const deleteCode = (id) => getDb().prepare('DELETE FROM email_codes WHERE id=?').run(id);
export const pruneCodes = (before) => getDb().prepare('DELETE FROM email_codes WHERE expires_at < ?').run(before);

/** 全量替换验证码表（内存中已删除的过期/已用记录必须同步从数据库删除） */
export function replaceCodes(list = []) {
  const conn = getDb();
  conn.prepare('DELETE FROM email_codes').run();
  const stmt = conn.prepare(
    `INSERT INTO email_codes (id,email,domain,purpose,code_hash,created_at,expires_at,attempts,ip,consumed)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  );
  for (const c of list) {
    stmt.run(c.id, c.email, c.domain || '', c.purpose, c.codeHash, c.createdAt, c.expiresAt, int(c.attempts), c.ip || '', bool(c.consumed));
  }
}

/* ================= captchas ================= */
export const mapCaptcha = (row) =>
  row
    ? {
        id: row.id,
        ip: row.ip,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        attempts: row.attempts,
        verified: Boolean(row.verified),
        verifiedAt: row.verified_at,
        used: Boolean(row.used),
        usedAt: row.used_at,
      }
    : null;

export function saveCaptcha(c) {
  getDb()
    .prepare(
      `INSERT INTO captchas (id,ip,created_at,expires_at,attempts,verified,verified_at,used,used_at)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET attempts=excluded.attempts, verified=excluded.verified,
        verified_at=excluded.verified_at, used=excluded.used, used_at=excluded.used_at`,
    )
    .run(c.id, c.ip || '', c.createdAt, c.expiresAt, int(c.attempts), bool(c.verified), c.verifiedAt || null, bool(c.used), c.usedAt || null);
}
export const deleteCaptcha = (id) => getDb().prepare('DELETE FROM captchas WHERE id=?').run(id);
export const pruneCaptchas = (before) => getDb().prepare('DELETE FROM captchas WHERE expires_at < ?').run(before);

/** 全量替换验证码挑战表（过期/已用挑战需从数据库真正删除） */
export function replaceCaptchas(list = []) {
  const conn = getDb();
  conn.prepare('DELETE FROM captchas').run();
  const stmt = conn.prepare(
    `INSERT INTO captchas (id,ip,created_at,expires_at,attempts,verified,verified_at,used,used_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  );
  for (const c of list) {
    stmt.run(
      c.id,
      c.ip || '',
      c.createdAt,
      c.expiresAt,
      int(c.attempts),
      bool(c.verified),
      c.verifiedAt || null,
      bool(c.used),
      c.usedAt || null,
    );
  }
}

/* ================= searches ================= */
/** 全量替换搜索记录（内存只保留最近 2000 条，落库保持同一份数据） */
export function replaceSearches(list = []) {
  const conn = getDb();
  conn.prepare('DELETE FROM searches').run();
  const stmt = conn.prepare('INSERT INTO searches (q,ts,user_id,hit) VALUES (?,?,?,?)');
  for (const s of list.slice(0, 2000)) {
    stmt.run(s.q, s.ts, s.userId || null, bool(s.hit));
  }
}

/* ================= settings ================= */
export function loadSettings() {
  const rows = getDb().prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const r of rows) {
    out[r.key] = J.parse(r.value, null);
  }
  return out;
}

export function saveSettings(key, value) {
  getDb()
    .prepare(
      `INSERT INTO settings (key,value,updated_at) VALUES (?,?,?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
    )
    .run(key, J.stringify(value, '{}'), new Date().toISOString());
}

/* ================= meta ================= */
export const getMeta = (key) => {
  const r = getDb().prepare('SELECT value FROM meta WHERE key=?').get(key);
  return r ? r.value : null;
};
export const setMeta = (key, value) =>
  getDb()
    .prepare('INSERT INTO meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(key, String(value));

export { transaction, J as json };

/* ============================================================
 * 安全相关表：IP 黑名单 / 临时封禁 / 安全事件 / 注册与登录尝试
 * ============================================================ */

/** 全量覆盖写入 IP 黑名单 */
export function saveBlockedIps(list = []) {
  const db = getDb();
  db.prepare('DELETE FROM blocked_ips').run();
  const stmt = db.prepare('INSERT OR REPLACE INTO blocked_ips (ip, reason, created_at, by_who) VALUES (?,?,?,?)');
  for (const b of list) stmt.run(b.ip, b.reason || '', b.createdAt || new Date().toISOString(), b.by || null);
}

export const mapBlockedIp = (r) =>
  r ? { ip: r.ip, reason: r.reason, createdAt: r.created_at, by: r.by_who } : null;

/** 全量覆盖写入临时封禁 */
export function saveTempBlocks(list = []) {
  const db = getDb();
  db.prepare('DELETE FROM temp_blocks').run();
  const stmt = db.prepare(
    'INSERT OR REPLACE INTO temp_blocks (ip, strikes, until_ts, reason, blocked_at) VALUES (?,?,?,?,?)',
  );
  for (const b of list) stmt.run(b.ip, b.strikes || 0, b.until || 0, b.reason || '', b.blockedAt || null);
}

export const mapTempBlock = (r) =>
  r ? { ip: r.ip, strikes: r.strikes || 0, until: r.until_ts || 0, reason: r.reason, blockedAt: r.blocked_at } : null;

/** 追加一条安全事件（保留最近 500 条） */
export function saveSecurityEvent(e) {
  const db = getDb();
  db.prepare(
    'INSERT OR REPLACE INTO security_events (id, type, ip, reason, level, seconds, strikes, created_at) VALUES (?,?,?,?,?,?,?,?)',
  ).run(e.id, e.type || null, e.ip || null, e.reason || null, e.level || 'info', e.seconds || null, e.strikes || null, e.createdAt || new Date().toISOString());
  db.prepare(
    `DELETE FROM security_events WHERE id NOT IN (SELECT id FROM security_events ORDER BY created_at DESC LIMIT 500)`,
  ).run();
}

export const mapSecurityEvent = (r) =>
  r
    ? {
        id: r.id,
        type: r.type,
        ip: r.ip,
        reason: r.reason,
        level: r.level,
        seconds: r.seconds,
        strikes: r.strikes,
        createdAt: r.created_at,
      }
    : null;

/** 注册尝试（按 IP 一行，JSON 存时间戳数组） */
export function saveRegisterAttempt(rec) {
  getDb()
    .prepare(
      'INSERT OR REPLACE INTO register_attempts (ip, attempts, failures, blocks, last_at) VALUES (?,?,?,?,?)',
    )
    .run(
      rec.ip,
      JSON.stringify(rec.attempts || []),
      JSON.stringify(rec.failures || []),
      rec.blocks || 0,
      rec.lastAt || Date.now(),
    );
}

export const mapRegisterAttempt = (r) =>
  r
    ? {
        ip: r.ip,
        attempts: safeParse(r.attempts, []),
        failures: safeParse(r.failures, []),
        blocks: r.blocks || 0,
        lastAt: r.last_at,
      }
    : null;

export const deleteRegisterAttempt = (ip) =>
  getDb().prepare('DELETE FROM register_attempts WHERE ip = ?').run(ip);

/** 登录尝试（账号 / IP / 密码指纹 三类） */
export function saveLoginAttempt(rec) {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO login_attempts (key, kind, count, level, locked_until, payload, last_at)
       VALUES (?,?,?,?,?,?,?)`,
    )
    .run(
      rec.key,
      rec.kind,
      rec.count || 0,
      rec.level || 0,
      rec.lockedUntil || 0,
      JSON.stringify(rec.payload || {}),
      rec.lastAt || Date.now(),
    );
}

export const mapLoginAttempt = (r) =>
  r
    ? {
        key: r.key,
        kind: r.kind,
        count: r.count || 0,
        level: r.level || 0,
        lockedUntil: r.locked_until || 0,
        payload: safeParse(r.payload, {}),
        lastAt: r.last_at,
      }
    : null;

export const deleteLoginAttempt = (key) =>
  getDb().prepare('DELETE FROM login_attempts WHERE key = ?').run(key);

function safeParse(text, fallback) {
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}


/* ================= avatar_requests ================= */
export function mapAvatarRequest(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    imageUrl: row.image_url,
    imageSha256: row.image_sha256,
    imageMime: row.image_mime || '',
    imageSize: int(row.image_size),
    status: row.status,
    rejectReason: row.reject_reason || '',
    reviewedBy: row.reviewed_by || null,
    reviewedAt: row.reviewed_at || null,
    createdAt: row.created_at,
  };
}

export function saveAvatarRequest(r) {
  getDb()
    .prepare(
      `INSERT INTO avatar_requests (id,user_id,image_url,image_sha256,image_mime,image_size,status,reject_reason,reviewed_by,reviewed_at,created_at)
       VALUES (@id,@user_id,@image_url,@image_sha256,@image_mime,@image_size,@status,@reject_reason,@reviewed_by,@reviewed_at,@created_at)
       ON CONFLICT(id) DO UPDATE SET
        status=excluded.status, reject_reason=excluded.reject_reason,
        reviewed_by=excluded.reviewed_by, reviewed_at=excluded.reviewed_at`,
    )
    .run({
      id: r.id,
      user_id: r.userId,
      image_url: r.imageUrl,
      image_sha256: r.imageSha256,
      image_mime: r.imageMime || '',
      image_size: int(r.imageSize),
      status: r.status,
      reject_reason: r.rejectReason || null,
      reviewed_by: r.reviewedBy || null,
      reviewed_at: r.reviewedAt || null,
      created_at: r.createdAt,
    });
}

export function deleteAvatarRequest(id) {
  getDb().prepare('DELETE FROM avatar_requests WHERE id=?').run(id);
}

/* ================= feedback ================= */
export function mapFeedback(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id || null,
    kind: row.kind,
    kindOther: row.kind_other || '',
    title: row.title,
    content: row.content,
    contact: row.contact || '',
    pagePath: row.page_path || '',
    imageUrl: row.image_url || '',
    status: row.status,
    readAt: row.read_at || null,
    reply: row.reply || '',
    repliedAt: row.replied_at || null,
    repliedBy: row.replied_by || null,
    createdAt: row.created_at,
  };
}

export function saveFeedback(f) {
  getDb()
    .prepare(
      `INSERT INTO feedback (id,user_id,kind,kind_other,title,content,contact,page_path,image_url,status,read_at,reply,replied_at,replied_by,created_at)
       VALUES (@id,@user_id,@kind,@kind_other,@title,@content,@contact,@page_path,@image_url,@status,@read_at,@reply,@replied_at,@replied_by,@created_at)
       ON CONFLICT(id) DO UPDATE SET
        status=excluded.status, read_at=excluded.read_at,
        reply=excluded.reply, replied_at=excluded.replied_at, replied_by=excluded.replied_by`,
    )
    .run({
      id: f.id,
      user_id: f.userId || null,
      kind: f.kind,
      kind_other: f.kindOther || '',
      title: f.title,
      content: f.content,
      contact: f.contact || '',
      page_path: f.pagePath || '',
      image_url: f.imageUrl || '',
      status: f.status,
      read_at: f.readAt || null,
      reply: f.reply || '',
      replied_at: f.repliedAt || null,
      replied_by: f.repliedBy || null,
      created_at: f.createdAt,
    });
}

export function deleteFeedback(id) {
  getDb().prepare('DELETE FROM feedback WHERE id=?').run(id);
}

/* ================= courts ================= */
export function mapCourt(row) {
  if (!row) return null;
  return {
    id: row.id,
    nameId: row.name_id,
    nameText: row.name_text,
    appealId: row.appeal_id,
    claimantId: row.claimant_id,
    respondentId: row.respondent_id,
    status: row.status,
    startedAt: row.started_at,
    votingEndsAt: row.voting_ends_at,
    closedAt: row.closed_at,
    winnerId: row.winner_id,
    verdict: row.verdict,
    verdictReason: row.verdict_reason,
    judgedBy: row.judged_by,
    durationHours: int(row.duration_hours, 48),
    deadlineSetBy: row.deadline_set_by || null,
    createdAt: row.created_at,
  };
}

export function saveCourt(c) {
  getDb()
    .prepare(
      `INSERT INTO courts (id,name_id,name_text,appeal_id,claimant_id,respondent_id,status,started_at,voting_ends_at,closed_at,winner_id,verdict,verdict_reason,judged_by,created_at,duration_hours,deadline_set_by)
       VALUES (@id,@name_id,@name_text,@appeal_id,@claimant_id,@respondent_id,@status,@started_at,@voting_ends_at,@closed_at,@winner_id,@verdict,@verdict_reason,@judged_by,@created_at,@duration_hours,@deadline_set_by)
       ON CONFLICT(id) DO UPDATE SET
        status=excluded.status, started_at=excluded.started_at, voting_ends_at=excluded.voting_ends_at,
        closed_at=excluded.closed_at, winner_id=excluded.winner_id, verdict=excluded.verdict,
        verdict_reason=excluded.verdict_reason, judged_by=excluded.judged_by,
        duration_hours=excluded.duration_hours, deadline_set_by=excluded.deadline_set_by`,
    )
    .run({
      id: c.id,
      name_id: c.nameId,
      name_text: c.nameText,
      appeal_id: c.appealId || null,
      claimant_id: c.claimantId,
      respondent_id: c.respondentId || null,
      status: c.status,
      started_at: c.startedAt || null,
      voting_ends_at: c.votingEndsAt || null,
      closed_at: c.closedAt || null,
      winner_id: c.winnerId || null,
      verdict: c.verdict || null,
      verdict_reason: c.verdictReason || '',
      judged_by: c.judgedBy || null,
      created_at: c.createdAt,
      duration_hours: int(c.durationHours, 48),
      deadline_set_by: c.deadlineSetBy || null,
    });
}

/* ================= court_statements ================= */
export function mapCourtStatement(row) {
  if (!row) return null;
  return {
    id: row.id,
    courtId: row.court_id,
    userId: row.user_id,
    side: row.side,
    round: int(row.round),
    content: row.content,
    images: J.parse(row.images, []),
    createdAt: row.created_at,
  };
}

export function saveCourtStatement(st) {
  getDb()
    .prepare(
      `INSERT INTO court_statements (id,court_id,user_id,side,round,content,images,created_at)
       VALUES (@id,@court_id,@user_id,@side,@round,@content,@images,@created_at)
       ON CONFLICT(id) DO NOTHING`,
    )
    .run({
      id: st.id,
      court_id: st.courtId,
      user_id: st.userId,
      side: st.side,
      round: int(st.round) || 1,
      content: st.content,
      images: J.stringify(st.images || []),
      created_at: st.createdAt,
    });
}

/* ================= court_votes ================= */
export function mapCourtVote(row) {
  if (!row) return null;
  return {
    id: row.id,
    courtId: row.court_id,
    userId: row.user_id,
    side: row.side,
    reason: row.reason || '',
    createdAt: row.created_at,
  };
}

export function saveCourtVote(v) {
  getDb()
    .prepare(
      `INSERT INTO court_votes (id,court_id,user_id,side,reason,created_at)
       VALUES (@id,@court_id,@user_id,@side,@reason,@created_at)
       ON CONFLICT(court_id,user_id) DO UPDATE SET side=excluded.side, reason=excluded.reason`,
    )
    .run({
      id: v.id,
      court_id: v.courtId,
      user_id: v.userId,
      side: v.side,
      reason: v.reason || '',
      created_at: v.createdAt,
    });
}

/* ================= name_bans ================= */
export function mapNameBan(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    nameId: row.name_id,
    courtId: row.court_id || null,
    reason: row.reason || '',
    createdAt: row.created_at,
  };
}

export function saveNameBan(b) {
  getDb()
    .prepare(
      `INSERT INTO name_bans (id,user_id,name_id,court_id,reason,created_at)
       VALUES (@id,@user_id,@name_id,@court_id,@reason,@created_at)
       ON CONFLICT(user_id,name_id) DO NOTHING`,
    )
    .run({
      id: b.id,
      user_id: b.userId,
      name_id: b.nameId,
      court_id: b.courtId || null,
      reason: b.reason || '',
      created_at: b.createdAt,
    });
}

/* ================= 增量写入（避免全表重写） ================= */

/**
 * 插入一条搜索记录
 * 单条 INSERT 立即可查，避免 saveDebounced 延迟导致
 * 后台热词查询读不到最新数据。
 */
export function insertSearch(s) {
  getDb()
    .prepare('INSERT INTO searches (q,ts,user_id,hit) VALUES (?,?,?,?)')
    .run(s.q, s.ts, s.userId || null, bool(s.hit));
}

/** 浏览量自增（单条 UPDATE，避免重写整张 names 表） */
export function incrementNameViews(id) {
  getDb().prepare('UPDATE names SET views = COALESCE(views,0) + 1 WHERE id = ?').run(id);
}

/** 清理过期搜索记录，只保留最近 N 条，控制表体积 */
export function pruneSearches(keep = 5000) {
  getDb()
    .prepare(
      `DELETE FROM searches WHERE id NOT IN (
         SELECT id FROM searches ORDER BY ts DESC LIMIT ?
       )`,
    )
    .run(keep);
}
