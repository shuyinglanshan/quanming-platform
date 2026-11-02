#!/usr/bin/env node
/**
 * 数据库初始化脚本
 *
 * 用法：
 *   node scripts/init-db.js          初始化（幂等，已存在则不动）
 *   node scripts/init-db.js --reset  删除并重建（会清空所有数据，慎用）
 *   node scripts/init-db.js --info   查看数据库状态
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'data', 'quanming.db');
const SCHEMA = path.join(ROOT, 'db', 'schema.sql');

const args = process.argv.slice(2);
const RESET = args.includes('--reset');
const INFO = args.includes('--info');

async function main() {
  const { getDb, dbInfo, closeDb } = await import('../lib/sqlite.js');

  if (INFO) {
    const info = dbInfo();
    console.log('\n数据库状态');
    console.log('─'.repeat(52));
    console.log(`  引擎      ${info.engine}`);
    console.log(`  文件      ${info.path}`);
    console.log(`  大小      ${info.sizeHuman}`);
    console.log(`  日志模式  ${info.journal}`);
    console.log(`  表数量    ${info.tables.length}`);
    console.log('─'.repeat(52));
    console.log('  表数据量：');
    for (const [t, c] of Object.entries(info.counts)) {
      console.log(`    ${t.padEnd(20)} ${c}`);
    }
    console.log('');
    closeDb();
    return;
  }

  if (RESET) {
    for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    console.log('已删除旧数据库文件');
  }

  if (!fs.existsSync(path.dirname(DB_PATH))) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true, mode: 0o700 });
  }
  if (!fs.existsSync(SCHEMA)) {
    console.error(`✗ 找不到建表脚本: ${SCHEMA}`);
    process.exit(1);
  }

  const isNew = !fs.existsSync(DB_PATH);
  const db = getDb();

  // 校验建表结果
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name);

  console.log('');
  console.log(isNew ? '✓ 数据库已创建并完成建表' : '✓ 数据库已存在，表结构已校验（幂等）');
  console.log('─'.repeat(52));
  console.log(`  路径    ${path.relative(process.cwd(), DB_PATH)}`);
  console.log(`  表数量  ${tables.length}`);
  console.log(`  表清单  ${tables.join(', ')}`);
  console.log('─'.repeat(52));
  console.log('');

  closeDb();
}

main().catch((err) => {
  console.error('✗ 初始化失败:', err.message);
  process.exit(1);
});
