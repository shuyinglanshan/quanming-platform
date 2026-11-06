-- ============================================================
--  小天才圈名平台 · 数据库建表脚本
--  数据库：SQLite 3（Node.js 内置 node:sqlite 驱动，无需额外依赖）
--  说明：本脚本幂等，可重复执行（IF NOT EXISTS）
--  用法：node db/init.js        建表
--        node db/init.js --force 删库重建
-- ============================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;

-- ------------------------------------------------------------
-- 1. 用户
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                TEXT PRIMARY KEY,
  email             TEXT,
  email_domain      TEXT,
  phone             TEXT,
  username          TEXT NOT NULL,
  nickname          TEXT NOT NULL,
  password_hash     TEXT NOT NULL,
  role              TEXT NOT NULL DEFAULT 'user'
                    CHECK (role IN ('user','assessor','admin')),
  status            TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','banned')),
  bio               TEXT DEFAULT '',
  avatar_hue        INTEGER DEFAULT 260,
  ban_reason        TEXT,
  last_ip           TEXT,
  login_count       INTEGER DEFAULT 0,
  created_at        TEXT NOT NULL,
  last_login_at     TEXT,
  deleted           INTEGER NOT NULL DEFAULT 0,
  bindings          TEXT DEFAULT '{}',
  binding_changes   TEXT DEFAULT '{}',
  stats             TEXT DEFAULT '{}',
  avatar_url        TEXT,
  avatar_sha256     TEXT,
  title             TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email    ON users(lower(email))    WHERE email IS NOT NULL AND deleted = 0;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone    ON users(phone)           WHERE phone IS NOT NULL AND deleted = 0;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(lower(username)) WHERE deleted = 0;
CREATE INDEX        IF NOT EXISTS idx_users_role     ON users(role);
CREATE INDEX        IF NOT EXISTS idx_users_status   ON users(status);
CREATE INDEX        IF NOT EXISTS idx_users_created  ON users(created_at DESC);

-- ------------------------------------------------------------
-- 2. 会话
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- ------------------------------------------------------------
-- 3. 圈名
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS names (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  description    TEXT DEFAULT '',
  tags           TEXT DEFAULT '[]',
  owner_id       TEXT,
  status         TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','hidden')),
  views          INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  approved_at    TEXT,
  claim_id       TEXT,
  reviewer_id    TEXT,
  transfer_count INTEGER DEFAULT 0,
  history        TEXT DEFAULT '[]'
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_names_name   ON names(name);
CREATE INDEX        IF NOT EXISTS idx_names_owner  ON names(owner_id);
CREATE INDEX        IF NOT EXISTS idx_names_status ON names(status);
CREATE INDEX        IF NOT EXISTS idx_names_views  ON names(views DESC);

-- ------------------------------------------------------------
-- 4. 归属申请
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claims (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT DEFAULT '',
  images        TEXT DEFAULT '[]',
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected')),
  reject_reason TEXT DEFAULT '',
  created_at    TEXT NOT NULL,
  updated_at    TEXT,
  reviewed_at   TEXT,
  reviewed_by   TEXT,
  reviewer_name TEXT,
  review_note   TEXT,
  name_id       TEXT,
  history       TEXT DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_claims_user    ON claims(user_id);
CREATE INDEX IF NOT EXISTS idx_claims_status  ON claims(status);
CREATE INDEX IF NOT EXISTS idx_claims_name    ON claims(name);
CREATE INDEX IF NOT EXISTS idx_claims_created ON claims(created_at DESC);

-- ------------------------------------------------------------
-- 5. 申诉
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appeals (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  name_id       TEXT,
  name          TEXT NOT NULL,
  owner_id      TEXT,
  reason        TEXT NOT NULL,
  description   TEXT DEFAULT '',
  images        TEXT DEFAULT '[]',
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected')),
  reject_reason TEXT DEFAULT '',
  transfer      INTEGER DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT,
  reviewed_at   TEXT,
  reviewed_by   TEXT,
  reviewer_name TEXT,
  history       TEXT DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_appeals_user   ON appeals(user_id);
CREATE INDEX IF NOT EXISTS idx_appeals_name   ON appeals(name_id);
CREATE INDEX IF NOT EXISTS idx_appeals_status ON appeals(status);

-- ------------------------------------------------------------
-- 6. 通知
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  type        TEXT NOT NULL DEFAULT 'personal'
              CHECK (type IN ('system','personal')),
  category    TEXT DEFAULT 'system',
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  level       TEXT DEFAULT 'info',
  link        TEXT,
  batch_id    TEXT,
  created_by  TEXT,
  created_at  TEXT NOT NULL,
  read_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_notif_user    ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notif_unread  ON notifications(user_id, read_at);
CREATE INDEX IF NOT EXISTS idx_notif_created ON notifications(created_at DESC);

-- ------------------------------------------------------------
-- 7. 邮箱验证码
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_codes (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  domain      TEXT,
  purpose     TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  attempts    INTEGER DEFAULT 0,
  consumed    INTEGER DEFAULT 0,
  ip          TEXT,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_codes_email   ON email_codes(email, purpose);
CREATE INDEX IF NOT EXISTS idx_codes_expires ON email_codes(expires_at);

-- ------------------------------------------------------------
-- 8. 滑块挑战
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS captchas (
  id          TEXT PRIMARY KEY,
  ip          TEXT,
  verified    INTEGER DEFAULT 0,
  used        INTEGER DEFAULT 0,
  attempts    INTEGER DEFAULT 0,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  verified_at TEXT,
  used_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_captcha_expires ON captchas(expires_at);

-- ------------------------------------------------------------
-- 9. 访问日志（含防篡改哈希链）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS access_logs (
  id          TEXT PRIMARY KEY,
  ts          INTEGER NOT NULL,
  ip          TEXT,
  method      TEXT,
  path        TEXT,
  status      INTEGER,
  ms          INTEGER,
  action      TEXT,
  detail      TEXT,
  level       TEXT DEFAULT 'info',
  user_id     TEXT,
  email       TEXT,
  ua          TEXT,
  browser     TEXT,
  os          TEXT,
  device      TEXT,
  prev_hash   TEXT,
  chain_hash  TEXT,
  v           INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_logs_ts     ON access_logs(ts DESC);
CREATE INDEX IF NOT EXISTS idx_logs_status ON access_logs(status);

-- ------------------------------------------------------------
-- 10. 搜索热词
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS searches (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  q       TEXT NOT NULL,
  ts      INTEGER NOT NULL,
  user_id TEXT,
  hit     INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_searches_ts ON searches(ts DESC);

-- ------------------------------------------------------------
-- 11. IP 黑名单 / 临时封禁
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS blocked_ips (
  ip         TEXT PRIMARY KEY,
  reason     TEXT,
  created_at TEXT NOT NULL,
  by_who     TEXT
);

CREATE TABLE IF NOT EXISTS temp_blocks (
  ip         TEXT PRIMARY KEY,
  strikes    INTEGER DEFAULT 0,
  until_ts   INTEGER DEFAULT 0,
  reason     TEXT,
  blocked_at TEXT
);

-- ------------------------------------------------------------
-- 12. 安全事件
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS security_events (
  id         TEXT PRIMARY KEY,
  type       TEXT,
  ip         TEXT,
  reason     TEXT,
  level      TEXT DEFAULT 'info',
  seconds    INTEGER,
  strikes    INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sec_events_ts ON security_events(created_at DESC);

-- ------------------------------------------------------------
-- 13. 注册频率计数
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS register_attempts (
  ip       TEXT PRIMARY KEY,
  attempts TEXT DEFAULT '[]',
  failures TEXT DEFAULT '[]',
  blocks   INTEGER DEFAULT 0,
  last_at  INTEGER
);

-- ------------------------------------------------------------
-- 14. 登录尝试（防爆破 / 撞库）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS login_attempts (
  key          TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,
  count        INTEGER DEFAULT 0,
  level        INTEGER DEFAULT 0,
  locked_until INTEGER DEFAULT 0,
  payload      TEXT DEFAULT '{}',
  last_at      INTEGER
);

-- ------------------------------------------------------------
-- 15. 系统设置
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ------------------------------------------------------------
-- 16. 元信息
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

/* ============ 头像修改申请（需管理员审核） ============ */
CREATE TABLE IF NOT EXISTS avatar_requests (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  image_url     TEXT NOT NULL,
  image_sha256  TEXT NOT NULL,
  image_mime    TEXT,
  image_size    INTEGER,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected')),
  reject_reason TEXT,
  reviewed_by   TEXT,
  reviewed_at   TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_avatar_requests_status ON avatar_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_avatar_requests_user ON avatar_requests(user_id);

-- ============ 用户反馈 / 漏洞报告 ============
CREATE TABLE IF NOT EXISTS feedback (
  id            TEXT PRIMARY KEY,
  user_id       TEXT,                         -- 允许匿名反馈
  kind          TEXT NOT NULL,                -- bug | suggestion | vulnerability | other
  kind_other    TEXT,                         -- 选择「其他」时用户自填
  title         TEXT NOT NULL,
  content       TEXT NOT NULL,
  contact       TEXT,                         -- 可选联系方式
  page_path     TEXT,                         -- 提交页面，便于定位
  image_url     TEXT,                         -- 可选截图
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | read | replied | closed
  read_at       TEXT,
  reply         TEXT,                         -- 管理员答复
  replied_at    TEXT,
  replied_by    TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_status_time ON feedback(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(user_id, created_at DESC);
