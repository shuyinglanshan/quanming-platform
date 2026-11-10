/**
 * 邮箱有效性验证
 *
 * 目的：注册/发码前确认邮箱**真的能收信**，
 *      避免向拼写错误或临时域名发送验证码，浪费发信配额、拉低送达率。
 *
 * 三层校验：
 *   1. 语法与域名结构（parseEmail 已做）
 *   2. 域名 MX 记录 —— 决定该域名能否接收邮件
 *   3. 一次性邮箱域名黑名单 —— 拒绝临时邮箱
 *
 * 说明：**不做 SMTP 探活**（RCPT TO 探测）。
 *   虽然能精确判断地址是否存在，但会被目标服务器判定为探测行为，
 *   导致本服务器 IP 被列入黑名单，反而损害发信能力。
 *   业界通行做法是 MX + 关键字校验 + 验证码回执确认。
 */

import dns from 'node:dns/promises';

/** 常见一次性/临时邮箱域名 */
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com',
  'throwaway.email', 'yopmail.com', 'trashmail.com', 'sharklasers.com',
  'getnada.com', 'maildrop.cc', 'temp-mail.org', 'fakeinbox.com',
  'dispostable.com', 'mintemail.com', 'spamgourmet.com', 'mytemp.email',
  'emailondeck.com', 'tempail.com', 'moakt.com', 'tempinbox.com',
]);

/** MX 查询结果缓存（避免重复 DNS 查询拖慢注册） */
const mxCache = new Map();
const MX_TTL = 30 * 60 * 1000;

/** 已知邮箱服务商的固定 MX，命中后跳过 DNS 查询 */
const KNOWN_PROVIDER_MX = {
  'qq.com': ['mx1.qq.com', 'mx2.qq.com', 'mx3.qq.com'],
  'foxmail.com': ['mx1.qq.com', 'mx2.qq.com'],
  '163.com': ['163mx01.mxmail.netease.com', '163mx02.mxmail.netease.com'],
  '126.com': ['126mx01.mxmail.netease.com', '126mx02.mxmail.netease.com'],
  'gmail.com': ['gmail-smtp-in.l.google.com'],
  'outlook.com': ['outlook-com.olc.protection.outlook.com'],
  'hotmail.com': ['hotmail-com.olc.protection.outlook.com'],
};

/**
 * 查询域名的 MX 记录
 * @returns {Promise<{ok:boolean, records:string[], reason?:string}>}
 */
async function lookupMx(domain) {
  const now = Date.now();
  const cached = mxCache.get(domain);
  if (cached && now - cached.at < MX_TTL) {
    return cached.result;
  }

  let result;
  // 已知服务商直接命中，省一次 DNS 查询
  if (KNOWN_PROVIDER_MX[domain]) {
    result = { ok: true, records: KNOWN_PROVIDER_MX[domain] };
  } else {
    try {
      const records = await Promise.race([
        dns.resolveMx(domain),
        new Promise((_, reject) => setTimeout(() => reject(new Error('DNS 超时')), 3000)),
      ]);
      const sorted = (records || [])
        .sort((a, b) => a.priority - b.priority)
        .map((r) => r.exchange);
      result = sorted.length
        ? { ok: true, records: sorted }
        : { ok: false, records: [], reason: '该邮箱域名未配置邮件接收服务（无 MX 记录）' };
    } catch (err) {
      if (err.code === 'ENOTFOUND' || err.code === 'ENODATA') {
        result = { ok: false, records: [], reason: '该邮箱域名不存在或无法接收邮件' };
      } else {
        // DNS 故障时不应该阻断用户注册，按「未知但放行」处理
        result = { ok: true, records: [], reason: 'DNS 查询失败，已放行' };
      }
    }
  }

  mxCache.set(domain, { at: now, result });
  return result;
}

/**
 * 验证邮箱是否可接收邮件
 * @param {string} email 已规范化的邮箱
 * @param {{checkMx?:boolean}} opts
 * @returns {Promise<{ok:boolean, reason?:string, mx?:string[]}>}
 */
export async function verifyEmailDeliverable(email, opts = {}) {
  const value = String(email || '').trim().toLowerCase();
  const at = value.lastIndexOf('@');
  if (at < 1) return { ok: false, reason: '邮箱格式不正确' };

  const domain = value.slice(at + 1);

  // 1. 一次性邮箱
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return { ok: false, reason: '请使用常规邮箱注册，临时邮箱不被支持' };
  }

  // 2. MX 记录（默认开启，可通过配置关闭以适配内网/离线环境）
  if (opts.checkMx === false) {
    return { ok: true };
  }
  const mx = await lookupMx(domain);
  if (!mx.ok) {
    return { ok: false, reason: mx.reason || '该邮箱无法接收邮件' };
  }
  return { ok: true, mx: mx.records };
}

/** 清理缓存（测试用） */
export function clearMxCache() {
  mxCache.clear();
}
