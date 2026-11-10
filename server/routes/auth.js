import express from 'express';
import {
  hashPassword,
  verifyPassword,
  needsRehash,
  isSha256Hex,
  BCRYPT_ROUNDS,
} from '../lib/password.js';
import crypto from 'node:crypto';
import {
  db,
  save,
  uid,
  findUserByEmail,
  findUserByPhone,
  findUserByUsername,
  findUserByIdentifier,
  findUserById,
  publicUser,
} from '../lib/db.js';
import {
  attachUser,
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  sessionToken,
  requireAuth,
} from '../lib/auth.js';
import {
  parseEmail,
  validatePassword,
  validateNickname,
  sanitizeText,
  validatePhone,
  validateUsername,
  normalizePhone,
  clientIp,
} from '../lib/util.js';
import { sendCodeMail, isMailConfigured } from '../lib/mailer.js';
import { eventLog } from '../lib/logger.js';
import { trustedClientIp } from '../lib/ip.js';
import { checkLock, recordFailure, recordSuccess } from '../lib/login-guard.js';
import {
  geetestConfigured,
  publicGeetestConfig,
  verifyGeetest,
  verifyAnyCaptcha,
  verifyAnyCaptchaWithPass,
  issueClickChallenge,
} from '../lib/geetest.js';
import {
  checkRegisterAllowed,
  recordRegisterAttempt,
  resetRegisterAttempts,
} from '../lib/register-guard.js';

const router = express.Router();

/** 会话元信息：角色快照 + 来源 IP/UA，用于防越权与审计 */
function sessionMeta(req, user) {
  return {
    role: user.role,
    ip: trustedClientIp(req) || '',
    ua: req.get('user-agent') || '',
  };
}


const CODE_TTL = 10 * 60 * 1000; // 10 分钟
const RESEND_GAP = 60 * 1000; // 60 秒
const MAX_PER_HOUR = 6;

const hashCode = (code) => crypto.createHash('sha256').update(String(code)).digest('hex');

function cleanupCodes() {
  const now = Date.now();
  const before = db.codes.length;
  db.codes = db.codes.filter((c) => c.expiresAt > now - 60_000);
  // 内存中删除的过期验证码必须同步删除数据库行，避免无限增长
  if (db.codes.length !== before) save('codes');
}

function defaultBindings() {
  return { wechat: null, qq: null, xiaohongshu: null };
}

function touchLogin(user, req) {
  user.lastLoginAt = new Date().toISOString();
  user.loginCount = (user.loginCount || 0) + 1;
  user.lastIp = clientIp(req);
  save();
}

/* ---------------- 人机验证配置（极验 GT4）---------------- */
router.get('/geetest/config', (req, res) => {
  // scene=register|login，默认 register 保持兼容
  const scene = String(req.query.scene || 'register');
  res.json(publicGeetestConfig(scene));
});

/* ---------------- 兜底点击验证：签发挑战 ---------------- */
/**
 * 签发一次性点击挑战
 *
 * 挑战由服务端生成并保存，前端只拿到 ID 与目标点，
 * 提交时必须带上服务端下发的签名，无法凭空伪造通过凭据。
 */
router.get('/click-challenge', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(issueClickChallenge());
});

/* ---------------- 邮箱后缀识别 ---------------- */
/**
 * 邮箱格式检查
 *
 * 安全修正（防账号枚举）：
 *   旧实现返回 registered: true/false，任何人可拿字典批量探测
 *   某邮箱是否已注册。现在只返回格式校验结果，
 *   **不透露注册状态**。
 *
 *   用户在注册/登录时会得到统一的模糊提示，
 *   真正需要确认时通过邮箱验证码流程完成。
 */
router.get('/email-check', (req, res) => {
  const info = parseEmail(req.query.email);
  // 只返回格式相关字段，剔除任何与注册状态有关的信息
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    valid: info.valid,
    label: info.label,
    domain: info.domain || '',
    provider: info.provider || '',
  });
});

/* ---------------- 可用性检查（手机号 / 用户名） ---------------- */
/**
 * 账号可用性检查
 *
 * 安全修正（防批量枚举）：
 *   旧实现直接返回 taken: true/false，任何人都能拿字典批量探测
 *   哪些用户名/邮箱已注册，属于典型的用户枚举漏洞。
 *
 *   现在：
 *     · 每 IP 每分钟限 20 次
 *     · 只返回格式是否合法，**不返回是否已被占用**
 *       （占用情况统一在注册/登录时提示，且带人机验证）
 *     · 前端因此无法用来批量探测
 */
const availHits = new Map();
const AVAIL_WINDOW = 60_000;
const AVAIL_MAX = 20;

router.get('/availability', (req, res) => {
  const ip = trustedClientIp(req) || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const rec = availHits.get(ip);
  if (!rec || now - rec.start > AVAIL_WINDOW) {
    availHits.set(ip, { start: now, count: 1 });
  } else {
    rec.count += 1;
    if (rec.count > AVAIL_MAX) {
      return res.status(429).json({ error: '查询过于频繁，请稍后再试', code: 'AVAILABILITY_RATE_LIMITED' });
    }
  }

  const phone = normalizePhone(req.query.phone);
  const username = String(req.query.username || '').trim();
  const result = { phone: null, username: null };

  if (phone) {
    const err = validatePhone(phone);
    result.phone = { valid: !err, error: err || '' };
  }
  if (username) {
    const err = validateUsername(username);
    // 只返回格式校验结果，不暴露 taken
    result.username = { valid: !err, error: err || '' };
  }
  res.setHeader('Cache-Control', 'no-store');
  res.json(result);
});

/* ---------------- 发送邮箱验证码 ---------------- */
router.post('/send-code', async (req, res) => {
  // 任意合法邮箱均可注册/登录
  let { email, purpose = 'register' } = req.body || {};
  if (!['register', 'login', 'email'].includes(purpose)) return res.status(400).json({ error: '验证码用途不合法' });

  const parsed = parseEmail(email);
  if (!parsed.valid) {
    return res.status(400).json({ error: parsed.label });
  }
  email = parsed.email;
  const info = { valid: true, domain: parsed.domain, provider: parsed.provider };

  const existing = findUserByEmail(email);

  /**
   * 安全修正（防账号枚举）：
   *   旧实现按 purpose 返回「该邮箱已注册 / 尚未注册」，
   *   攻击者可据此判断任意邮箱的注册状态。
   *
   *   现在统一处理：无论邮箱是否存在，都返回**相同的成功响应**，
   *   但只在邮箱确实需要时才真正发送邮件。
   *   这样响应完全一致，无法用于枚举。
   *
   *   例外：更换邮箱（purpose=email）必须明确告知占用情况，
   *   因为这是已登录用户的操作，且已通过密码 + 人机验证。
   */
  if (purpose === 'email') {
    // 更换绑定邮箱：必须已登录，且新邮箱不能被他人占用
    if (!req.user) return res.status(401).json({ error: '请先登录', code: 'NOT_AUTHENTICATED' });
    if (existing && existing.id !== req.user.id) {
      return res.status(409).json({ error: '该邮箱已被其他账号使用' });
    }
    if (existing && existing.id === req.user.id) {
      return res.status(400).json({ error: '新邮箱与当前绑定邮箱相同' });
    }
  }

  // 发送验证码前必须通过人机验证（防刷邮箱 / 短信轰炸）
  // 场景映射：更换邮箱使用独立的 email 场景凭据
  const scene = purpose === 'email' ? 'email' : purpose === 'register' ? 'register' : 'login';
  const captcha = await verifyAnyCaptchaWithPass(scene, req.body, { ip: clientIp(req) });
  if (!captcha.ok) {
    eventLog(req, '发码人机验证失败', `${email} · ${captcha.reason || ''}`.slice(0, 80), 'error');
    return res.status(400).json({
      error: '请先完成人机验证',
      code: 'CAPTCHA_REQUIRED',
      reason: captcha.reason,
    });
  }

  cleanupCodes();
  const now = Date.now();
  const mine = db.codes.filter((c) => c.email === email.toLowerCase() && c.purpose === purpose);

  const last = mine.sort((a, b) => b.createdAt - a.createdAt)[0];
  if (last && now - last.createdAt < RESEND_GAP) {
    return res.status(429).json({
      error: `发送过于频繁，请 ${Math.ceil((RESEND_GAP - (now - last.createdAt)) / 1000)} 秒后再试`,
      retryAfter: Math.ceil((RESEND_GAP - (now - last.createdAt)) / 1000),
    });
  }
  const hourCount = mine.filter((c) => now - c.createdAt < 3600_000).length;
  if (hourCount >= MAX_PER_HOUR) return res.status(429).json({ error: '该邮箱验证码发送次数过多，请稍后再试' });

  /**
   * 枚举防护：注册场景下邮箱已存在、登录场景下邮箱不存在时，
   * **不真正发信**，但返回与成功完全一致的响应。
   *
   * 这样攻击者无法通过响应差异判断账号是否存在；
   * 真实用户如果填错场景，会在后续步骤看到提示（此时已通过验证码门槛）。
   */
  const needSend =
    purpose === 'register'
      ? !existing
      : purpose === 'login'
        ? Boolean(existing)
        : true;

  if (!needSend) {
    eventLog(req, '验证码请求（未发信）', `${email} · ${purpose}`, 'info');
    return res.json({
      ok: true,
      expiresIn: CODE_TTL / 1000,
      resendAfter: RESEND_GAP / 1000,
      message: '若该邮箱符合条件，验证码将发送至你的邮箱',
      captchaPass: captcha.pass || null,
    });
  }

  const code = String(crypto.randomInt(100000, 999999));
  const record = {
    id: uid('code_'),
    email: email.toLowerCase(),
    domain: info.domain,
    purpose,
    codeHash: hashCode(code),
    createdAt: now,
    expiresAt: now + CODE_TTL,
    attempts: 0,
    ip: clientIp(req),
    consumed: false,
  };
  db.codes.push(record);
  save('codes');

  try {
    const result = await sendCodeMail(email, code, purpose);
    eventLog(req, '发送邮箱验证码', `${email} · ${purpose} · ${result.from}`);
    res.json({
      ok: true,
      expiresIn: CODE_TTL / 1000,
      resendAfter: RESEND_GAP / 1000,
      message: '验证码已发送至你的 QQ 邮箱',
      // 人机验证通行证：后续提交注册时携带，无需重复完成极验
      // （极验 lot_number 一次性，不复用会导致「发码通过但注册提示未通过」）
      captchaPass: captcha.pass || null,
    });
  } catch (err) {
    console.error('[auth] 验证码邮件发送失败:', err.message);
    // 发送失败则作废本次验证码，避免占用发送次数
    db.codes = db.codes.filter((c) => c.id !== record.id);
    save('codes');

    if (err.code === 'MAIL_NOT_CONFIGURED') {
      return res.status(503).json({ error: err.message, code: 'MAIL_NOT_CONFIGURED' });
    }

    // 根据 SMTP 返回码给出可操作的提示，便于管理员自助排查
    const raw = String(err.message || '');
    const detail = { smtpCode: err.responseCode || null, raw: raw.slice(0, 300) };

    if (/535|Invalid login|authentication/i.test(raw)) {
      return res.status(502).json({
        error: '邮箱授权码校验失败：请到 QQ 邮箱「设置 → 账户 → POP3/SMTP 服务」重新生成授权码后填写（注意不是登录密码）',
        code: 'SMTP_AUTH_FAILED',
        ...detail,
      });
    }
    if (/ETIMEDOUT|ETIMEDOUT|timeout|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i.test(raw)) {
      return res.status(502).json({
        error: '无法连接 QQ 邮箱服务器：请检查服务器是否放行 465/587 端口出站访问',
        code: 'SMTP_NETWORK',
        ...detail,
      });
    }
    if (/550|553|spam|rejected/i.test(raw)) {
      return res.status(502).json({
        error: '邮件被 QQ 邮箱拒收：可能是内容触发风控，或收件地址不存在',
        code: 'SMTP_REJECTED',
        ...detail,
      });
    }
    return res.status(502).json({
      error: '验证码邮件发送失败，请稍后重试或联系管理员',
      code: 'SMTP_FAILED',
      ...detail,
    });
  }
});

export function consumeCode(email, code, purpose) {
  const now = Date.now();
  const target = String(email || '').toLowerCase();
  const list = db.codes
    .filter((c) => c.email === target && c.purpose === purpose && !c.consumed)
    .sort((a, b) => b.createdAt - a.createdAt);
  const record = list[0];
  if (!record) return { ok: false, error: '请先获取邮箱验证码' };
  if (record.expiresAt < now) return { ok: false, error: '验证码已过期，请重新获取' };
  if (record.attempts >= 5) return { ok: false, error: '验证码错误次数过多，请重新获取' };
  if (record.codeHash !== hashCode(code)) {
    record.attempts += 1;
    save('codes');
    return { ok: false, error: `验证码不正确，还可尝试 ${5 - record.attempts} 次` };
  }
  record.consumed = true;
  save('codes');
  return { ok: true, record };
}

/** 注册公共校验：滑块 + IP 频率 */
/**
 * 注册守卫（两步式）
 *
 * 步骤 1 precheckRegister：只做「限流 + 滑块是否已完成」的预检，**不消费**滑块。
 * 步骤 2 commitCaptcha：在所有业务校验通过、真正要创建账号时才消费滑块。
 *
 * 这样用户填错用户名/手机号等表单错误时，不需要重新拖动滑块，体验更好；
 * 同时因为最终提交时仍会消费，安全性与「一次性验证」保持一致。
 */
/**
 * 注册前置校验：极验人机验证 + IP 频率限制
 *
 * 与旧滑块的区别：极验的一次性由服务端 lot_number 去重保证，
 * 因此不再需要「预检/消费」两段式 —— 校验通过即可创建账号。
 */
async function precheckRegister(req) {
  // 先判断限流，避免被限流的用户白白消耗一次验证
  const limited = checkRegisterAllowed(req);
  if (limited) return { ok: false, status: limited.status, body: limited.body };

  if (geetestConfigured('register')) {
    const gt = await verifyAnyCaptchaWithPass('register', req.body, { ip: clientIp(req) });
    if (!gt.ok) {
      eventLog(req, '注册人机验证失败', String(gt.reason || '').slice(0, 60), 'error');
      return {
        ok: false,
        status: 400,
        body: { error: '人机验证未通过，请重新完成验证', code: 'GEETEST_FAILED', reason: gt.reason },
      };
    }
  }
  return { ok: true };
}

/** 注册失败时累计 IP 计数，超限则封禁 */
function afterRegisterFailure(req, detail) {
  const result = recordRegisterAttempt(req, detail);
  if (result.blocked) {
    return result.permanent
      ? {
          status: 403,
          body: {
            error: '该 IP 注册请求过于频繁，已被永久限制访问，如有疑问请加入交流群联系管理员',
            code: 'IP_BLOCKED',
          },
        }
      : {
          status: 429,
          body: {
            error: `注册请求过于频繁，已临时限制该 IP ${Math.round((result.seconds || 1800) / 60)} 分钟`,
            code: 'REGISTER_BLOCKED',
            retryAfter: result.seconds,
          },
        };
  }
  return null;
}

/* ---------------- 注册（QQ 邮箱 / 手机号） ---------------- */
router.post('/register', async (req, res) => {
  // email 会被规范化为「QQ号@qq.com」，用 let
  let { email, username, code, password, nickname } = req.body || {};

  // 1) 限流 + 人机验证
  const guard = await precheckRegister(req);
  if (!guard.ok) return res.status(guard.status).json(guard.body);

  // 2) 密码强度
  const clientHashed = isSha256Hex(password);
  const pwdError = clientHashed ? null : validatePassword(password);
  if (pwdError) {
    const blocked = afterRegisterFailure(req, '密码强度不足');
    return res.status(blocked?.status || 400).json(blocked?.body || { error: pwdError });
  }

  /**
   * 3) **先校验邮箱凭证**（格式 + 验证码），再做用户名/昵称校验
   *
   * 安全修正（防用户名枚举 oracle）：
   *   旧顺序先查用户名是否重复，攻击者不需要邮箱验证码
   *   就能批量探测「某用户名是否已注册」——典型的免凭证枚举。
   *
   *   现在把需要凭证的邮箱验证码校验提到最前：
   *   攻击者必须先拥有该邮箱的控制权（收到验证码）才能进入
   *   用户名校验分支，枚举成本提升到"需要大量真实邮箱"。
   */
  let emailInfo = null;
  const normalizedPhone = '';
  {
    const parsed = parseEmail(email);
    if (!parsed.valid) {
      const blocked = afterRegisterFailure(req, '邮箱格式不正确');
      return res
        .status(blocked?.status || 400)
        .json(blocked?.body || { error: parsed.label });
    }
    email = parsed.email;
    emailInfo = { valid: true, domain: parsed.domain, provider: parsed.provider };

    if (!/^\d{6}$/.test(String(code || ''))) {
      const blocked = afterRegisterFailure(req, '验证码格式错误');
      return res.status(blocked?.status || 400).json(blocked?.body || { error: '请输入 6 位数字验证码' });
    }
    const checked = consumeCode(email, code, 'register');
    if (!checked.ok) {
      const blocked = afterRegisterFailure(req, '验证码校验失败');
      return res.status(blocked?.status || 400).json(blocked?.body || { error: checked.error });
    }
  }

  // 4) 凭证校验通过后，才检查邮箱是否已注册（此时已证明邮箱归属）
  if (findUserByEmail(email)) {
    const blocked = afterRegisterFailure(req, '邮箱已注册');
    return res.status(blocked?.status || 409).json(blocked?.body || { error: '该邮箱已注册，请直接登录' });
  }

  // 5) 用户名 / 昵称校验（需要凭证才能到达，不再构成枚举 oracle）
  const nameError = validateUsername(username);
  if (nameError) {
    const blocked = afterRegisterFailure(req, '用户名不合法');
    return res.status(blocked?.status || 400).json(blocked?.body || { error: nameError });
  }
  if (findUserByUsername(username)) {
    const blocked = afterRegisterFailure(req, '用户名重复');
    return res.status(blocked?.status || 409).json(blocked?.body || { error: '该用户名已被使用，请换一个' });
  }

  const nick = sanitizeText(nickname, 16) || String(username).trim();
  const nickError = validateNickname(nick);
  if (nickError) {
    const blocked = afterRegisterFailure(req, '昵称不合法');
    return res.status(blocked?.status || 400).json(blocked?.body || { error: nickError });
  }

  // 6) 创建账号
  const now = new Date().toISOString();
  const user = {
    id: uid('u_'),
    email: emailInfo?.valid ? String(email).toLowerCase() : '',
    emailDomain: emailInfo?.valid ? emailInfo.domain : '',
    phone: normalizedPhone,
    username: String(username).trim(),
    nickname: nick,
    passwordHash: hashPassword(password),
    role: 'user',
    status: 'active',
    bio: '',
    avatarHue: crypto.randomInt(0, 360),
    createdAt: now,
    lastLoginAt: now,
    loginCount: 1,
    lastIp: clientIp(req),
    bindings: defaultBindings(),
    bindingChanges: { month: '', count: 0 },
    stats: { claims: 0, approved: 0, rejected: 0 },
  };
  db.users.push(user);
  save();

  recordRegisterAttempt(req, 'success', { success: true });
  resetRegisterAttempts(req);

  const { token, sessionId } = createSession(user.id, sessionMeta(req, user));
  setSessionCookie(res, token);
  eventLog(req, '注册账号', `${user.username} · ${user.email}`);
  res.status(201).json({ user: publicUser(user), sessionId });
});

/* ---------------- 密码登录（邮箱 / 手机号 / 用户名） ---------------- */
router.post('/login', async (req, res) => {
  const { identifier, password } = req.body || {};
  const raw = String(identifier || '').trim();
  if (!raw) return res.status(400).json({ error: '请输入邮箱或用户名' });

  // 暴力破解防护：锁定期间直接拒绝，即使密码正确
  const lock = checkLock(raw, clientIp(req));
  if (lock.locked) {
    eventLog(req, '登录被拒绝（账号/IP 已锁定）', raw, 'error');
    res.setHeader('Retry-After', String(lock.retryAfter));
    return res.status(429).json({
      error: `尝试次数过多，请在 ${Math.ceil(lock.retryAfter / 60)} 分钟后再试`,
      code: 'LOGIN_LOCKED',
      retryAfter: lock.retryAfter,
      scope: lock.scope,
    });
  }

  const user = findUserByIdentifier(raw);
  // 恒定时间防护：无论账号是否存在都执行一次 bcrypt 比对，
  // 避免「响应时间差异」被用于枚举已注册账号
  const DUMMY_HASH = '$2a$12$Qd3s8Yq1nZ0mW4kR7vT2uOaHcJfLpXeN6bM5gS9wV1yU3iI8oK0C';
  const passwordOk = verifyPassword(String(password || ''), user?.passwordHash || DUMMY_HASH);

  if (!user || !passwordOk) {
    // 传入密码值用于「同一密码横扫多账号」的撞库检测
    const fail = recordFailure(raw, clientIp(req), String(password || ''));
    eventLog(req, '登录失败', raw, 'error');
    if (fail.sprayDetected) {
      eventLog(req, '检测到撞库攻击，已封禁来源 IP', clientIp(req), 'error');
      return res.status(429).json({
        error: '检测到异常的批量登录行为，该 IP 已被临时限制',
        code: 'CREDENTIAL_STUFFING_BLOCKED',
        retryAfter: 600,
      });
    }
    if (fail.accountLocked) {
      res.setHeader('Retry-After', String(fail.retryAfter));
      return res.status(429).json({
        error: `密码错误次数过多，账号已临时锁定 ${Math.ceil(fail.retryAfter / 60)} 分钟`,
        code: 'LOGIN_LOCKED',
        retryAfter: fail.retryAfter,
      });
    }
    // 安全：不回显剩余尝试次数，避免攻击者据此精确控制爆破节奏
    return res.status(401).json({ error: '账号或密码不正确' });
  }
  if (user.status === 'banned') {
    eventLog(req, '登录失败（账号已封禁）', raw, 'error');
    return res.status(403).json({ error: '账号已被封禁，如有疑问请加入交流群联系管理员' });
  }

  recordSuccess(raw, clientIp(req));
  // 旧哈希成本过低时透明升级，无需用户感知
  if (user && needsRehash(user.passwordHash)) {
    user.passwordHash = hashPassword(password);
    save();
  }
  // 密码正确后再做人机验证：
  // 这样密码错误时不必消耗验证次数，也避免验证结果被用于账号枚举
  if (geetestConfigured('login')) {
    const gt = await verifyAnyCaptchaWithPass('login', req.body, { ip: clientIp(req) });
    if (!gt.ok) {
      eventLog(req, '登录人机验证失败', String(gt.reason || '').slice(0, 60), 'error');
      return res.status(400).json({
        error: '人机验证未通过，请重新完成验证',
        code: 'GEETEST_FAILED',
        reason: gt.reason,
      });
    }
  }

  touchLogin(user, req);
  const { token, sessionId } = createSession(user.id, sessionMeta(req, user));
  setSessionCookie(res, token);
  eventLog(req, '登录成功', user.email || user.phone || user.username);
  res.json({ user: publicUser(user), sessionId });
});

/* ---------------- 验证码登录（邮箱） ---------------- */
router.post('/login-code', (req, res) => {
  let { email, code } = req.body || {};
  const parsed = parseEmail(email);
  if (!parsed.valid) return res.status(400).json({ error: parsed.label });
  email = parsed.email;
  const user = findUserByEmail(email);
  if (!user) {
    /**
     * 安全修正（防账号枚举）：
     *   旧实现返回 404「该邮箱尚未注册」，攻击者可用此区分
     *   邮箱是否已注册。现在统一返回「邮箱或验证码不正确」，
     *   与验证码错误的响应完全一致，无法据此判断账号存在性。
     */
    eventLog(req, '验证码登录失败', `${email} · 账号或验证码不匹配`, 'error');
    return res.status(400).json({ error: '邮箱或验证码不正确，请检查后重试' });
  }
  if (user.status === 'banned') return res.status(403).json({ error: '账号已被封禁，如有疑问请加入交流群联系管理员' });

  if (!/^\d{6}$/.test(String(code || ''))) return res.status(400).json({ error: '请输入 6 位数字验证码' });
  const checked = consumeCode(email, code, 'login');
  if (!checked.ok) return res.status(400).json({ error: checked.error });

  touchLogin(user, req);
  const { token, sessionId } = createSession(user.id, sessionMeta(req, user));
  setSessionCookie(res, token);
  eventLog(req, '验证码登录成功', user.email);
  res.json({ user: publicUser(user), sessionId });
});

/* ---------------- 会话 ---------------- */
router.get('/me', attachUser, (req, res) => {
  // 返回 sessionId 供前端恢复（刷新页面后 sessionStorage 已清空）
  res.json({
    user: req.user ? publicUser(req.user) : null,
    mailConfigured: isMailConfigured(),
    sessionId: req.session?.sessionId || null,
  });
});

router.post('/logout', (req, res) => {
  const token = sessionToken(req);
  if (req.user) eventLog(req, '退出登录', req.user.email || req.user.username);
  destroySession(token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

/* ---------------- 修改密码 ---------------- */
router.post('/change-password', attachUser, requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const user = findUserById(req.user.id);
  if (!verifyPassword(String(currentPassword || ''), user.passwordHash)) {
    return res.status(400).json({ error: '当前密码不正确' });
  }
  const pwdError = isSha256Hex(newPassword) ? null : validatePassword(newPassword);
  if (pwdError) return res.status(400).json({ error: pwdError });
  user.passwordHash = hashPassword(newPassword);
  // 安全：改密后失效该账号的全部其他会话，防止被盗会话继续可用
  const currentToken = req.session?.token;
  db.sessions = db.sessions.filter((s) => s.userId !== user.id || s.token === currentToken);
  save();
  eventLog(req, '修改登录密码', user.email || user.username);
  res.json({ ok: true, revokedOthers: true });
});

export default router;
