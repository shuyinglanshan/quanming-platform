import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ROOT } from './paths.js';

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

/** 关闭连接（进程退出时） */
export function closeDb() {
  if (instance) {
    try {
      instance.close();
    } catch {}
    instance = null;
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
