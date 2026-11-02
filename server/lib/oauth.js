import crypto from 'node:crypto';
import { get, run, all } from './db-sqlite.js';

/**
 * 社交平台 OAuth2 对接
 *
 * 支持的平台与真实限制（已查证官方文档）：
 *
 * ┌─────────┬──────────────────────────────────────────────────────┐
 * │ QQ      │ QQ互联 connect.qq.com，个人可申请，需实名认证       │
 * │         │ 授权: graph.qq.com/oauth2.0/authorize                 │
 * │         │ 令牌: graph.qq.com/oauth2.0/token                     │
 * │         │ 用户: graph.qq.com/user/get_user_info                 │
 * ├─────────┼──────────────────────────────────────────────────────┤
 * │ 微信    │ 微信开放平台「网站应用」，**必须企业主体**          │
 * │         │ 授权: open.weixin.qq.com/connect/qrconnect            │
 * │         │ 令牌: api.weixin.qq.com/sns/oauth2/access_token       │
 * │         │ 用户: api.weixin.qq.com/sns/userinfo                  │
 * ├─────────┼──────────────────────────────────────────────────────┤
 * │ 小红书  │ 开放平台仅面向品牌商家/服务商，无个人登录授权 API   │
 * │         │ 故实现为可配置的通用 OAuth2，填入接口地址即可使用   │
 * └─────────┴──────────────────────────────────────────────────────┘
 *
 * 未配置 AppID/AppSecret 时，该平台的绑定入口自动隐藏，
 * 前端会提示"该平台暂未开放授权"。
 */

const STATE_TTL = 10 * 60 * 1000; // state 10 分钟有效

/** 读取某平台配置（环境变量优先） */
export function providerConfig(provider) {
  const env = process.env;
  const prefix = { qq: 'QQ', wechat: 'WECHAT', xhs: 'XHS' }[provider];
  if (!prefix) return null;

  const cfg = {
    appId: env[`${prefix}_APP_ID`] || '',
    appSecret: env[`${prefix}_APP_SECRET`] || '',
    redirectUri: env[`${prefix}_REDIRECT_URI`] || '',
  };
  // 小红书允许自定义端点（因其无公开个人授权 API）
  if (provider === 'xhs') {
    cfg.authorizeUrl = env.XHS_AUTHORIZE_URL || '';
    cfg.tokenUrl = env.XHS_TOKEN_URL || '';
    cfg.userInfoUrl = env.XHS_USERINFO_URL || '';
  }
  return cfg;
}

/** 平台是否已配置可用 */
export function isProviderEnabled(provider) {
  const cfg = providerConfig(provider);
  if (!cfg || !cfg.appId || !cfg.appSecret || !cfg.redirectUri) return false;
  if (provider === 'xhs') {
    return Boolean(cfg.authorizeUrl && cfg.tokenUrl && cfg.userInfoUrl);
  }
  return true;
}

/** 全部平台可用状态（前端展示用） */
export function providerStatus() {
  return ['qq', 'wechat', 'xhs'].map((p) => ({
    provider: p,
    enabled: isProviderEnabled(p),
  }));
}

/* ---------------- 各平台端点定义 ---------------- */

const ENDPOINTS = {
  qq: {
    authorize: 'https://graph.qq.com/oauth2.0/authorize',
    token: 'https://graph.qq.com/oauth2.0/token',
    openid: 'https://graph.qq.com/oauth2.0/me',
    userinfo: 'https://graph.qq.com/user/get_user_info',
    scope: 'get_user_info',
  },
  wechat: {
    authorize: 'https://open.weixin.qq.com/connect/qrconnect',
    token: 'https://api.weixin.qq.com/sns/oauth2/access_token',
    userinfo: 'https://api.weixin.qq.com/sns/userinfo',
    scope: 'snsapi_login',
  },
};

/* ---------------- state 管理（防 CSRF） ---------------- */

export function createState(provider, userId, action = 'bind') {
  const state = crypto.randomBytes(24).toString('hex');
  const now = Date.now();
  // 清理过期
  run('DELETE FROM oauth_states WHERE expires_at < ?', now);
  run(
    'INSERT INTO oauth_states (state,provider,user_id,action,created_at,expires_at,consumed) VALUES (?,?,?,?,?,?,0)',
    state, provider, userId, action, now, now + STATE_TTL,
  );
  return state;
}

export function consumeState(state) {
  const row = get('SELECT * FROM oauth_states WHERE state = ?', state);
  if (!row) return { ok: false, error: '授权状态无效，请重新发起绑定' };
  if (row.consumed) return { ok: false, error: '该授权链接已被使用' };
  if (row.expires_at < Date.now()) return { ok: false, error: '授权已超时，请重新发起' };
  run('UPDATE oauth_states SET consumed = 1 WHERE state = ?', state);
  return { ok: true, record: row };
}

/* ---------------- 授权 URL ---------------- */

export function buildAuthorizeUrl(provider, state) {
  const cfg = providerConfig(provider);
  if (!cfg || !isProviderEnabled(provider)) return null;

  if (provider === 'xhs') {
    const u = new URL(cfg.authorizeUrl);
    u.searchParams.set('client_id', cfg.appId);
    u.searchParams.set('redirect_uri', cfg.redirectUri);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('state', state);
    return u.toString();
  }

  const ep = ENDPOINTS[provider];
  const u = new URL(ep.authorize);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', cfg.appId);
  u.searchParams.set('redirect_uri', cfg.redirectUri);
  u.searchParams.set('state', state);
  u.searchParams.set('scope', ep.scope);

  if (provider === 'wechat') {
    // 微信要求末尾带 #wechat_redirect
    return `${u.toString()}#wechat_redirect`;
  }
  return u.toString();
}

/* ---------------- 换取用户信息 ---------------- */

async function fetchJson(url, opts) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    // QQ 的 /me 返回 JSONP 格式：callback( {...} );
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error('响应格式无法解析');
  }
}

/** QQ */
async function exchangeQQ(cfg, code) {
  const ep = ENDPOINTS.qq;
  // 1. code → access_token
  const tokenUrl = new URL(ep.token);
  tokenUrl.searchParams.set('grant_type', 'authorization_code');
  tokenUrl.searchParams.set('client_id', cfg.appId);
  tokenUrl.searchParams.set('client_secret', cfg.appSecret);
  tokenUrl.searchParams.set('code', code);
  tokenUrl.searchParams.set('redirect_uri', cfg.redirectUri);
  tokenUrl.searchParams.set('fmt', 'json');
  const tokenRes = await fetchJson(tokenUrl.toString());
  if (!tokenRes.access_token) throw new Error(tokenRes.error_description || '获取 token 失败');

  // 2. access_token → openid
  const meUrl = new URL(ep.openid);
  meUrl.searchParams.set('access_token', tokenRes.access_token);
  meUrl.searchParams.set('fmt', 'json');
  const meRes = await fetchJson(meUrl.toString());
  if (!meRes.openid) throw new Error(meRes.error_description || '获取 openid 失败');

  // 3. 拉取用户资料
  const infoUrl = new URL(ep.userinfo);
  infoUrl.searchParams.set('access_token', tokenRes.access_token);
  infoUrl.searchParams.set('oauth_consumer_key', cfg.appId);
  infoUrl.searchParams.set('openid', meRes.openid);
  const info = await fetchJson(infoUrl.toString());

  return {
    openId: meRes.openid,
    nickname: info.nickname || '',
    avatar: info.figureurl_qq_2 || info.figureurl_qq_1 || info.figureurl_2 || '',
    raw: info,
    accessToken: tokenRes.access_token,
    refreshToken: tokenRes.refresh_token || '',
    expiresIn: Number(tokenRes.expires_in) || 0,
  };
}

/** 微信 */
async function exchangeWechat(cfg, code) {
  const ep = ENDPOINTS.wechat;
  const tokenUrl = new URL(ep.token);
  tokenUrl.searchParams.set('appid', cfg.appId);
  tokenUrl.searchParams.set('secret', cfg.appSecret);
  tokenUrl.searchParams.set('code', code);
  tokenUrl.searchParams.set('grant_type', 'authorization_code');
  const tokenRes = await fetchJson(tokenUrl.toString());
  if (!tokenRes.access_token) throw new Error(tokenRes.errmsg || '获取 token 失败');

  const infoUrl = new URL(ep.userinfo);
  infoUrl.searchParams.set('access_token', tokenRes.access_token);
  infoUrl.searchParams.set('openid', tokenRes.openid);
  infoUrl.searchParams.set('lang', 'zh_CN');
  const info = await fetchJson(infoUrl.toString());

  return {
    openId: tokenRes.openid,
    unionId: tokenRes.unionid || info.unionid || '',
    nickname: info.nickname || '',
    avatar: info.headimgurl || '',
    raw: info,
    accessToken: tokenRes.access_token,
    refreshToken: tokenRes.refresh_token || '',
    expiresIn: Number(tokenRes.expires_in) || 0,
  };
}

/** 小红书（通用 OAuth2） */
async function exchangeXhs(cfg, code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: cfg.appId,
    client_secret: cfg.appSecret,
    code,
    redirect_uri: cfg.redirectUri,
  });
  const tokenRes = await fetchJson(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!tokenRes.access_token) throw new Error(tokenRes.error_description || '获取 token 失败');

  const infoUrl = new URL(cfg.userInfoUrl);
  infoUrl.searchParams.set('access_token', tokenRes.access_token);
  const info = await fetchJson(infoUrl.toString());

  const d = info.data || info;
  return {
    openId: String(d.user_id || d.open_id || d.uid || ''),
    nickname: d.nickname || d.name || '',
    avatar: d.avatar || d.image || '',
    raw: info,
    accessToken: tokenRes.access_token,
    refreshToken: tokenRes.refresh_token || '',
    expiresIn: Number(tokenRes.expires_in) || 0,
  };
}

/** 统一入口：用 code 换取用户信息 */
export async function exchangeCode(provider, code) {
  const cfg = providerConfig(provider);
  if (!cfg || !isProviderEnabled(provider)) {
    throw new Error('该平台授权未配置，请联系管理员');
  }
  const fn = { qq: exchangeQQ, wechat: exchangeWechat, xhs: exchangeXhs }[provider];
  if (!fn) throw new Error('不支持的平台');
  const result = await fn(cfg, code);
  if (!result.openId) throw new Error('未能获取平台账号标识');
  return result;
}

/** 保存/更新社交账号缓存 */
export function saveSocialAccount(provider, info, userId) {
  const nowMs = Date.now();
  const existing = get('SELECT id FROM social_accounts WHERE provider = ? AND open_id = ?', provider, info.openId);
  const at = new Date().toISOString();
  if (existing) {
    run(
      `UPDATE social_accounts SET union_id=?, nickname=?, avatar=?, raw_profile=?, user_id=?,
       access_token=?, refresh_token=?, token_expires=?, updated_at=? WHERE id=?`,
      info.unionId || null, info.nickname, info.avatar, JSON.stringify(info.raw || {}),
      userId, info.accessToken, info.refreshToken, nowMs + (info.expiresIn || 0) * 1000,
      at, existing.id,
    );
  } else {
    run(
      `INSERT INTO social_accounts (provider,open_id,union_id,nickname,avatar,raw_profile,user_id,
       access_token,refresh_token,token_expires,bound_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      provider, info.openId, info.unionId || null, info.nickname, info.avatar,
      JSON.stringify(info.raw || {}), userId, info.accessToken, info.refreshToken,
      nowMs + (info.expiresIn || 0) * 1000, at, at,
    );
  }
  return get('SELECT * FROM social_accounts WHERE provider = ? AND open_id = ?', provider, info.openId);
}

/** 该平台账号是否已被其他用户占用 */
export function findOtherBinding(provider, openId, excludeUserId) {
  return get(
    'SELECT user_id FROM social_accounts WHERE provider = ? AND open_id = ? AND user_id IS NOT NULL AND user_id != ?',
    provider, openId, excludeUserId,
  );
}

/** 解绑时清理缓存 */
export function removeSocialAccount(provider, userId) {
  run('DELETE FROM social_accounts WHERE provider = ? AND user_id = ?', provider, userId);
}
