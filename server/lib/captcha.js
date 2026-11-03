import crypto from 'node:crypto';
import { db, save, uid } from './db.js';

/**
 * 滑块验证码
 *
 * 安全模型：
 * - 挑战由服务端签发，未经过「拖到最右端」的挑战**不存在 verified 状态**
 * - 客户端回传的 completed 字段不可信，只用于「已通过预校验」的快速路径；
 *   真正的通过凭据是服务端侧 challenge.verified（由 /captcha/verify 写入）
 * - 一次性消费，防重放
 * - 有效期 5 分钟；预校验通过后 10 分钟内必须使用
 * - 同一 IP 每小时签发数量受限，防止内存耗尽
 */

const TTL = 5 * 60 * 1000;
const VERIFIED_TTL = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_ISSUE_PER_HOUR = 300;

function cleanup() {
  const now = Date.now();
  const list = db.captchas || [];
  const kept = list.filter((c) => c.expiresAt > now && !c.used);
  if (kept.length !== list.length) {
    db.captchas = kept;
    save('captchas');
  }
}

/** 生成挑战（带单 IP 签发频率限制，防止刷爆内存） */
export function createChallenge(ip = '') {
  cleanup();

  const now = Date.now();
  db.captchas = db.captchas || [];

  // 单 IP 每小时签发上限
  if (ip) {
    const hourAgo = now - 3600_000;
    const issued = db.captchas.filter((c) => c.ip === ip && c.createdAt > hourAgo).length;
    if (issued >= MAX_ISSUE_PER_HOUR) {
      return { error: '验证请求过于频繁，请稍后再试', retryAfter: 600 };
    }
  }

  const id = uid('cap_');
  const challenge = {
    id,
    ip,
    createdAt: now,
    expiresAt: now + TTL,
    attempts: 0,
    verified: false,
    used: false,
  };
  db.captchas.push(challenge);
  // 兜底上限，避免无 IP 场景无限增长
  if (db.captchas.length > 2000) db.captchas = db.captchas.slice(-2000);
  save('captchas');

  // 滑块语义为「拖到最右端」，不再下发缺口位置
  return { id, expiresIn: TTL / 1000 };
}

function find(id) {
  return (db.captchas || []).find((c) => c.id === id);
}

/**
 * 预校验：标记已验证（由前端拖动完成后调用）
 * 注意：这里不接受客户端声称的 completed，必须由服务端写入 verified
 */
export function verifyChallenge(id) {
  cleanup();
  const challenge = find(id);
  if (!challenge) return { ok: false, error: '验证已失效，请重新拖动滑块' };
  if (challenge.used) return { ok: false, error: '验证已使用，请重新拖动滑块' };
  if (challenge.expiresAt < Date.now()) return { ok: false, error: '验证已过期，请重新拖动滑块' };

  challenge.verified = true;
  challenge.verifiedAt = new Date().toISOString();
  save('captchas');
  return { ok: true };
}

/**
 * 只读检查：验证是否已完成（不消费）
 * 用于「先校验表单，最后再消费」的两步式流程
 */
export function peekChallenge(id) {
  cleanup();
  const challenge = find(id);
  if (!challenge) return { ok: false, error: '请先完成滑块验证' };
  if (challenge.used) return { ok: false, error: '验证已使用，请重新拖动滑块' };
  if (challenge.expiresAt < Date.now()) return { ok: false, error: '验证已过期，请重新拖动滑块' };
  if (!challenge.verified) return { ok: false, error: '请先完成滑块验证' };
  if (challenge.verifiedAt && Date.now() - new Date(challenge.verifiedAt).getTime() > VERIFIED_TTL) {
    return { ok: false, error: '验证已过期，请重新拖动滑块' };
  }
  return { ok: true };
}

/**
 * 提交时消费验证
 * 只认可服务端记录过的 verified 状态；客户端无法通过伪造字段绕过
 */
export function consumeChallenge(id) {
  cleanup();
  const challenge = find(id);
  if (!challenge) return { ok: false, error: '请先完成滑块验证' };
  if (challenge.used) return { ok: false, error: '验证已使用，请重新拖动滑块' };
  if (challenge.expiresAt < Date.now()) return { ok: false, error: '验证已过期，请重新拖动滑块' };

  if (!challenge.verified) {
    return { ok: false, error: '请先完成滑块验证' };
  }
  if (challenge.verifiedAt && Date.now() - new Date(challenge.verifiedAt).getTime() > VERIFIED_TTL) {
    return { ok: false, error: '验证已过期，请重新拖动滑块' };
  }

  challenge.used = true;
  challenge.usedAt = new Date().toISOString();
  save('captchas');
  return { ok: true };
}

export function captchaStats() {
  cleanup();
  return {
    active: (db.captchas || []).length,
    ttl: TTL / 1000,
    maxIssuePerHour: MAX_ISSUE_PER_HOUR,
  };
}
