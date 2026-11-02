import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const UPLOAD_DIR = path.join(ROOT, 'uploads');
export const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'quanming.db');
const SCHEMA_FILE = path.join(ROOT, 'db', 'schema.sql');

for (const dir of [DATA_DIR, UPLOAD_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** 单例数据库连接 */
export const sqlite = new DatabaseSync(DB_PATH, { enableForeignKeyConstraints: true });

/** 应用建表脚本（幂等，可重复执行） */
export function migrate() {
  const schema = fs.readFileSync(SCHEMA_FILE, 'utf8');
  sqlite.exec(schema);
  return { ok: true, path: DB_PATH };
}

migrate();

/* ---------------- 查询辅助 ---------------- */

/** 查询多行 */
export function all(sql, ...params) {
  return sqlite.prepare(sql).all(...params);
}

/** 查询单行 */
export function get(sql, ...params) {
  return sqlite.prepare(sql).get(...params) ?? null;
}

/** 执行写入，返回 { changes, lastInsertRowid } */
export function run(sql, ...params) {
  return sqlite.prepare(sql).run(...params);
}

/** 执行多语句（DDL） */
export function exec(sql) {
  return sqlite.exec(sql);
}

/** 事务包装：失败自动回滚 */
export function tx(fn) {
  sqlite.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    sqlite.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      sqlite.exec('ROLLBACK');
    } catch {}
    throw err;
  }
}

/** 分页查询辅助 */
export function paginate(baseSql, countSql, params, page = 1, pageSize = 10) {
  const size = Math.min(Math.max(Number(pageSize) || 10, 1), 100);
  const current = Math.max(Number(page) || 1, 1);
  const offset = (current - 1) * size;
  const items = all(`${baseSql} LIMIT ? OFFSET ?`, ...params, size, offset);
  const total = get(countSql, ...params)?.n ?? 0;
  return {
    items,
    total,
    page: current,
    pageSize: size,
    pages: Math.max(Math.ceil(total / size), 1),
  };
}

/* ---------------- 通用工具 ---------------- */

export const uid = (prefix = '') => prefix + crypto.randomBytes(8).toString('hex');

export const now = () => new Date().toISOString();
export const nowMs = () => Date.now();

/** JSON 安全解析 */
export function parseJson(str, fallback = null) {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

/** 关闭数据库（优雅退出用） */
export function closeDb() {
  try {
    sqlite.close();
  } catch {}
}

process.on('SIGINT', () => {
  closeDb();
  process.exit(0);
});
process.on('SIGTERM', () => {
  closeDb();
  process.exit(0);
});
