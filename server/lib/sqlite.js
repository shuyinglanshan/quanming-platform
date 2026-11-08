import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ROOT } from './paths.js';

// 数据库文件仅允许属主访问（含 WAL/SHM），避免同机其他账号读取用户数据
process.umask(0o077);

/**
 * SQLite 数据库连接与初始化
 *
 * 设计要点：
 * - 使用 Node.js 内置 node:sqlite（Node 22+），无需编译原生模块
 * - 首次启动自动创建数据库文件并执行 db/schema.sql 建表
 * - 开启 WAL 模式，提升并发读写能力
 * - 提供事务包装，保证多表操作原子性
 */

export const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'data', 'quanming.db');
const SCHEMA_FILE = path.join(ROOT, 'db', 'schema.sql');

let instance = null;

/** 获取数据库单例（首次调用时自动建库建表） */
export function getDb() {
  if (instance) return instance;

  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  const isNew = !fs.existsSync(DB_PATH);
  const db = new DatabaseSync(DB_PATH);
  try {
    fs.chmodSync(DB_PATH, 0o600);
  } catch {}

  // 基础 PRAGMA（schema.sql 中也有，这里确保连接级生效）
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA busy_timeout = 5000');

  // 执行建表脚本（幂等：全部 IF NOT EXISTS）
  if (fs.existsSync(SCHEMA_FILE)) {
    const schema = fs.readFileSync(SCHEMA_FILE, 'utf8');
    db.exec(schema);
  } else {
    console.error('[db] 未找到 db/schema.sql，数据库可能不完整');
  }

  // 轻量迁移：旧库补列（ALTER 在 SQLite 上仅新增列时是安全的）
  const columns = db.prepare('PRAGMA table_info(access_logs)').all().map((c) => c.name);
  if (!columns.includes('v')) db.exec('ALTER TABLE access_logs ADD COLUMN v INTEGER DEFAULT 1');

  // 用户在旧库上补齐头像与头衔字段
  const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!userCols.includes('avatar_url')) db.exec('ALTER TABLE users ADD COLUMN avatar_url TEXT');
  if (!userCols.includes('avatar_sha256')) db.exec('ALTER TABLE users ADD COLUMN avatar_sha256 TEXT');
  if (!userCols.includes('title')) db.exec('ALTER TABLE users ADD COLUMN title TEXT');
  // 小法庭投票权限：1 允许（默认），0 已被管理员收回
  if (!userCols.includes('court_permission')) {
    db.exec('ALTER TABLE users ADD COLUMN court_permission INTEGER DEFAULT 1');
  }

  // 图片审核：扩展字段（支持圈名图片，与用户头像共用同一审核表）
  const arCols = db.prepare('PRAGMA table_info(avatar_requests)').all().map((c) => c.name);
  if (arCols.length && !arCols.includes('target_type')) {
    db.exec("ALTER TABLE avatar_requests ADD COLUMN target_type TEXT DEFAULT 'user'");
  }
  if (arCols.length && !arCols.includes('target_id')) {
    db.exec('ALTER TABLE avatar_requests ADD COLUMN target_id TEXT');
  }

  // 圈名：自定义图片
  const nameCols2 = db.prepare('PRAGMA table_info(names)').all().map((c) => c.name);
  if (nameCols2.length && !nameCols2.includes('image_url')) {
    db.exec('ALTER TABLE names ADD COLUMN image_url TEXT');
  }
  if (nameCols2.length && !nameCols2.includes('image_sha256')) {
    db.exec('ALTER TABLE names ADD COLUMN image_sha256 TEXT');
  }

  // 会话：唯一会话 ID（对外管理用）、权限快照、过期原因
  const sessC2 = db.prepare('PRAGMA table_info(sessions)').all().map((c) => c.name);
  if (sessC2.length && !sessC2.includes('session_id')) {
    db.exec('ALTER TABLE sessions ADD COLUMN session_id TEXT');
  }
  if (sessC2.length && !sessC2.includes('role')) {
    db.exec('ALTER TABLE sessions ADD COLUMN role TEXT');
  }
  if (sessC2.length && !sessC2.includes('expired_reason')) {
    db.exec('ALTER TABLE sessions ADD COLUMN expired_reason TEXT');
  }
  if (sessC2.length && !sessC2.includes('ip')) {
    db.exec('ALTER TABLE sessions ADD COLUMN ip TEXT');
  }
  if (sessC2.length && !sessC2.includes('ua')) {
    db.exec('ALTER TABLE sessions ADD COLUMN ua TEXT');
  }

  // 会话：最后活跃时间（用于闲置自动踢出）
  const sessCols = db.prepare('PRAGMA table_info(sessions)').all().map((c) => c.name);
  if (sessCols.length && !sessCols.includes('last_active_at')) {
    db.exec('ALTER TABLE sessions ADD COLUMN last_active_at INTEGER');
  }

  // 小法庭：投票时长与截止时间设置者（仅管理员可设置）
  const courtCols = db.prepare('PRAGMA table_info(courts)').all().map((c) => c.name);
  if (courtCols.length && !courtCols.includes('duration_hours')) {
    db.exec('ALTER TABLE courts ADD COLUMN duration_hours INTEGER DEFAULT 48');
  }
  if (courtCols.length && !courtCols.includes('deadline_set_by')) {
    db.exec('ALTER TABLE courts ADD COLUMN deadline_set_by TEXT');
  }

  instance = db;
  if (isNew) {
    console.log(`[db] 已初始化数据库: ${path.relative(ROOT, DB_PATH)}`);
  }
  return db;
}

/** 执行事务：回调内抛错则整体回滚 */
export function transaction(fn) {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(db);
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {}
    throw err;
  }
}

/** 便捷查询 */
export const query = {
  all: (sql, ...params) => getDb().prepare(sql).all(...params),
  get: (sql, ...params) => getDb().prepare(sql).get(...params),
  run: (sql, ...params) => getDb().prepare(sql).run(...params),
  exec: (sql) => getDb().exec(sql),
};

/**
 * 关闭连接（进程退出时）
 *
 * 关键：WAL 模式下已提交的数据先落在 -wal 文件里，
 * 直接 close() 不会把它合并回主库。
 * 长期运行会导致主库文件极小、-wal 膨胀到数百 MB，
 * 且备份时若只拷主库会丢失全部近期数据。
 *
 * 因此关闭前必须执行 TRUNCATE checkpoint，把 WAL 全量合并并截断。
 */
export function closeDb() {
  if (!instance) return;
  try {
    instance.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch (err) {
    console.error('[sqlite] 关闭前 checkpoint 失败:', err.message);
  }
  try {
    instance.close();
  } catch {}
  instance = null;
}

/** 手动 checkpoint（可在关键写操作后调用） */
export function checkpoint(mode = 'TRUNCATE') {
  if (!instance) return false;
  try {
    instance.exec(`PRAGMA wal_checkpoint(${mode})`);
    return true;
  } catch (err) {
    console.error('[sqlite] checkpoint 失败:', err.message);
    return false;
  }
}

/** 数据库健康信息 */
export function dbInfo() {
  const db = getDb();
  const size = fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size : 0;
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name);
  const counts = {};
  for (const t of tables) {
    try {
      counts[t] = db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get().c;
    } catch {
      counts[t] = -1;
    }
  }
  return {
    path: path.relative(ROOT, DB_PATH),
    size,
    sizeHuman: size > 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(2)} MB` : `${(size / 1024).toFixed(1)} KB`,
    engine: 'SQLite (node:sqlite)',
    journal: db.prepare('PRAGMA journal_mode').get()?.journal_mode || 'unknown',
    tables,
    counts,
  };
}
