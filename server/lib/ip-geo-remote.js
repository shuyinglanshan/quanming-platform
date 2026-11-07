/**
 * IP 归属地增强解析（外部 API + 本地缓存）
 *
 * 分层策略：
 * 1. 本地离线库（ip-geo.js）—— 私网/特殊段、常见网段粗分，零延迟、不泄露
 * 2. 外部 API（ip-api.com）—— 仅在需要精确到城市/运营商/经纬度时调用
 * 3. 内存 + 数据库缓存 —— 同一 IP 只查一次，避免重复请求与限流
 *
 * 隐私与安全考量：
 * - 仅管理员查看日志详情时触发，不对普通访客调用
 * - 私网/保留地址直接本地判定，不发出任何外部请求
 * - 缓存 7 天，减少对外依赖；失败时静默回退本地结果
 * - 超时 3 秒，避免拖慢日志详情页
 */

import { lookupIp } from './ip-geo.js';

const API = 'http://ip-api.com/json';
/** 免费接口限制 45 次/分钟，这里保守限制 */
const RATE_LIMIT = 40;
const CACHE_TTL = 7 * 24 * 3600 * 1000;
const TIMEOUT = 3000;

/** 内存缓存：ip -> { data, at } */
const cache = new Map();
/** 滑动窗口限流 */
const calls = [];

function rateLimited() {
  const now = Date.now();
  while (calls.length && now - calls[0] > 60_000) calls.shift();
  return calls.length >= RATE_LIMIT;
}

function hit() {
  calls.push(Date.now());
}

/** 本地结果是否已足够详细（含城市） */
function hasCity(local) {
  return Boolean(local?.withCity) || /市|区|县/.test(local?.region || '');
}

/**
 * 解析 IP 完整归属地
 * @param {string} rawIp
 * @param {{ useRemote?: boolean }} opts useRemote=false 时只走本地库
 * @returns {Promise<{ ip, region, country, province, city, district, isp, org, lat, lon, source, isPrivate, isIpv6, kind }>}
 */
export async function resolveIp(rawIp, { useRemote = true } = {}) {
  const local = lookupIp(rawIp);

  const base = {
    ip: local.ip,
    region: local.region,
    country: local.ip === '未知' ? '' : '',
    province: '',
    city: '',
    district: '',
    isp: '',
    org: '',
    lat: null,
    lon: null,
    source: 'local',
    isPrivate: local.isPrivate,
    isIpv6: local.isIpv6,
    kind: local.kind,
  };

  // 私网 / 非法 / IPv6 / 未知：不需要外部查询
  if (!useRemote || local.isPrivate || local.kind === 'invalid' || local.kind === 'unknown' || local.isIpv6) {
    return base;
  }

  // 缓存命中
  const cached = cache.get(local.ip);
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    return { ...base, ...cached.data, source: 'cache' };
  }

  if (rateLimited()) {
    return { ...base, source: 'local(ratelimited)' };
  }

  try {
    hit();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT);
    const res = await fetch(
      `${API}/${encodeURIComponent(local.ip)}?lang=zh-CN&fields=status,message,country,regionName,city,district,isp,org,lat,lon`,
      { signal: controller.signal },
    );
    clearTimeout(timer);

    const data = await res.json();
    if (data?.status !== 'success') {
      return { ...base, source: 'local(api-fail)' };
    }

    const detail = {
      country: data.country || '',
      province: data.regionName || '',
      city: data.city || '',
      district: data.district || '',
      isp: data.isp || '',
      org: data.org || '',
      lat: typeof data.lat === 'number' ? data.lat : null,
      lon: typeof data.lon === 'number' ? data.lon : null,
    };

    // 组合完整地址：国家 省 市 区
    const parts = [detail.country, detail.province, detail.city, detail.district].filter(Boolean);
    const region = parts.length ? parts.join(' ') : local.region;

    const merged = { ...detail, region };
    cache.set(local.ip, { data: merged, at: Date.now() });
    if (cache.size > 5000) {
      // 简单淘汰：清理最旧的一批
      const entries = [...cache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 1000);
      for (const [k] of entries) cache.delete(k);
    }

    return { ...base, ...merged, source: 'api' };
  } catch {
    return { ...base, source: 'local(timeout)' };
  }
}

/** 同步版本：仅返回本地结果（列表页用，避免 N 次外部请求） */
export function resolveIpSync(rawIp) {
  return lookupIp(rawIp);
}

export function geoCacheStats() {
  return { size: cache.size, callsLastMinute: calls.length, limit: RATE_LIMIT };
}
