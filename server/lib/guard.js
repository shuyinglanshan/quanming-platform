import { db, save, uid } from './db.js';
import { clientIp } from './util.js';
import { trustedClientIp as _trustedIp } from './ip.js';

/**
 * 访问风控
 * 1. 滑动窗口统计每个 IP 的接口请求数，超过阈值先「提醒」（429 + retryAfter，不直接封禁）
 * 2. 连续触发提醒达到 N 次 → 短暂拉黑（默认 60s，避免误触发）
 * 3. 管理员可永久拉黑 / 解除拉黑 IP
 * 4. 白名单 IP 永不触发
 */

const buckets = new Map(); // ip -> number[] 时间戳

/** 清空某个 IP 的滑动窗口计数（解封、封禁到期时调用，避免残留计数立刻再次触发） */
function resetBucket(ip) {
  buckets.delete(normalizeIp(ip));
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export function getRateConfig() {
  const c = db.settings?.rateLimit || {};
  return {
    enabled: c.enabled !== false,
    windowSeconds: Number(c.windowSeconds) || 10,
    maxRequests: Number(c.maxRequests) || 120,
    tempBlockSeconds: Number(c.tempBlockSeconds) || 60,
    strikesBeforeLongBlock: Number(c.strikesBeforeLongBlock) || 3,
    longBlockSeconds: Number(c.longBlockSeconds) || 600,
    whitelist: Array.isArray(c.whitelist) ? c.whitelist : [],
  };
}

export function saveRateConfig(input = {}) {
  const cur = getRateConfig();
  db.settings.rateLimit = {
    enabled: input.enabled !== undefined ? Boolean(input.enabled) : cur.enabled,
    windowSeconds: clamp(Number(input.windowSeconds) || cur.windowSeconds, 1, 600),
    maxRequests: clamp(Number(input.maxRequests) || cur.maxRequests, 5, 20000),
    tempBlockSeconds: clamp(Number(input.tempBlockSeconds) || cur.tempBlockSeconds, 5, 86400),
    strikesBeforeLongBlock: clamp(Number(input.strikesBeforeLongBlock) || cur.strikesBeforeLongBlock, 1, 20),
    longBlockSeconds: clamp(Number(input.longBlockSeconds) || cur.longBlockSeconds, 30, 604800),
    whitelist: Array.isArray(input.whitelist)
      ? input.whitelist.map((s) => String(s).trim()).filter(Boolean).slice(0, 50)
      : cur.whitelist,
  };
  save();
  return getRateConfig();
}

export function normalizeIp(ip) {
  return String(ip || '').replace('::ffff:', '').trim();
}

export function isPermanentlyBlocked(ip) {
  const target = normalizeIp(ip);
  return (db.security?.blockedIps || []).find((b) => normalizeIp(b.ip) === target) || null;
}

export function activeTempBlock(ip) {
  const target = normalizeIp(ip);
  const now = Date.now();
  return (db.security?.tempBlocks || []).find((b) => normalizeIp(b.ip) === target && b.until > now) || null;
}

function cleanupTempBlocks() {
  const now = Date.now();
  const list = db.security?.tempBlocks || [];
  const kept = list.filter((b) => {
    if (b.until > now || b.strikes > 0) return true;
    // 临时封禁已到期：清掉滑动窗口残留计数，避免解封后立刻又被限流
    resetBucket(b.ip);
    return false;
  });
  if (kept.length !== list.length) {
    db.security.tempBlocks = kept;
    save();
  }
}

function pushEvent(event) {
  db.security.events = db.security.events || [];
  db.security.events.unshift({ id: uid('sec_'), createdAt: new Date().toISOString(), ...event });
  if (db.security.events.length > 500) db.security.events.length = 500;
  save();
}

/**
 * 触发一次提醒；连续「多个统计窗口」都超限才升级为临时拉黑。
 * 同一个窗口内最多累计 1 次 strike —— 避免正常用户短时突发（例如一次页面加载并发多个请求）
 * 在几秒内就被连续计次而误封。
 */
function addStrike(ip, reason) {
  const target = normalizeIp(ip);
  const now = Date.now();
  const conf = getRateConfig();
  const list = db.security.tempBlocks || [];
  const existing = list.find((b) => normalizeIp(b.ip) === target);

  // 同一窗口内重复超限：只返回提醒，不重复计次
  const sameWindow = existing?.lastStrikeAt && now - existing.lastStrikeAt < conf.windowSeconds * 1000;
  const strikes = sameWindow ? existing.strikes || 1 : (existing?.strikes || 0) + 1;

  if (!sameWindow && strikes >= conf.strikesBeforeLongBlock) {
    // 短时间内反复触发 → 逐级延长：首次 tempBlockSeconds，再次 longBlockSeconds
    const recentBlocks = (existing?.blockCount || 0) + 1;
    const seconds = recentBlocks >= 2 ? conf.longBlockSeconds : conf.tempBlockSeconds;
    const until = now + seconds * 1000;
    if (existing) {
      existing.strikes = 0;
      existing.until = until;
      existing.blockCount = recentBlocks;
      existing.reason = '连续触发频率限制，已临时拉黑';
      existing.blockedAt = new Date().toISOString();
      existing.lastStrikeAt = now;
    } else {
      list.push({
        ip: target,
        strikes: 0,
        until,
        blockCount: recentBlocks,
        reason: '连续触发频率限制，已临时拉黑',
        blockedAt: new Date().toISOString(),
        lastStrikeAt: now,
      });
    }
    db.security.tempBlocks = list;
    resetBucket(target);
    pushEvent({ type: 'temp-block', ip: target, reason, seconds, level: 'warn' });
    save();
    return { blocked: true, until, seconds };
  }

  if (existing) {
    if (!sameWindow) existing.strikes = strikes;
    existing.lastStrikeAt = now;
  } else {
    list.push({ ip: target, strikes, until: 0, reason: '频繁请求提醒', blockedAt: null, lastStrikeAt: now });
  }
  db.security.tempBlocks = list;
  if (!sameWindow) pushEvent({ type: 'rate-warn', ip: target, reason, strikes, level: 'info' });
  save();
  return { blocked: false, strikes: existing?.strikes || strikes, threshold: conf.strikesBeforeLongBlock };
}

/**
 * 不需要限流的只读探测接口
 * 移动运营商（CGNAT）下大量用户共享同一个出口 IP，
 * 验证码挑战、健康检查这类每次打开页面都会调用的幂等接口若参与计数，
 * 正常用户会被误判为攻击而拿到 429，前端表现为「验证加载失败」。
 */
const LIGHT_PATHS = new Set(['/api/auth/captcha', '/api/health', '/api/auth/me']);

export function rateGuard(req, res, next) {
  const conf = getRateConfig();
  if (!conf.enabled) return next();

  const ip = normalizeIp(_trustedIp(req));
  if (!ip) return next();
  if (conf.whitelist.includes(ip)) return next();
  if (!req.path.startsWith('/api')) return next();
  if (LIGHT_PATHS.has(req.path)) return next();

  const perm = isPermanentlyBlocked(ip);
  if (perm) {
    return res.status(403).json({
      error: '该 IP 已被永久限制访问，如有疑问请加入交流群联系管理员',
      code: 'IP_BLOCKED',
    });
  }

  cleanupTempBlocks();
  const temp = activeTempBlock(ip);
  if (temp) {
    const retryAfter = Math.max(1, Math.ceil((temp.until - Date.now()) / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({
      error: `访问过于频繁，请 ${retryAfter} 秒后再试`,
      code: 'IP_TEMP_BLOCKED',
      retryAfter,
    });
  }

  const now = Date.now();
  const windowMs = conf.windowSeconds * 1000;
  const arr = (buckets.get(ip) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  buckets.set(ip, arr);

  if (buckets.size > 2000) {
    for (const [key, list] of buckets) {
      if (!list.length || now - list[list.length - 1] > windowMs * 4) buckets.delete(key);
    }
  }

  if (arr.length > conf.maxRequests) {
    const result = addStrike(ip, `${conf.windowSeconds}s 内请求 ${arr.length} 次`);
    if (result.blocked) {
      const retryAfter = Math.ceil((result.until - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: `检测到异常频繁访问，已临时限制 ${retryAfter} 秒`,
        code: 'IP_TEMP_BLOCKED',
        retryAfter,
      });
    }
    res.setHeader('Retry-After', String(conf.windowSeconds));
    return res.status(429).json({
      error: `请求过于频繁，请稍后再试（${conf.windowSeconds} 秒内最多 ${conf.maxRequests} 次）`,
      code: 'RATE_LIMITED',
      retryAfter: conf.windowSeconds,
      strikes: result.strikes,
      threshold: result.threshold,
    });
  }

  next();
}

/* ---------------- 后台管理操作 ---------------- */

export function blockIpPermanently(ip, { reason = '管理员手动拉黑', by = null } = {}) {
  const target = normalizeIp(ip);
  if (!target) throw new Error('请输入有效的 IP 地址');
  db.security.blockedIps = db.security.blockedIps || [];
  if (db.security.blockedIps.some((b) => normalizeIp(b.ip) === target)) {
    return { ok: false, message: '该 IP 已在永久黑名单中' };
  }
  db.security.blockedIps.unshift({ ip: target, reason: String(reason).slice(0, 120), createdAt: new Date().toISOString(), by });
  db.security.tempBlocks = (db.security.tempBlocks || []).filter((b) => normalizeIp(b.ip) !== target);
  resetBucket(target);
  pushEvent({ type: 'perm-block', ip: target, reason, level: 'warn' });
  save();
  return { ok: true };
}

export function unblockIp(ip) {
  const target = normalizeIp(ip);
  const before = (db.security.blockedIps || []).length;
  db.security.blockedIps = (db.security.blockedIps || []).filter((b) => normalizeIp(b.ip) !== target);
  db.security.tempBlocks = (db.security.tempBlocks || []).filter((b) => normalizeIp(b.ip) !== target);
  const removed = before !== db.security.blockedIps.length;
  // 同步清空滑动窗口计数，避免解封后因窗口内残留请求立刻再次被限流
  resetBucket(target);
  pushEvent({ type: 'unblock', ip: target, reason: '管理员解除限制', level: 'info' });
  save();
  return { ok: true, removed };
}

export function tempBlockIp(ip, seconds = 60, reason = '管理员手动临时限制') {
  const target = normalizeIp(ip);
  const until = Date.now() + Math.max(5, Number(seconds) || 60) * 1000;
  const list = db.security.tempBlocks || [];
  const existing = list.find((b) => normalizeIp(b.ip) === target);
  if (existing) {
    existing.until = until;
    existing.reason = reason;
    existing.strikes = 0;
    existing.blockedAt = new Date().toISOString();
  } else {
    list.push({ ip: target, strikes: 0, until, reason, blockedAt: new Date().toISOString() });
  }
  db.security.tempBlocks = list;
  resetBucket(target);
  pushEvent({ type: 'temp-block', ip: target, reason, seconds, level: 'warn' });
  save();
  return { ok: true, until };
}

export function securitySnapshot() {
  cleanupTempBlocks();
  const now = Date.now();
  return {
    config: getRateConfig(),
    blockedIps: (db.security.blockedIps || []).map((b) => ({ ...b })),
    tempBlocks: (db.security.tempBlocks || [])
      .filter((b) => b.until > now)
      .map((b) => ({ ...b, remainSeconds: Math.ceil((b.until - now) / 1000) })),
    events: (db.security.events || []).slice(0, 40),
  };
}

export function clearSecurityEvents() {
  db.security.events = [];
  save();
}
