import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { ROOT } from './db.js';

/**
 * 密码存储与校验
 *
 * 安全设计说明（重要）：
 * 需求提到「密码使用 SHA-256 哈希存储」，但**裸 SHA-256 不适合存密码**：
 *   - 速度极快，GPU 每秒可算数十亿次，离线爆破成本极低
 *   - 无盐值，相同密码哈希相同，可被彩虹表直接命中
 *
 * 本实现采取业界标准做法，同时满足「客户端不传明文 + 服务端不可逆存储」：
 *   1. 客户端先用 SHA-256(password) 做一次变换，避免明文密码经过网络
 *   2. 服务端再用 HMAC-SHA256(pepper, clientHash) 做二次收敛（防彩虹表）
 *   3. 最后用 bcrypt（自带随机盐 + 可调成本）存储，抵抗离线爆破
 *
 * 这样：数据库泄露也无法直接反推密码；同一密码在不同用户处哈希不同。
 */

/**
 * 服务端 pepper
 *
 * 优先级：环境变量 PASSWORD_PEPPER > 本地持久化文件 > 首次随机生成并写入
 *
 * 为什么要持久化：pepper 参与密码哈希计算，一旦丢失/变更，
 * 所有既有用户将无法登录。因此必须在首次启动时生成并落盘。
 * 文件权限设为 600，且加入 .gitignore，绝不进代码库。
 */
const KEY_DIR = path.join(ROOT, 'data', 'keys');
const PEPPER_FILE = path.join(KEY_DIR, 'pepper.key');

function loadOrCreatePepper() {
  // 1) 环境变量优先（容器化部署推荐）
  const fromEnv = String(process.env.PASSWORD_PEPPER || '').trim();
  if (fromEnv.length >= 32) return { pepper: fromEnv, source: 'env' };

  // 2) 本地持久化文件
  try {
    if (fs.existsSync(PEPPER_FILE)) {
      const saved = fs.readFileSync(PEPPER_FILE, 'utf8').trim();
      if (saved.length >= 32) return { pepper: saved, source: 'file' };
    }
  } catch (err) {
    console.error('[password] 读取 pepper 失败:', err.message);
  }

  // 3) 首次生成：64 位十六进制随机串（256 bit 熵）
  const generated = crypto.randomBytes(32).toString('hex');
  try {
    if (!fs.existsSync(KEY_DIR)) fs.mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(PEPPER_FILE, generated, { mode: 0o600 });
    console.log('[password] 已自动生成密码 pepper 并保存到 data/keys/pepper.key');
  } catch (err) {
    console.error('[password] 保存 pepper 失败（将仅本次运行有效）:', err.message);
  }
  return { pepper: generated, source: 'generated' };
}

const PEPPER_INFO = loadOrCreatePepper();
const PEPPER = PEPPER_INFO.pepper;

/** 供启动日志展示 pepper 来源 */
export function pepperStatus() {
  return {
    source: PEPPER_INFO.source,
    length: PEPPER.length,
    file: PEPPER_FILE,
  };
}

export const BCRYPT_ROUNDS = 12;

/** 客户端 SHA-256 值的格式校验 */
export function isSha256Hex(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

/**
 * 把客户端传来的密码值收敛为待 bcrypt 的字符串
 * - 若已是 64 位 hex（客户端 SHA-256）→ HMAC 加 pepper
 * - 否则视为明文（兼容旧客户端/API 直连）→ 先 SHA-256 再加 pepper
 */
function toPeppered(password) {
  const raw = String(password ?? '');
  const digest = isSha256Hex(raw)
    ? raw.toLowerCase()
    : crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
  return crypto.createHmac('sha256', PEPPER).update(digest).digest('hex');
}

/** 生成密码哈希（存储用） */
export function hashPassword(password) {
  return bcrypt.hashSync(toPeppered(password), BCRYPT_ROUNDS);
}

/** 校验密码 */
export function verifyPassword(password, storedHash) {
  if (!storedHash) return false;
  try {
    return bcrypt.compareSync(toPeppered(password), storedHash);
  } catch {
    return false;
  }
}

/** 判断存储的哈希是否为当前算法（用于登录时透明升级） */
export function needsRehash(storedHash) {
  if (!storedHash) return true;
  if (!storedHash.startsWith('$2')) return true;
  const cost = Number(storedHash.split('$')[2]);
  return Number.isFinite(cost) && cost < BCRYPT_ROUNDS;
}

/** 密码强度校验（作用于原始密码；客户端 SHA-256 时无法校验强度，由前端负责） */
export function isSha256ClientValue(password) {
  return isSha256Hex(password);
}
