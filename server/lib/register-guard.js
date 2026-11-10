import crypto from 'node:crypto';
import { db, save, uid } from './db.js';
import { trustedClientIp } from './ip.js';
import { blockIpPermanently, tempBlockIp, normalizeIp, isPermanentlyBlocked, activeTempBlock } from './guard.js';

/**
 * 注册风控
 *
 * 漏洞教训：早期实现「注册成功就清零计数」，攻击者每成功注册一次计数即归零，
 * 导致风控形同虚设。现在改为两套独立机制：
 *
 * 1. 频率闸门（flush-gate）：所有注册尝试都计数，成功也计数，
 *    只按滑动窗口自然过期，不会被成功请求重置
 * 2. 失败升级：失败次数达阈值 → 临时封禁；累计多次 → 永久拉黑
 */

export function getRegisterGuardConfig() {
  const c = db.settings?.registerGuard || {};
  return {
    enabled: c.enabled !== false,
    windowMinutes: Number(c.windowMinutes) || 10,
    maxPerWindow: Number(c.maxPerWindow) || 5,
    tempBlockMinutes: Number(c.tempBlockMinutes) || 30,
    permBlockAfter: Number(c.permBlockAfter) || 3,
  };
}

export function saveRegisterGuardConfig(input = {}) {
  const cur = getRegisterGuardConfig();
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  db.settings.registerGuard = {
    enabled: input.enabled !== undefined ? Boolean(input.enabled) : cur.enabled,
    windowMinutes: clamp(Number(input.windowMinutes) || cur.windowMinutes, 1, 1440),
    maxPerWindow: clamp(Number(input.maxPerWindow) || cur.maxPerWindow, 1, 100),
    tempBlockMinutes: clamp(Number(input.tempBlockMinutes) || cur.tempBlockMinutes, 1, 10080),
    permBlockAfter: clamp(Number(input.permBlockAfter) || cur.permBlockAfter, 1, 20),
  };
  save('register_attempts');
  return getRegisterGuardConfig();
}

function store() {
  db.security.registerAttempts = db.security.registerAttempts || {};
  return db.security.registerAttempts;
}

/** 检查该 IP 当前是否已被限制 */
/**
 * 全局注册速率限制（不依赖 IP）
 *
 * 问题：IP 维度限速可被出口 IP 轮换绕过（攻击者用代理池批量注册）。
 *
 * 对策补充三层不依赖 IP 的维度：
 *   ① 全局速率      —— 全站每分钟注册总数上限
 *   ② 邮箱域名维度  —— 同一邮箱域名的注册频率
 *   ③ 浏览器指纹    —— IP + UA + Accept-Language 组合哈希
 *
 * 这些维度无法通过"换 IP"绕过，能有效遏制代理池批量注册。
 */
const globalReg = { windowStart: 0, count: 0 };
const domainReg = new Map();
const fpReg = new Map();
const GLOBAL_WINDOW = 60_000;
const GLOBAL_MAX = 30; // 全站每分钟最多 30 次注册请求
const DOMAIN_WINDOW = 10 * 60_000;
const DOMAIN_MAX = 8; // 同域名 10 分钟最多 8 次
const FP_WINDOW = 10 * 60_000;
const FP_MAX = 5; // 同指纹 10 分钟最多 5 次

/** 从请求提取轻量指纹（不存储原始 UA，只存哈希） */
function requestFingerprint(req) {
  const ua = String(req.get('user-agent') || '');
  const lang = String(req.get('accept-language') || '');
  // UA 归一化：去掉版本号尾部差异，避免被随意改动绕过
  const uaCore = ua.replace(/[\d.]+/g, '').slice(0, 120);
  return crypto.createHash('sha256').update(`${uaCore}|${lang}`).digest('hex').slice(0, 24);
}

/**
 * 多维度注册限流检查
 * @returns {null|{status:number, body:object}}
 */
function multiDimRegisterGuard(req, email) {
  const now = Date.now();

  // ① 全局速率
  if (now - globalReg.windowStart > GLOBAL_WINDOW) {
    globalReg.windowStart = now;
    globalReg.count = 0;
  }
  globalReg.count += 1;
  if (globalReg.count > GLOBAL_MAX) {
    return {
      status: 429,
      body: {
        error: '当前注册请求过多，请稍后再试',
        code: 'REGISTER_GLOBAL_LIMITED',
        retryAfter: Math.ceil((GLOBAL_WINDOW - (now - globalReg.windowStart)) / 1000),
      },
    };
  }

  // ② 邮箱域名维度
  const domain = String(email || '').split('@')[1]?.toLowerCase() || '';
  if (domain) {
    const rec = domainReg.get(domain);
    if (!rec || now - rec.start > DOMAIN_WINDOW) {
      domainReg.set(domain, { start: now, count: 1 });
    } else {
      rec.count += 1;
      if (rec.count > DOMAIN_MAX) {
        return {
          status: 429,
          body: {
            error: '该邮箱域名注册过于频繁，请稍后再试',
            code: 'REGISTER_DOMAIN_LIMITED',
            retryAfter: Math.ceil((DOMAIN_WINDOW - (now - rec.start)) / 1000),
          },
        };
      }
    }
  }

  // ③ 浏览器指纹维度
  const fp = requestFingerprint(req);
  const frec = fpReg.get(fp);
  if (!frec || now - frec.start > FP_WINDOW) {
    fpReg.set(fp, { start: now, count: 1 });
  } else {
    frec.count += 1;
    if (frec.count > FP_MAX) {
      return {
        status: 429,
        body: {
          error: '检测到异常注册行为，请稍后再试',
          code: 'REGISTER_FP_LIMITED',
          retryAfter: Math.ceil((FP_WINDOW - (now - frec.start)) / 1000),
        },
      };
    }
  }

  // 清理过期条目，避免内存增长
  if (domainReg.size > 2000) {
    for (const [k, v] of domainReg) if (now - v.start > DOMAIN_WINDOW) domainReg.delete(k);
  }
  if (fpReg.size > 5000) {
    for (const [k, v] of fpReg) if (now - v.start > FP_WINDOW) fpReg.delete(k);
  }

  return null;
}

export function checkRegisterAllowed(req) {
  const conf = getRegisterGuardConfig();
  if (!conf.enabled) return null;

  // 先做不依赖 IP 的多维度检查（防出口 IP 轮换）
  const multi = multiDimRegisterGuard(req, req.body?.email);
  if (multi) return multi;

  const ip = normalizeIp(trustedClientIp(req));
  if (!ip) return null;

  const perm = isPermanentlyBlocked(ip);
  if (perm) {
    return {
      status: 403,
      body: { error: '该 IP 因频繁注册已被永久限制，如有疑问请加入交流群联系管理员', code: 'IP_BLOCKED' },
    };
  }
  const temp = activeTempBlock(ip);
  if (temp) {
    const retryAfter = Math.max(1, Math.ceil((temp.until - Date.now()) / 1000));
    return {
      status: 429,
      body: {
        error: `检测到该 IP 短时间内注册过于频繁，已临时限制 ${Math.max(1, Math.ceil(retryAfter / 60))} 分钟`,
        code: 'REGISTER_BLOCKED',
        retryAfter,
      },
    };
  }

  // 频率闸门：窗口内「所有」注册尝试（含成功）都计数
  const rec = store()[ip];
  if (rec) {
    const now = Date.now();
    const windowMs = conf.windowMinutes * 60 * 1000;
    const recent = (rec.attempts || []).filter((t) => now - t < windowMs);
    if (recent.length >= conf.maxPerWindow) {
      const oldest = recent[0];
      const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      return {
        status: 429,
        body: {
          error: `该 IP 在 ${conf.windowMinutes} 分钟内已发起 ${recent.length} 次注册，请稍后再试`,
          code: 'REGISTER_RATE_LIMITED',
          retryAfter,
        },
      };
    }
  }
  return null;
}

/**
 * 记录一次注册尝试
 * 无论最终成功或失败都计数（防止「成功即清零」被利用）
 */
export function recordRegisterAttempt(req, detail = '', { success = false } = {}) {
  const conf = getRegisterGuardConfig();
  if (!conf.enabled) return { blocked: false };

  const ip = normalizeIp(trustedClientIp(req));
  if (!ip) return { blocked: false };

  const all = store();
  const now = Date.now();
  const windowMs = conf.windowMinutes * 60 * 1000;

  const record = all[ip] || { attempts: [], failures: [], blocks: 0, lastAt: 0 };
  record.attempts = (record.attempts || []).filter((t) => now - t < windowMs);
  record.attempts.push(now);
  record.lastAt = now;

  if (!success) {
    record.failures = (record.failures || []).filter((t) => now - t < windowMs);
    record.failures.push(now);
  }
  all[ip] = record;
  save('register_attempts');

  // 成功注册不触发封禁，只受频率闸门约束
  if (success) return { blocked: false, remaining: Math.max(0, conf.maxPerWindow - record.attempts.length) };

  const failures = record.failures.length;
  if (failures > conf.maxPerWindow) {
    record.blocks = (record.blocks || 0) + 1;
    const blocks = record.blocks;
    record.failures = [];
    all[ip] = record;

    if (blocks >= conf.permBlockAfter) {
      blockIpPermanently(ip, { reason: `注册接口频繁失败（累计 ${blocks} 次），已自动永久拉黑`, by: 'system' });
      save('register_attempts');
      return { blocked: true, permanent: true, blocks, detail };
    }
    const seconds = conf.tempBlockMinutes * 60;
    tempBlockIp(ip, seconds, `注册失败次数超限（${conf.windowMinutes} 分钟内 ${failures} 次），已临时限制`);
    return { blocked: true, permanent: false, blocks, seconds, detail };
  }

  return { blocked: false, remaining: Math.max(0, conf.maxPerWindow - failures) };
}

/** 成功注册后只清理失败计数，频率窗口仍保留（避免被用作清零） */
export function resetRegisterAttempts(req) {
  const ip = normalizeIp(trustedClientIp(req));
  if (!ip) return;
  const rec = store()[ip];
  if (rec) {
    rec.failures = [];
    save('register_attempts');
  }
}

export function registerGuardSnapshot() {
  const conf = getRegisterGuardConfig();
  const now = Date.now();
  const windowMs = conf.windowMinutes * 60 * 1000;
  const rows = Object.entries(store()).map(([ip, rec]) => ({
    ip,
    recent: (rec.attempts || []).filter((t) => now - t < windowMs).length,
    failures: (rec.failures || []).filter((t) => now - t < windowMs).length,
    blocks: rec.blocks || 0,
    lastAt: rec.lastAt || null,
  }));
  rows.sort((a, b) => b.recent - a.recent || b.blocks - a.blocks);
  return { config: conf, rows: rows.slice(0, 30) };
}
