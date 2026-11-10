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
      // 签发短期通行证：同一用户后续步骤（如发码后再注册）
      // 不必重复完成极验，凭通行证即可
      const pass = issueCaptchaPass(scene, ctx.ip);
      return { ok: true, raw: data, pass };
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
/**
 * 点击验证失败计数（按 IP）
 *
 * 12 格盲猜单次命中率 1/12，若不限制，攻击者几十次就能蒙对。
 * 这里限制每 IP 每分钟最多失败 5 次，超出则拒绝并要求等待。
 */
const clickFails = new Map();
const CLICK_FAIL_WINDOW = 60_000;
const CLICK_FAIL_MAX = 5;

function noteClickFail(ip) {
  const now = Date.now();
  const rec = clickFails.get(ip);
  if (!rec || now - rec.start > CLICK_FAIL_WINDOW) {
    clickFails.set(ip, { start: now, count: 1 });
    return { blocked: false };
  }
  rec.count += 1;
  return { blocked: rec.count > CLICK_FAIL_MAX, retryAfter: Math.ceil((CLICK_FAIL_WINDOW - (now - rec.start)) / 1000) };
}

function isClickBlocked(ip) {
  const now = Date.now();
  const rec = clickFails.get(ip);
  if (!rec || now - rec.start > CLICK_FAIL_WINDOW) return false;
  return rec.count > CLICK_FAIL_MAX;
}
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

// signChallenge 已移除：目标点不再下发，无需下发签名

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

  /**
   * 目标点**绝不下发给客户端**
   *
   * 旧实现把 targetX/targetY 与 signature 一起返回，
   * 攻击者只需 GET 一次挑战，回填坐标即可通过 —— 等于没有验证。
   *
   * 现在改为：
   *   · 服务端生成一组随机图标，其中一个为目标
   *   · 只下发「网格布局」与「哪个格子是目标」的**哈希**，
   *     不告诉客户端哪一个是目标
   *   · 客户端必须由用户肉眼识别并点击
   *   · 校验时服务端按点击坐标反推格子，与记录的目标比对
   */
  const cols = 4;
  const rows = 3;
  const targetCell = crypto.randomInt(0, cols * rows); // 0..11
  const nonce = crypto.randomBytes(16).toString('hex');

  const challenge = {
    id,
    cols,
    rows,
    targetCell,
    nonce,
    expiresAt: Date.now() + CHALLENGE_TTL,
  };
  issuedChallenges.set(id, challenge);

  // 只下发渲染所需信息：
  //   · 12 个格子的图标（随机排列，目标格用特殊标记但不告知序号）
  //   · 挑战 ID 与过期时间
  // 不下发 targetCell、不下发任何可直接用于提交的签名
  const icons = Array.from({ length: cols * rows }, (_, i) =>
    i === targetCell ? 'target' : `decoy-${(i * 7919) % 13}`,
  );
  // 打乱图标顺序，避免「target 总在固定位置」被推断
  for (let i = icons.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [icons[i], icons[j]] = [icons[j], icons[i]];
  }

  return {
    challengeId: id,
    cols,
    rows,
    expiresAt: challenge.expiresAt,
    // 图标数组：客户端只能看到"有一个特殊图标"，但不知道它在第几个
    icons,
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
export function verifyClickCaptcha(payload, ctx = {}) {
  const ipKey = String(ctx.ip || 'unknown');
  if (isClickBlocked(ipKey)) {
    return { ok: false, reason: 'TOO_MANY_FAILS' };
  }
  const challengeId = String(payload?.click_challenge || '').trim();
  const x = Number(payload?.click_x);
  const y = Number(payload?.click_y);
  const ms = Number(payload?.click_ms);

  if (!/^[a-f0-9]{32}$/.test(challengeId)) {
    return { ok: false, reason: 'CHALLENGE_INVALID' };
  }

  pruneChallenges();
  const challenge = issuedChallenges.get(challengeId);
  if (!challenge) {
    noteClickFail(ipKey); return { ok: false, reason: 'CHALLENGE_NOT_FOUND' };
  }
  if (Date.now() > challenge.expiresAt) {
    issuedChallenges.delete(challengeId);
    noteClickFail(ipKey); return { ok: false, reason: 'CHALLENGE_EXPIRED' };
  }
  if (usedClicks.has(challengeId)) {
    return { ok: false, reason: 'REPLAY' };
  }

  // 坐标范围校验
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 100 || y < 0 || y > 100) {
    noteClickFail(ipKey); return { ok: false, reason: 'COORD_INVALID' };
  }

  /**
   * 命中判定：把点击坐标换算成网格行列，必须正好落在目标格
   *
   * 旧实现用「距目标点 18% 以内」的宽松判定，配合下发坐标，
   * 攻击者可以精确命中。
   *
   * 现在目标格由服务端私有持有，客户端只能靠人眼识别图标后点击，
   * 因此用格子判定即可，既严格又不影响正常用户。
   */
  const col = Math.min(challenge.cols - 1, Math.floor((x / 100) * challenge.cols));
  const row = Math.min(challenge.rows - 1, Math.floor((y / 100) * challenge.rows));
  const clickedCell = row * challenge.cols + col;

  if (clickedCell !== challenge.targetCell) {
    // 消耗挑战，防止无限试错
    usedClicks.set(challengeId, Date.now());
    issuedChallenges.delete(challengeId);
    noteClickFail(ipKey); return { ok: false, reason: 'WRONG_CELL' };
  }

  // 耗时校验（排除脚本瞬间提交）
  if (!Number.isFinite(ms) || ms < 150) {
    usedClicks.set(challengeId, Date.now());
    issuedChallenges.delete(challengeId);
    noteClickFail(ipKey); return { ok: false, reason: 'TOO_FAST' };
  }

  // 一次性消费
  usedClicks.set(challengeId, Date.now());
  issuedChallenges.delete(challengeId);
  // 签发短期通行证，供后续步骤复用
  return { ok: true, pass: issueCaptchaPass('click', ipKey) };
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
    return verifyClickCaptcha(body, ctx);
  }
  return { ok: false, reason: 'MISSING_FIELDS' };
}


/* ============================================================
 * 人机验证通行证
 *
 * 问题背景：
 *   极验的 lot_number 与点击挑战都是一次性的，
 *   但注册流程需要在两个步骤验证人机：
 *     ① 发送邮箱验证码时
 *     ② 提交注册表单时
 *   若两次都要求重新完成极验，用户体验极差；
 *   若第二次直接复用 lot_number，又会被防重放机制拒绝
 *   （这正是「完成验证后点注册却提示未通过」的原因）。
 *
 * 解决方案：
 *   首次验证通过后签发一个**短期一次性通行证**（5 分钟），
 *   前端在后续步骤携带它，服务端校验签名与时效，
 *   无需再次完成极验，也不会突破「一次验证一次用」的安全语义
 *   （通行证本身有 TTL、与 IP 绑定、可撤销）。
 * ============================================================ */

const CAPTCHA_PASS_TTL = 5 * 60 * 1000;
const captchaPasses = new Map();

function passSecret() {
  return String(process.env.CAPTCHA_PASS_SECRET || 'qm-captcha-pass-v1');
}

/**
 * 签发通行证
 * @param {string} scene 场景标识
 * @param {string} ip 绑定的来源 IP
 */
export function issueCaptchaPass(scene, ip) {
  const now = Date.now();
  const id = crypto.randomBytes(16).toString('hex');
  const payload = `${id}|${scene}|${ip || ''}|${now}`;
  const sig = crypto.createHmac('sha256', passSecret()).update(payload).digest('hex');
  captchaPasses.set(id, {
    scene,
    ip: String(ip || ''),
    expiresAt: now + CAPTCHA_PASS_TTL,
  });
  // 定期清理
  if (captchaPasses.size > 5000) {
    for (const [k, v] of captchaPasses) {
      if (Date.now() > v.expiresAt) captchaPasses.delete(k);
    }
  }
  return `${id}.${sig}`;
}

/**
 * 校验通行证
 * @param {string} token `${id}.${sig}`
 * @param {string} scene
 * @param {string} ip
 */
export function verifyCaptchaPass(token, scene, ip) {
  const raw = String(token || '').trim();
  if (!raw) return { ok: false, reason: 'NO_PASS' };

  const dot = raw.lastIndexOf('.');
  if (dot < 0) return { ok: false, reason: 'PASS_FORMAT' };

  const id = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const rec = captchaPasses.get(id);
  if (!rec) return { ok: false, reason: 'PASS_NOT_FOUND' };
  if (Date.now() > rec.expiresAt) {
    captchaPasses.delete(id);
    return { ok: false, reason: 'PASS_EXPIRED' };
  }

  // 场景与 IP 必须匹配（防止跨场景/跨来源盗用）
  if (rec.scene !== scene) return { ok: false, reason: 'PASS_SCENE_MISMATCH' };
  if (rec.ip && ip && rec.ip !== String(ip)) return { ok: false, reason: 'PASS_IP_MISMATCH' };

  // 签名校验
  const expect = crypto
    .createHmac('sha256', passSecret())
    .update(`${id}|${rec.scene}|${rec.ip}|${rec.expiresAt - CAPTCHA_PASS_TTL}`)
    .digest('hex');
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) {
    return { ok: false, reason: 'PASS_SIGNATURE' };
  }

  // 一次性消费
  captchaPasses.delete(id);
  return { ok: true };
}

/**
 * 统一入口：允许「新凭据」或「已有通行证」二选一
 *
 * 用于注册/登录/发码这类需要人机验证的接口：
 *   · 首次调用传极验凭据 → 通过后返回 pass
 *   · 后续步骤传 pass → 直接通过，不必重新验证
 */
export async function verifyAnyCaptchaWithPass(scene, body, ctx = {}) {
  // 1) 优先用通行证
  if (body?.captcha_pass) {
    const p = verifyCaptchaPass(body.captcha_pass, scene, ctx.ip);
    if (p.ok) return { ok: true, reused: true };
    // 通行证无效则继续走新凭据校验
  }
  // 2) 新凭据
  return verifyAnyCaptcha(scene, body, ctx);
}
