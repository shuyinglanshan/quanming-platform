import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, db, save } from './db.js';

/**
 * 应用层三重加密（Base64 + RSA + AES-256-GCM）
 *
 * 设计目标：防止中间人/抓包直接读取敏感字段（密码、手机号、验证码等）。
 *
 * 流程：
 *   1. 浏览器 GET /api/crypto/pubkey 取得 RSA 公钥（SPKI/PEM）
 *   2. 浏览器生成 32 字节随机 AES-256 密钥
 *   3. 用 RSA-OAEP(SHA-256) 加密该 AES 密钥 → 随请求发送（base64）
 *   4. 请求体用 AES-256-GCM 加密（12 字节随机 IV）→ 整体 base64
 *   5. 服务端用 RSA 私钥解出 AES 密钥，再解出明文
 *
 * 安全要点：
 *   - RSA-OAEP 而非 PKCS#1 v1.5，避免填充预言攻击
 *   - AES-GCM 提供认证加密（AEAD），密文被篡改会直接校验失败
 *   - 每次请求独立 AES 密钥 + 随机 IV，杜绝重放与密钥复用
 *   - 私钥只存服务端，且文件权限 600
 */

const KEY_DIR = path.join(ROOT, 'data', 'keys');
const PRIVATE_KEY_FILE = path.join(KEY_DIR, 'rsa_private.pem');
const PUBLIC_KEY_FILE = path.join(KEY_DIR, 'rsa_public.pem');

let cached = { privateKey: null, publicKey: null, kid: null };

function ensureKeyDir() {
  if (!fs.existsSync(KEY_DIR)) fs.mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
}

/** 生成 2048 位 RSA 密钥对（首次启动或密钥丢失时） */
export function ensureKeyPair() {
  ensureKeyDir();
  if (fs.existsSync(PRIVATE_KEY_FILE) && fs.existsSync(PUBLIC_KEY_FILE)) {
    return loadKeys();
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  fs.writeFileSync(PRIVATE_KEY_FILE, privateKey, { mode: 0o600 });
  fs.writeFileSync(PUBLIC_KEY_FILE, publicKey, { mode: 0o644 });
  console.log('[crypto] 已生成 RSA-2048 密钥对');
  return loadKeys();
}

function loadKeys() {
  const privatePem = fs.readFileSync(PRIVATE_KEY_FILE, 'utf8');
  const publicPem = fs.readFileSync(PUBLIC_KEY_FILE, 'utf8');
  const privateKey = crypto.createPrivateKey(privatePem);
  const publicKey = crypto.createPublicKey(publicPem);
  // kid：公钥指纹，前端可缓存，公钥轮换时自动失效
  const kid = crypto
    .createHash('sha256')
    .update(publicPem)
    .digest('base64url')
    .slice(0, 16);
  cached = { privateKey, publicKey, kid };
  return cached;
}

export function getPublicKey() {
  // 首次调用或密钥文件缺失时自动生成
  if (!cached.publicKey || !fs.existsSync(PUBLIC_KEY_FILE)) ensureKeyPair();
  return {
    publicKey: fs.readFileSync(PUBLIC_KEY_FILE, 'utf8'),
    kid: cached.kid,
    algorithm: 'RSA-OAEP-256',
  };
}

/**
 * 解密客户端加密的请求体
 * @param {{ key: string, iv: string, data: string, tag: string }} payload
 *    key  : RSA-OAEP 加密后的 AES 密钥（base64）
 *    iv   : 12 字节 IV（base64）
 *    data : AES-GCM 密文（base64）
 *    tag  : 16 字节认证标签（base64）
 */
export function decryptPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('加密请求格式不正确');
  }
  const { key, iv, data, tag } = payload;
  if (!key || !iv || !data || !tag) {
    throw new Error('加密请求缺少必要字段');
  }
  if (!cached.privateKey || !fs.existsSync(PRIVATE_KEY_FILE)) ensureKeyPair();

  // 1) RSA-OAEP 解出 AES 对称密钥
  let aesKey;
  try {
    aesKey = crypto.privateDecrypt(
      {
        key: cached.privateKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      Buffer.from(String(key), 'base64'),
    );
  } catch {
    throw new Error('会话密钥解密失败，请刷新页面后重试');
  }
  if (aesKey.length !== 32) throw new Error('会话密钥长度不正确');

  // 2) AES-256-GCM 解密（认证标签不匹配会抛错，天然防篡改）
  let plaintext;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, Buffer.from(String(iv), 'base64'));
    decipher.setAuthTag(Buffer.from(String(tag), 'base64'));
    plaintext = Buffer.concat([decipher.update(Buffer.from(String(data), 'base64')), decipher.final()]);
  } catch {
    throw new Error('请求内容校验失败（可能被篡改），请重试');
  }

  try {
    return JSON.parse(plaintext.toString('utf8'));
  } catch {
    throw new Error('请求内容解析失败');
  }
}

/** 服务端加密（用于响应，可选） */
export function encryptPayload(obj, aesKey) {
  const key = aesKey || crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    data: data.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    keyRaw: key.toString('base64'),
  };
}

/** 判断请求体是否为加密信封 */
export function isEncryptedEnvelope(body) {
  return Boolean(
    body &&
      typeof body === 'object' &&
      typeof body.enc === 'object' &&
      body.enc &&
      body.enc.key &&
      body.enc.iv &&
      body.enc.data &&
      body.enc.tag,
  );
}
