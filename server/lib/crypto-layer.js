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
 *   - 每次请求独立 AES 密钥 + 随机 IV
 *   - 明文内强制携带时间戳 ts 与一次性 nonce，服务端校验有效期并去重，
 *     防止抓包后原样重放（重放同一密文会被 nonce 缓存直接拒绝）
 *   - 明文内携带 method/path，服务端校验与真实请求一致，防止跨接口重放
 *   - 私钥只存服务端，且文件权限 600
 */

const KEY_DIR = path.join(ROOT, 'data', 'keys');
const PRIVATE_KEY_FILE = path.join(KEY_DIR, 'rsa_private.pem');
const PUBLIC_KEY_FILE = path.join(KEY_DIR, 'rsa_public.pem');

/** 加密协议版本：v2 起要求 AAD 绑定 + kid 校验，旧版密文一律拒绝 */
export const CRYPTO_PROTOCOL_VERSION = 2;
const MIN_RSA_BITS = 3072;

let cached = { privateKey: null, publicKey: null, kid: null, bits: 0 };
/** 最近一次 decryptPayload 使用的 AES 密钥（供响应加密复用） */
let lastAesKey = null;

function ensureKeyDir() {
  if (!fs.existsSync(KEY_DIR)) fs.mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
}

function removeKeyFiles() {
  for (const f of [PRIVATE_KEY_FILE, PUBLIC_KEY_FILE]) {
    try {
      fs.unlinkSync(f);
    } catch {}
  }
}

/** 生成 RSA 密钥对（3072 位）；不再沿用旧的 2048 位密钥 */
function generateKeyPair() {
  ensureKeyDir();
  removeKeyFiles();
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 3072,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  fs.writeFileSync(PRIVATE_KEY_FILE, privateKey, { mode: 0o600 });
  fs.writeFileSync(PUBLIC_KEY_FILE, publicKey, { mode: 0o644 });
  try {
    fs.chmodSync(PRIVATE_KEY_FILE, 0o600);
    fs.chmodSync(PUBLIC_KEY_FILE, 0o644);
  } catch {}
  console.log('[crypto] 已生成新的 RSA-3072 密钥对（旧密钥不再使用）');
}

/**
 * 加载或生成密钥对
 * 若检测到旧密钥强度不足（如 2048 位）或显式设置 CRYPTO_ROTATE_KEYS=1，
 * 直接作废旧密钥并生成新的 3072 位密钥，保证不会继续使用原有密钥。
 */
export function ensureKeyPair() {
  ensureKeyDir();
  const rotate = /^(1|true|yes)$/i.test(String(process.env.CRYPTO_ROTATE_KEYS || ''));

  if (rotate) {
    console.warn('[crypto] CRYPTO_ROTATE_KEYS=1：正在轮换 API 加密密钥');
    generateKeyPair();
    return loadKeys();
  }

  if (fs.existsSync(PRIVATE_KEY_FILE) && fs.existsSync(PUBLIC_KEY_FILE)) {
    try {
      const bits = crypto.createPublicKey(fs.readFileSync(PUBLIC_KEY_FILE, 'utf8')).asymmetricKeyDetails?.modulusLength || 0;
      if (bits >= MIN_RSA_BITS) return loadKeys();
      console.warn(`[crypto] 检测到旧密钥强度不足（${bits} 位），已作废并重新生成`);
    } catch (err) {
      console.warn('[crypto] 读取旧密钥失败，重新生成:', err.message);
    }
  }

  generateKeyPair();
  return loadKeys();
}

function loadKeys() {
  const privatePem = fs.readFileSync(PRIVATE_KEY_FILE, 'utf8');
  const publicPem = fs.readFileSync(PUBLIC_KEY_FILE, 'utf8');
  const privateKey = crypto.createPrivateKey(privatePem);
  const publicKey = crypto.createPublicKey(publicPem);
  // kid：公钥指纹，前端缓存；公钥轮换后旧 kid 自动失效
  const kid = crypto
    .createHash('sha256')
    .update(publicPem)
    .digest('base64url')
    .slice(0, 16);
  const bits = publicKey.asymmetricKeyDetails?.modulusLength || 0;
  cached = { privateKey, publicKey, kid, bits };
  return cached;
}

export function getPublicKey() {
  // 首次调用或密钥文件缺失时自动生成
  if (!cached.publicKey || !fs.existsSync(PUBLIC_KEY_FILE)) ensureKeyPair();
  return {
    publicKey: fs.readFileSync(PUBLIC_KEY_FILE, 'utf8'),
    kid: cached.kid,
    v: CRYPTO_PROTOCOL_VERSION,
    bits: cached.bits,
    algorithm: 'RSA-OAEP-256',
  };
}

/** AES-GCM 附加认证数据：把密文绑定到具体请求方法与地址 */
function buildAAD(method, reqPath) {
  return Buffer.from(`qm:v${CRYPTO_PROTOCOL_VERSION}|${String(method).toUpperCase()}|${reqPath}`, 'utf8');
}

/**
 * 防重放：一次性 nonce 缓存
 * 客户端每次加密请求生成随机 nonce，服务端在有效期内只接受一次。
 * 缓存仅在内存中，单实例部署足够；多实例需换 Redis 等共享存储。
 */
const NONCE_TTL = 5 * 60 * 1000;
const MAX_TS_SKEW = 5 * 60 * 1000;
const seenNonces = new Map();

function pruneNonces(now) {
  if (seenNonces.size < 5000) return;
  for (const [nonce, expiresAt] of seenNonces) {
    if (expiresAt <= now) seenNonces.delete(nonce);
  }
}

function consumeNonce(nonce, now) {
  const expiresAt = seenNonces.get(nonce);
  if (expiresAt && expiresAt > now) return false;
  pruneNonces(now);
  seenNonces.set(nonce, now + NONCE_TTL);
  return true;
}

function assertFreshPayload(plain, context = {}) {
  const now = Date.now();

  // 协议字段统一 _qm_ 前缀，避免与业务字段（如注册接口的 method: 'phone'）冲突。
  // 兼容旧客户端：若没有 _qm_ 前缀字段，则回退读取无前缀版本。
  const tsRaw = plain?._qm_ts ?? plain?.ts;
  const nonceRaw = plain?._qm_nonce ?? plain?.nonce;
  const pathRaw = plain?._qm_path ?? plain?.path;
  const methodRaw = plain?._qm_method ?? plain?.method;

  const ts = Number(tsRaw);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > MAX_TS_SKEW) {
    throw new Error('请求已过期，请刷新页面后重试');
  }

  const nonce = String(nonceRaw || '');
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(nonce)) {
    throw new Error('请求标识无效，请刷新页面后重试');
  }
  if (!consumeNonce(nonce, now)) {
    throw new Error('检测到重复请求，请刷新页面后重试');
  }

  if (context.path && String(pathRaw || '') !== context.path) {
    throw new Error('请求地址校验失败，请刷新页面后重试');
  }
  if (context.method && String(methodRaw || '').toUpperCase() !== context.method.toUpperCase()) {
    throw new Error('请求方法校验失败，请刷新页面后重试');
  }
}

/**
 * 解密客户端加密的请求体（仅接受 v2 信封）
 * @param {{ v: number, kid: string, key: string, iv: string, data: string, tag: string }} payload
 *    v    : 协议版本，必须为 2
 *    kid  : 公钥指纹，必须与当前密钥一致（旧密钥/旧公钥直接拒绝）
 *    key  : RSA-OAEP 加密后的 AES 密钥（base64）
 *    iv   : 12 字节 IV（base64）
 *    data : AES-GCM 密文（base64）
 *    tag  : 16 字节认证标签（base64）
 * @param {{ path: string, method: string }} context 用于 AAD 与明文双重绑定校验
 */
export function decryptPayload(payload, context = {}) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('加密请求格式不正确');
  }
  if (Number(payload.v) !== CRYPTO_PROTOCOL_VERSION) {
    throw new Error('加密协议版本过旧，请刷新页面后重试');
  }
  const { kid, key, iv, data, tag } = payload;
  if (!kid || !key || !iv || !data || !tag) {
    throw new Error('加密请求缺少必要字段');
  }
  if (!cached.privateKey || !fs.existsSync(PRIVATE_KEY_FILE)) ensureKeyPair();
  if (String(kid) !== cached.kid) {
    throw new Error('加密密钥已轮换，请刷新页面后重试');
  }
  if (!context.path || !context.method) {
    throw new Error('加密请求缺少上下文');
  }

  const ivBuf = Buffer.from(String(iv), 'base64');
  const tagBuf = Buffer.from(String(tag), 'base64');
  if (ivBuf.length !== 12 || tagBuf.length !== 16) {
    throw new Error('加密参数格式不正确');
  }

  // 1) RSA-OAEP 解出 AES 对称密钥
  let aesKey;
  try {
    const keyBuf = Buffer.from(String(key), 'base64');
    if (keyBuf.length !== Math.ceil((cached.bits || 3072) / 8)) {
      throw new Error('会话密钥长度不正确');
    }
    aesKey = crypto.privateDecrypt(
      {
        key: cached.privateKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      keyBuf,
    );
  } catch (e) {
    throw new Error('会话密钥解密失败，请刷新页面后重试');
  }
  if (aesKey.length !== 32) throw new Error('会话密钥长度不正确');
  lastAesKey = aesKey;

  // 2) AES-256-GCM 解密；AAD 绑定请求方法/地址，认证标签不匹配会抛错
  let plaintext;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, ivBuf);
    decipher.setAAD(buildAAD(context.method, context.path));
    decipher.setAuthTag(tagBuf);
    plaintext = Buffer.concat([decipher.update(Buffer.from(String(data), 'base64')), decipher.final()]);
  } catch (e) {
    throw new Error('请求内容校验失败（可能被篡改），请重试');
  }

  try {
    const parsed = JSON.parse(plaintext.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('请求内容格式不正确');
    }
    assertFreshPayload(parsed, context);
    return parsed;
  } catch (err) {
    throw new Error(err.message || '请求内容解析失败');
  }
}

/** 取出最近一次解密使用的 AES 密钥，供同一请求的响应加密复用 */
export function decryptLastAesKey() {
  return lastAesKey;
}

/** 判断请求体是否为加密信封（字段是否齐全由 decryptPayload 严格校验） */
export function isEncryptedEnvelope(body) {
  return Boolean(
    body &&
      typeof body === 'object' &&
      typeof body.enc === 'object' &&
      body.enc &&
      body.enc.v &&
      body.enc.kid &&
      body.enc.key &&
      body.enc.iv &&
      body.enc.data &&
      body.enc.tag,
  );
}

/* ============================================================
 * 响应加密（服务端 -> 浏览器）
 *
 * 采用与请求对称的机制，但用**独立的临时 AES 会话密钥**：
 *   - 浏览器每次请求在头部携带 X-Session-Key（RSA 加密的 AES 密钥）
 *   - 服务端用它加密响应体，浏览器用同一把密钥解密
 *
 * 这样避免服务端为每个响应生成 RSA 密钥对（性能不可接受），
 * 同时保持前向安全：会话密钥每次请求都不同。
 * ============================================================ */

/**
 * 用客户端提供的 AES 密钥加密响应数据
 * @param {Buffer} aesKey 32 字节
 * @param {any} plain 明文对象
 * @returns {{ v:number, iv:string, data:string, tag:string }}
 */
export function encryptResponse(aesKey, plain) {
  if (!Buffer.isBuffer(aesKey) || aesKey.length !== 32) {
    throw new Error("响应加密密钥不正确");
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, iv);
  // AAD 固定为 "response"，防止把响应密文挪作请求密文使用
  cipher.setAAD(Buffer.from("response", "utf8"));
  const body = Buffer.from(JSON.stringify(plain), "utf8");
  const data = Buffer.concat([cipher.update(body), cipher.final()]);
  return {
    v: CRYPTO_PROTOCOL_VERSION,
    iv: iv.toString("base64"),
    data: data.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

/**
 * 从请求头解析客户端会话密钥（RSA 加密的 AES 密钥）
 * @returns {Buffer|null} 32 字节 AES 密钥
 */
export function parseSessionKey(encryptedKeyB64) {
  if (!encryptedKeyB64) return null;
  try {
    if (!cached.privateKey || !fs.existsSync(PRIVATE_KEY_FILE)) ensureKeyPair();
    const keyBuf = Buffer.from(String(encryptedKeyB64), "base64");
    if (keyBuf.length !== Math.ceil((cached.bits || 3072) / 8)) return null;
    const aesKey = crypto.privateDecrypt(
      {
        key: cached.privateKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      keyBuf,
    );
    return aesKey.length === 32 ? aesKey : null;
  } catch {
    return null;
  }
}
