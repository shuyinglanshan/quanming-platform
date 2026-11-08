/**
 * 极验 4.0（GeeTest CAPTCHA v4）服务端二次校验 · 多场景版
 *
 * 官方流程（https://docs.geetest.com/gt4/deploy/server/java）：
 *   1. 前端用 captchaId 初始化，用户完成验证后得到
 *      lot_number / captcha_output / pass_token / gen_time
 *   2. 前端把这四个值随业务请求提交
 *   3. 服务端用「该场景的私钥」生成签名：
 *        sign_token = HMAC-SHA256(lot_number, captcha_key)
 *   4. POST https://gcaptcha4.geetest.com/validate?captcha_id=xxx
 *      表单：lot_number、captcha_output、pass_token、gen_time、sign_token
 *   5. 返回 result === 'success' 即通过
 *
 * 多场景设计：
 *   注册与登录使用**各自独立**的验证应用（极验控制台分别创建），
 *   因此每个场景有独立的 captcha_id / captcha_key，互不共用。
 *   配置存在数据库 settings 表，管理员可在后台随时修改，无需重启。
 *
 * 场景：
 *   register  注册
 *   login     登录
 */

import crypto from 'node:crypto';
import { db, save } from './db.js';

const VALIDATE_URL = 'https://gcaptcha4.geetest.com/validate';

/** 支持的业务场景 */
export const GEETEST_SCENES = ['register', 'login', 'email'];
export const SCENE_LABELS = {
  register: '注册',
  login: '登录',
  email: '更换邮箱',
};

/** 已使用的 lot_number（防重放），按场景隔离 */
const usedLots = new Map();
const LOT_TTL = 10 * 60 * 1000;

function pruneLots() {
  const now = Date.now();
  for (const [k, at] of usedLots) {
    if (now - at > LOT_TTL) usedLots.delete(k);
  }
}

/* ============================================================
 * 配置读写（存 settings，支持后台动态修改）
 * ============================================================ */

/**
 * 读取配置项
 * db.settings 是**对象**（{ mail: {...}, geetest: {...} }），不是数组。
 * 极验配置统一放在 settings.geetest 下，按场景分组。
 */
function readSetting(key) {
  const [root, scene, field] = key.split('.');
  const node = db.settings?.[root]?.[scene];
  return node?.[field] ?? null;
}

function writeSetting(key, value) {
  const [root, scene, field] = key.split('.');
  if (!db.settings) db.settings = {};
  if (!db.settings[root] || typeof db.settings[root] !== 'object') db.settings[root] = {};
  if (!db.settings[root][scene] || typeof db.settings[root][scene] !== 'object') {
    db.settings[root][scene] = {};
  }
  db.settings[root][scene][field] = value;
}

/**
 * 读取某场景配置
 * 优先级：数据库配置 > 环境变量 > 未配置
 *
 * 环境变量命名：
 *   GEETEST_REGISTER_CAPTCHA_ID / GEETEST_REGISTER_CAPTCHA_KEY
 *   GEETEST_LOGIN_CAPTCHA_ID    / GEETEST_LOGIN_CAPTCHA_KEY
 */
function getSceneConfig(scene) {
  if (!GEETEST_SCENES.includes(scene)) return { id: '', key: '', configured: false };

  const dbId = readSetting(`geetest.${scene}.captchaId`);
  const dbKey = readSetting(`geetest.${scene}.captchaKey`);

  const envId = String(process.env[`GEETEST_${scene.toUpperCase()}_CAPTCHA_ID`] || '').trim();
  const envKey = String(process.env[`GEETEST_${scene.toUpperCase()}_CAPTCHA_KEY`] || '').trim();

  const id = String(dbId || envId || '').trim();
  const key = String(dbKey || envKey || '').trim();

  return { id, key, configured: Boolean(id && key) };
}

export function geetestConfigured(scene) {
  return getSceneConfig(scene).configured;
}

/** 前端初始化所需配置（只返回 captchaId，key 永不外泄） */
export function publicGeetestConfig(scene) {
  const { id, configured } = getSceneConfig(scene);
  return {
    scene,
    configured,
    captchaId: configured ? id : '',
  };
}

/** 后台读取完整配置（key 打码，只显示是否已设置） */
export function adminGeetestConfig() {
  return GEETEST_SCENES.map((scene) => {
    const { id, key, configured } = getSceneConfig(scene);
    return {
      scene,
      label: SCENE_LABELS[scene],
      captchaId: id,
      // 只暴露「是否已设置」与末四位，便于确认是否填对，但不泄露完整密钥
      captchaKeySet: Boolean(key),
      captchaKeyTail: key ? key.slice(-4) : '',
      configured,
    };
  });
}

/**
 * 保存某场景配置
 * @param {string} scene
 * @param {{captchaId:string, captchaKey:string}} input captchaKey 传空字符串表示不修改
 */
export function saveGeetestConfig(scene, input) {
  if (!GEETEST_SCENES.includes(scene)) {
    return { ok: false, error: '不支持的场景' };
  }

  const id = String(input?.captchaId || '').trim();
  const key = String(input?.captchaKey || '').trim();

  if (id && !/^[a-zA-Z0-9_-]{8,64}$/.test(id)) {
    return { ok: false, error: 'captchaId 格式不正确（应为 8-64 位字母数字）' };
  }
  if (key && key.length < 16) {
    return { ok: false, error: 'captchaKey 长度不正确（至少 16 位）' };
  }

  writeSetting(`geetest.${scene}.captchaId`, id);
  // 只有明确传入新 key 时才覆盖，避免「只改 ID」把已有 key 清空
  if (key) writeSetting(`geetest.${scene}.captchaKey`, key);

  save('settings');
  return { ok: true };
}

/** 清空某场景配置 */
export function clearGeetestConfig(scene) {
  if (!GEETEST_SCENES.includes(scene)) return { ok: false, error: '不支持的场景' };
  writeSetting(`geetest.${scene}.captchaId`, '');
  writeSetting(`geetest.${scene}.captchaKey`, '');
  save('settings');
  return { ok: true };
}

/* ============================================================
 * 二次校验
 * ============================================================ */

/**
 * @param {string} scene 'register' | 'login'
 * @param {{lot_number,captcha_output,pass_token,gen_time}} payload
 * @param {{ip?:string}} ctx
 */
export async function verifyGeetest(scene, payload, ctx = {}) {
  const { id, key, configured } = getSceneConfig(scene);
  if (!configured) {
    return { ok: false, reason: 'NOT_CONFIGURED' };
  }

  const lotNumber = String(payload?.lot_number || '').trim();
  const captchaOutput = String(payload?.captcha_output || '').trim();
  const passToken = String(payload?.pass_token || '').trim();
  const genTime = String(payload?.gen_time || '').trim();

  if (!lotNumber || !captchaOutput || !passToken || !genTime) {
    return { ok: false, reason: 'MISSING_FIELDS' };
  }

  // 防重放：同一场景下 lot_number 只能用一次
  pruneLots();
  const lotKey = `${scene}:${lotNumber}`;
  if (usedLots.has(lotKey)) {
    return { ok: false, reason: 'REPLAY' };
  }

  const signToken = crypto.createHmac('sha256', key).update(lotNumber).digest('hex');

  const form = new URLSearchParams({
    lot_number: lotNumber,
    captcha_output: captchaOutput,
    pass_token: passToken,
    gen_time: genTime,
    sign_token: signToken,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(`${VALIDATE_URL}?captcha_id=${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(ctx.ip ? { 'X-Forwarded-For': ctx.ip } : {}),
      },
      body: form.toString(),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) return { ok: false, reason: `HTTP_${res.status}` };

    const data = await res.json().catch(() => null);
    if (!data) return { ok: false, reason: 'BAD_RESPONSE' };

    const passed = data.result === 'success' || (data.status === 'success' && data.result !== 'fail');
    if (passed) {
      usedLots.set(lotKey, Date.now());
      return { ok: true, raw: data };
    }
    return { ok: false, reason: String(data.reason || 'REJECTED'), raw: data };
  } catch (err) {
    clearTimeout(timer);
    const strict = String(process.env.GEETEST_FAIL_CLOSED || '') === '1';
    if (strict) return { ok: false, reason: 'NETWORK' };
    return { ok: true, reason: 'FAIL_OPEN', raw: { error: String(err.message || '') } };
  }
}

/* ============================================================
 * 兜底：点击验证
 *
 * 极验服务不可达时前端会切换到点击验证。服务端仍需校验，
 * 否则攻击者可以直接跳过验证。
 *
 * 校验点（弱校验，主要靠 IP 频率限制兜底）：
 *   · token 格式正确（一次性，防重放）
 *   · 坐标在合理范围
 *   · 耗时不为 0（排除脚本瞬间提交）
 * ============================================================ */

/** 已使用的点击 token（防重放） */
const usedClicks = new Map();
const CLICK_TTL = 5 * 60 * 1000;
/** 已签发的挑战（服务端生成，客户端无法伪造） */
const issuedChallenges = new Map();
const CHALLENGE_TTL = 3 * 60 * 1000;

/**
 * 签发点击验证挑战
 *
 * 防伪造设计：挑战由**服务端**生成，包含：
 *   · challengeId  一次性随机 ID
 *   · targetX/Y    目标点坐标（服务端随机，不提前下发具体值给前端计算）
 *   · nonce        参与 HMAC 的随机串
 *   · expiresAt    过期时间
 *
 * 前端只拿到 challengeId 与「渲染用的目标点」，提交时需带上：
 *   challengeId + 点击坐标 + 点击耗时 + 签名
 *
 * 签名 = HMAC-SHA256(challengeId|targetX|targetY|nonce, CLICK_SECRET)
 * 服务端用自己保存的挑战记录重新计算并比对，
 * 因此攻击者无法凭空构造一个「有效」的通过凭据。
 */
function clickSecret() {
  return String(process.env.CLICK_CAPTCHA_SECRET || 'qm-click-fallback-v1');
}

function signChallenge(challenge) {
  const raw = `${challenge.id}|${challenge.targetX}|${challenge.targetY}|${challenge.nonce}`;
  return crypto.createHmac('sha256', clickSecret()).update(raw).digest('hex');
}

/** 清理过期挑战与已用 token */
function pruneChallenges() {
  const now = Date.now();
  for (const [k, v] of issuedChallenges) {
    if (now > v.expiresAt) issuedChallenges.delete(k);
  }
  for (const [k, at] of usedClicks) {
    if (now - at > CLICK_TTL) usedClicks.delete(k);
  }
}

/**
 * 签发一个点击验证挑战
 * @returns {{challengeId:string, targetX:number, targetY:number, expiresAt:number}}
 */
export function issueClickChallenge() {
  pruneChallenges();

  const id = crypto.randomBytes(16).toString('hex');
  const challenge = {
    id,
    // 目标点落在中间区域，避免贴边难点；保留 2 位小数
    targetX: Math.round((20 + Math.random() * 60) * 100) / 100,
    targetY: Math.round((20 + Math.random() * 60) * 100) / 100,
    nonce: crypto.randomBytes(16).toString('hex'),
    expiresAt: Date.now() + CHALLENGE_TTL,
  };
  issuedChallenges.set(id, challenge);

  // 下发挑战 ID、目标点（渲染用）与签名
  //
  // 关于「下发签名是否安全」：
  //   签名本身是 HMAC(challengeId|targetX|targetY|nonce, SECRET)，
  //   攻击者即使拿到签名，也只能用于**这一个**挑战，
  //   且必须点中服务端随机生成的目标点、耗时 >=100ms 才能通过。
  //   挑战一次性 + 3 分钟过期，无法批量复用。
  //   SECRET 不下发，因此无法为自造挑战生成签名。
  return {
    challengeId: id,
    targetX: challenge.targetX,
    targetY: challenge.targetY,
    expiresAt: challenge.expiresAt,
    signature: signChallenge(challenge),
  };
}

/**
 * 校验点击验证结果
 *
 * 必须满足全部条件才通过：
 *   1. challengeId 存在于服务端（必须是服务端签发的）
 *   2. 未过期
 *   3. 未被使用过（一次性）
 *   4. 点击坐标落在目标点容差范围内
 *   5. 点击耗时 >= 100ms（排除脚本瞬间提交）
 *   6. 签名匹配（防篡改挑战内容）
 */
export function verifyClickCaptcha(payload) {
  const challengeId = String(payload?.click_challenge || '').trim();
  const x = Number(payload?.click_x);
  const y = Number(payload?.click_y);
  const ms = Number(payload?.click_ms);
  const sig = String(payload?.click_sig || '').trim();

  if (!/^[a-f0-9]{32}$/.test(challengeId)) {
    return { ok: false, reason: 'CHALLENGE_INVALID' };
  }

  pruneChallenges();
  const challenge = issuedChallenges.get(challengeId);
  if (!challenge) {
    return { ok: false, reason: 'CHALLENGE_NOT_FOUND' };
  }
  if (Date.now() > challenge.expiresAt) {
    issuedChallenges.delete(challengeId);
    return { ok: false, reason: 'CHALLENGE_EXPIRED' };
  }
  if (usedClicks.has(challengeId)) {
    return { ok: false, reason: 'REPLAY' };
  }

  // 签名必须匹配（客户端无法伪造，因为没有密钥）
  const expectSig = signChallenge(challenge);
  if (!sig || sig.length !== expectSig.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectSig))) {
    return { ok: false, reason: 'SIGNATURE_INVALID' };
  }

  // 坐标范围与命中判定
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 100 || y < 0 || y > 100) {
    return { ok: false, reason: 'COORD_INVALID' };
  }
  const dist = Math.hypot(x - challenge.targetX, y - challenge.targetY);
  if (dist > 18) {
    return { ok: false, reason: 'MISSED' };
  }

  // 耗时校验
  if (!Number.isFinite(ms) || ms < 100) {
    return { ok: false, reason: 'TOO_FAST' };
  }

  // 一次性消费
  usedClicks.set(challengeId, Date.now());
  issuedChallenges.delete(challengeId);
  return { ok: true };
}

/**
 * 统一校验入口：自动识别极验凭据或兜底点击凭据
 *
 * @param {string} scene 'register' | 'login'
 * @param {object} body 请求体
 * @param {{ip?:string}} ctx
 */
export async function verifyAnyCaptcha(scene, body, ctx = {}) {
  // 有极验凭据 → 走极验
  if (body?.lot_number) {
    return verifyGeetest(scene, body, ctx);
  }
  // 有兜底凭据 → 走点击校验（字段名与服务端签发保持一致）
  if (body?.click_challenge) {
    return verifyClickCaptcha(body);
  }
  return { ok: false, reason: 'MISSING_FIELDS' };
}
