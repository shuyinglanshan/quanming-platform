import crypto from 'node:crypto';
import { db, save } from './db.js';
import { trustedClientIp } from './ip.js';
import { normalizeIp } from './guard.js';

/**
 * 登录防 dictionary attack（字典 / 撞库爆破）
 *
 * 三层防护：
 *   1. 账号维度：同一账号连续失败 N 次 → 指数退避锁定
 *   2. IP 维度：同一 IP 连续失败 M 次 → 指数退避锁定
 *   3. 哈希指纹维度：同一「密码哈希值」在多个账号上重复出现
 *      → 说明攻击者用同一字典项横扫，直接触发封禁
 *        （这是防撞库的关键：传统按账号限流无法阻止「一个密码试一万个账号」）
 */

const ACCOUNT_MAX = 5; // 账号连续失败上限
const IP_MAX = 20; // 单 IP 连续失败上限
const HASH_SPRAY_MAX = 8; // 同一密码哈希被用于不同账号的最大次数
const BASE_LOCK_MS = 5 * 60 * 1000;
const MAX_LOCK_MS = 60 * 60 * 1000;
const SPRAY_WINDOW_MS = 10 * 60 * 1000; // 撞库检测窗口

function store() {
  db.security.loginAttempts = db.security.loginAttempts || {
    accounts: {},
    ips: {},
    hashes: {},
  };
  const s = db.security.loginAttempts;
  if (!s.hashes) s.hashes = {};
  return s;
}

function lockDuration(level) {
  return Math.min(BASE_LOCK_MS * 2 ** Math.max(0, level - 1), MAX_LOCK_MS);
}

/** 密码值的指纹（避免把真实哈希写进内存结构/日志） */
function hashFingerprint(password) {
  return crypto.createHash('sha256').update(String(password ?? '')).digest('hex').slice(0, 24);
}

/** 检查是否处于锁定状态 */
export function checkLock(identifier, ip) {
  const s = store();
  const now = Date.now();
  const key = String(identifier || '').toLowerCase().trim();
  const ipKey = normalizeIp(ip);

  const account = s.accounts[key];
  if (account?.lockedUntil > now) {
    return { locked: true, retryAfter: Math.ceil((account.lockedUntil - now) / 1000), scope: 'account' };
  }
  const ipRec = s.ips[ipKey];
  if (ipRec?.lockedUntil > now) {
    return { locked: true, retryAfter: Math.ceil((ipRec.lockedUntil - now) / 1000), scope: 'ip' };
  }
  return { locked: false };
}

/**
 * 记录一次失败
 * @param {string} identifier 账号标识
 * @param {string} ip 客户端 IP
 * @param {string} password 客户端提交的密码哈希（用于撞库指纹）
 */
export function recordFailure(identifier, ip, password = '') {
  const s = store();
  const now = Date.now();
  const key = String(identifier || '').toLowerCase().trim();
  const ipKey = normalizeIp(ip);
  let sprayDetected = false;

  /* ---- 1. 账号维度 ---- */
  const acc = s.accounts[key] || { count: 0, level: 0, lockedUntil: 0 };
  acc.count += 1;
  acc.lastAt = now;
  if (acc.count >= ACCOUNT_MAX) {
    acc.level += 1;
    acc.lockedUntil = now + lockDuration(acc.level);
    acc.count = 0;
  }
  s.accounts[key] = acc;

  /* ---- 2. IP 维度 ---- */
  const ipRec = s.ips[ipKey] || { count: 0, level: 0, lockedUntil: 0 };
  ipRec.count += 1;
  ipRec.lastAt = now;
  if (ipRec.count >= IP_MAX) {
    ipRec.level += 1;
    ipRec.lockedUntil = now + lockDuration(ipRec.level);
    ipRec.count = 0;
  }
  s.ips[ipKey] = ipRec;

  /* ---- 3. 密码哈希指纹维度（防撞库）---- */
  if (password) {
    const fp = hashFingerprint(password);
    const rec = s.hashes[fp] || { accounts: [], count: 0, firstAt: now };
    // 窗口过期则重置
    if (now - rec.firstAt > SPRAY_WINDOW_MS) {
      rec.accounts = [];
      rec.count = 0;
      rec.firstAt = now;
    }
    if (!rec.accounts.includes(key)) {
      rec.accounts.push(key);
      rec.count = rec.accounts.length;
    }
    rec.lastAt = now;
    s.hashes[fp] = rec;

    if (rec.count >= HASH_SPRAY_MAX) {
      // 同一密码横扫多个账号 → 判定为撞库，锁定该 IP
      sprayDetected = true;
      const ipLock = s.ips[ipKey] || { count: 0, level: 0, lockedUntil: 0 };
      ipLock.level = Math.max(ipLock.level + 1, 2);
      ipLock.lockedUntil = now + lockDuration(ipLock.level);
      ipLock.count = 0;
      s.ips[ipKey] = ipLock;
      // 清理该指纹，避免长期占用
      delete s.hashes[fp];
    }
    // 清理过期指纹
    if (Object.keys(s.hashes).length > 2000) {
      for (const [k, v] of Object.entries(s.hashes)) {
        if (now - (v.lastAt || v.firstAt) > SPRAY_WINDOW_MS) delete s.hashes[k];
      }
    }
  }

  // 清理陈旧账号记录
  if (Object.keys(s.accounts).length > 5000) {
    for (const [k, v] of Object.entries(s.accounts)) {
      if (!v.lockedUntil || v.lockedUntil < now - 86400000) delete s.accounts[k];
    }
  }
  save();

  return {
    accountLocked: acc.lockedUntil > now,
    retryAfter: acc.lockedUntil > now ? Math.ceil((acc.lockedUntil - now) / 1000) : 0,
    remaining: Math.max(0, ACCOUNT_MAX - acc.count),
    sprayDetected,
  };
}

/** 登录成功后清零该账号与 IP 的失败计数 */
export function recordSuccess(identifier, ip) {
  const s = store();
  const key = String(identifier || '').toLowerCase().trim();
  const ipKey = normalizeIp(ip);
  let changed = false;
  if (s.accounts[key]) {
    delete s.accounts[key];
    changed = true;
  }
  if (s.ips[ipKey]) {
    delete s.ips[ipKey];
    changed = true;
  }
  if (changed) save();
}

export function loginGuardSnapshot() {
  const s = store();
  const now = Date.now();
  return {
    accountMax: ACCOUNT_MAX,
    ipMax: IP_MAX,
    hashSprayMax: HASH_SPRAY_MAX,
    lockedAccounts: Object.entries(s.accounts)
      .filter(([, v]) => v.lockedUntil > now)
      .map(([k, v]) => ({ identifier: k, remainSeconds: Math.ceil((v.lockedUntil - now) / 1000), level: v.level }))
      .slice(0, 30),
    lockedIps: Object.entries(s.ips)
      .filter(([, v]) => v.lockedUntil > now)
      .map(([k, v]) => ({ ip: k, remainSeconds: Math.ceil((v.lockedUntil - now) / 1000), level: v.level }))
      .slice(0, 30),
    sprayingFingerprints: Object.entries(s.hashes)
      .filter(([, v]) => v.count >= 3)
      .map(([, v]) => ({ accounts: v.count, firstAt: v.firstAt }))
      .slice(0, 10),
  };
}
