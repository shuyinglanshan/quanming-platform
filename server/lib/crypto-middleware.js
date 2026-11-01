import { isEncryptedEnvelope, decryptPayload } from './crypto-layer.js';
import { eventLog } from './logger.js';

/**
 * 加密请求解密中间件
 *
 * 约定：客户端把敏感字段放进 `{ enc: { key, iv, data, tag } }`，
 * 服务端在本中间件里还原为 req.body，后续路由代码无需感知加密细节。
 *
 * 安全措施：
 *   - 解密失败统一返回 400，不泄漏具体原因（避免填充预言）
 *   - 记录失败次数用于风控
 *   - 加密与明文请求可共存（兼容旧客户端 / 服务端直连）
 */

const failures = new Map(); // ip -> { count, resetAt }
const WINDOW = 60_000;
const MAX_FAIL_PER_WINDOW = 20;

/** 仅作用于写操作与登录类接口，GET 不需要加密 */
const PROTECTED_PREFIXES = ['/api/auth', '/api/me', '/api/claims', '/api/appeals', '/api/admin'];

function shouldDecrypt(req) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return false;
  return PROTECTED_PREFIXES.some((p) => req.path.startsWith(p));
}

function tooManyFailures(ip) {
  const now = Date.now();
  const rec = failures.get(ip);
  if (!rec || rec.resetAt < now) return false;
  return rec.count >= MAX_FAIL_PER_WINDOW;
}

function noteFailure(ip) {
  const now = Date.now();
  const rec = failures.get(ip);
  if (!rec || rec.resetAt < now) {
    failures.set(ip, { count: 1, resetAt: now + WINDOW });
  } else {
    rec.count += 1;
  }
  if (failures.size > 5000) {
    for (const [k, v] of failures) if (v.resetAt < now) failures.delete(k);
  }
}

export function decryptRequest(req, res, next) {
  if (!shouldDecrypt(req)) return next();
  if (!isEncryptedEnvelope(req.body)) return next(); // 明文请求放行，由业务层决定是否强制

  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  if (tooManyFailures(ip)) {
    return res.status(429).json({ error: '解密失败次数过多，请稍后再试', code: 'DECRYPT_RATE_LIMITED' });
  }

  try {
    const plain = decryptPayload(req.body.enc);
    if (!plain || typeof plain !== 'object' || Array.isArray(plain)) {
      throw new Error('解密结果格式不正确');
    }
    req.body = plain;
    req.encrypted = true;
    next();
  } catch (err) {
    noteFailure(ip);
    // 不回显具体错误，避免被用于探测
    eventLog(req, '加密请求解密失败', String(err.message || '').slice(0, 80), 'error');
    return res.status(400).json({ error: '请求内容校验失败，请刷新页面后重试', code: 'DECRYPT_FAILED' });
  }
}

/** 供后台查看解密失败情况 */
export function cryptoStats() {
  const now = Date.now();
  const list = [...failures.entries()]
    .filter(([, v]) => v.resetAt > now)
    .map(([ip, v]) => ({ ip, count: v.count, resetIn: Math.ceil((v.resetAt - now) / 1000) }));
  return { activeWindows: list.length, top: list.sort((a, b) => b.count - a.count).slice(0, 10) };
}
