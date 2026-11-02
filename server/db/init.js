#!/usr/bin/env node
/**
 * 数据库初始化脚本
 *
 * 用法：
 *   node db/init.js            建表（幂等，已存在则跳过）
 *   node db/init.js --force    删库重建（⚠ 会清空所有数据）
 *   node db/init.js --check    仅检查表结构是否完整，不写入
 *
 * npm 脚本：
 *   npm run db:init    建表
 *   npm run db:reset   删库重建
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DB_FILE = process.env.DB_PATH || path.join(ROOT, 'data', 'quanming.db');
const SCHEMA_FILE = path.join(__dirname, 'schema.sql');

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const CHECK = args.includes('--check');

/** 期望存在的表（用于 --check 校验） */
const EXPECTED_TABLES = [
  'users', 'sessions', 'names', 'claims', 'appeals', 'notifications',
  'email_codes', 'captchas', 'access_logs', 'searches',
  'blocked_ips', 'temp_blocks', 'security_events',
  'register_attempts', 'login_attempts', 'settings', 'meta',
];

const DEFAULT_SETTINGS = {
  mail: {
    host: 'smtp.qq.com', port: 465, secure: true,
    user: '', pass: '', fromName: '小天才圈名平台', fromEmail: '',
    subject: '【小天才圈名平台】{{action}}验证码 {{code}}', template: '', enabled: false,
  },
  binding: { monthlyLimit: 3 },
  registerGuard: { enabled: true, windowMinutes: 10, maxPerWindow: 5, tempBlockMinutes: 30, permBlockAfter: 3 },
  rateLimit: {
    enabled: true, windowSeconds: 10, maxRequests: 120,
    tempBlockSeconds: 60, strikesBeforeLongBlock: 3, longBlockSeconds: 600,
    whitelist: ['127.0.0.1', '::1'],
  },
};

function line(text = '') { console.log(text ? '  ' + text : ''); }
function head(text) {
  line();
  line('═'.repeat(54));
  line(text);
  line('═'.repeat(54));
}

function main() {
  head('小天才圈名平台 · 数据库初始化');

  if (!fs.existsSync(SCHEMA_FILE)) {
    line(`✗ 找不到建表脚本：${SCHEMA_FILE}`);
    process.exit(1);
  }

  // --check：只读检查
  if (CHECK) {
    if (!fs.existsSync(DB_FILE)) {
      line('✗ 数据库文件不存在，请先执行 node db/init.js');
      process.exit(1);
    }
    const db = new DatabaseSync(DB_FILE);
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    const have = new Set(rows.map((r) => r.name));
    const missing = EXPECTED_TABLES.filter((t) => !have.has(t));
    db.close();
    line(`数据库：${DB_FILE}`);
    line(`表数量：${have.size}`);
    if (missing.length) {
      line(`✗ 缺少表：${missing.join(', ')}`);
      process.exit(1);
    }
    line('✓ 表结构完整');
    return;
  }

  // --force：删除旧库
  if (FORCE) {
    for (const suffix of ['', '-wal', '-shm']) {
      const f = DB_FILE + suffix;
      if (fs.existsSync(f)) {
        fs.unlinkSync(f);
        line(`✗ 已删除 ${path.basename(f)}`);
      }
    }
  }

  const dir = path.dirname(DB_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new DatabaseSync(DB_FILE);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  line(`数据库：${DB_FILE}`);
  db.exec(fs.readFileSync(SCHEMA_FILE, 'utf8'));
  line('✓ 建表完成');

  const tables = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get();
  const indexes = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'").get();
  line(`  共 ${tables.n} 张表 / ${indexes.n} 个索引`);

  // 写入默认设置
  const now = new Date().toISOString();
  const insSetting = db.prepare(
    'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING',
  );
  let inserted = 0;
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    const r = insSetting.run(k, JSON.stringify(v), now);
    if (r.changes) inserted += 1;
  }
  if (inserted) line(`✓ 已写入 ${inserted} 项默认设置`);

  // 记录版本
  db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', '1') ON CONFLICT(key) DO NOTHING").run();
  db.prepare("INSERT INTO meta (key, value) VALUES ('initialized_at', ?) ON CONFLICT(key) DO NOTHING").run(now);

  // 校验
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  const have = new Set(rows.map((r) => r.name));
  const missing = EXPECTED_TABLES.filter((t) => !have.has(t));
  db.close();

  if (missing.length) {
    line(`✗ 建表后仍缺少：${missing.join(', ')}`);
    process.exit(1);
  }

  head('初始化完成');
  line('下一步：');
  line('  1. cp .env.example .env   按需填写 SMTP / 管理员账号');
  line('  2. npm start              首次启动自动创建管理员并生成密钥');
  line();
}

try {
  main();
} catch (err) {
  line(`✗ 初始化失败：${err.message}`);
  process.exit(1);
}
