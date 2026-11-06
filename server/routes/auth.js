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
  parseQQNumberEmail,
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
import { checkLock, recordFailure, recordSuccess } from '../lib/login-guard.js';
import { createChallenge, verifyChallenge, consumeChallenge, peekChallenge } from '../lib/captcha.js';
import {
  checkRegisterAllowed,
  recordRegisterAttempt,
  resetRegisterAttempts,
} from '../lib/register-guard.js';

const router = express.Router();

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

/* ---------------- 滑块验证 ---------------- */
router.get('/captcha', (req, res) => {
  const challenge = createChallenge(clientIp(req));
  if (challenge.error) {
    return res.status(429).json({ error: challenge.error, retryAfter: challenge.retryAfter });
  }
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.json(challenge);
});

router.post('/captcha/verify', (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: '验证参数缺失' });
  const result = verifyChallenge(id);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ ok: true });
});

/* ---------------- 邮箱后缀识别 ---------------- */
router.get('/email-check', (req, res) => {
  const parsed = parseQQNumberEmail(req.query.email);
  if (!parsed) {
    return res.json({ valid: false, domain: '', provider: 'unknown', label: '请输入 5-11 位 QQ 号', registered: false });
  }
  const user = findUserByEmail(parsed.email);
  res.json({ valid: true, domain: 'qq.com', provider: 'qq', label: 'QQ邮箱', registered: Boolean(user) });
});

/* ---------------- 可用性检查（手机号 / 用户名） ---------------- */
router.get('/availability', (req, res) => {
  const phone = normalizePhone(req.query.phone);
  const username = String(req.query.username || '').trim();
  const result = { phone: null, username: null };

  if (phone) {
    const err = validatePhone(phone);
    result.phone = {
      value: phone,
      valid: !err,
      error: err || '',
      taken: !err ? Boolean(findUserByPhone(phone)) : false,
    };
  }
  if (username) {
    const err = validateUsername(username);
    result.username = {
      value: username,
      valid: !err,
      error: err || '',
      taken: !err ? Boolean(findUserByUsername(username)) : false,
    };
  }
  res.json(result);
});

/* ---------------- 发送邮箱验证码 ---------------- */
router.post('/send-code', async (req, res) => {
  const { email, purpose = 'register' } = req.body || {};
  if (!['register', 'login'].includes(purpose)) return res.status(400).json({ error: '验证码用途不合法' });

  const parsed = parseQQNumberEmail(email);
  if (!parsed) {
    return res.status(400).json({ error: '请输入 5-11 位 QQ 号，邮箱后缀固定为 @qq.com' });
  }
  email = parsed.email;
  const info = { valid: true, domain: 'qq.com', provider: 'qq' };

  const existing = findUserByEmail(email);
  if (purpose === 'register' && existing) return res.status(409).json({ error: '该邮箱已注册，请直接登录' });
  if (purpose === 'login' && !existing) return res.status(404).json({ error: '该邮箱尚未注册，请先注册账号' });

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
    });
  } catch (err) {
    console.error('[auth] 验证码邮件发送失败:', err.message);
    // 发送失败则作废本次验证码，避免占用发送次数
    db.codes = db.codes.filter((c) => c.id !== record.id);
    save('codes');
    if (err.code === 'MAIL_NOT_CONFIGURED') return res.status(503).json({ error: err.message });
    res.status(502).json({ error: '验证码邮件发送失败，请稍后重试或联系管理员' });
  }
});

function consumeCode(email, code, purpose) {
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
function precheckRegister(req) {
  const { captchaId } = req.body || {};
  if (!captchaId) {
    return { ok: false, status: 400, body: { error: '请先完成滑块验证', code: 'CAPTCHA_REQUIRED' } };
  }

  // 先判断限流，避免被限流的用户白白消耗滑块
  const limited = checkRegisterAllowed(req);
  if (limited) return { ok: false, status: limited.status, body: limited.body };

  // 校验滑块「已完成」但不消费
  const peek = peekChallenge(captchaId);
  if (!peek.ok) return { ok: false, status: 400, body: { error: peek.error, code: 'CAPTCHA_INVALID' } };

  return { ok: true };
}

/** 真正的提交时刻：一次性消费滑块 */
function commitCaptcha(req) {
  const { captchaId } = req.body || {};
  const consumed = consumeChallenge(captchaId);
  if (!consumed.ok) {
    return { ok: false, status: 400, body: { error: consumed.error, code: 'CAPTCHA_INVALID' } };
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
  const { method = 'email', email, phone, username, code, password, nickname } = req.body || {};

  // 1) 限流 + 滑块预检（不消费，允许修正表单后重试）
  const guard = precheckRegister(req);
  if (!guard.ok) return res.status(guard.status).json(guard.body);

  // 客户端可能传来 SHA-256 摘要（64 位 hex），此时强度由前端保证，服务端只做格式校验
  const clientHashed = isSha256Hex(password);
  const pwdError = clientHashed ? null : validatePassword(password);
  if (pwdError) {
    const blocked = afterRegisterFailure(req, '密码强度不足');
    return res.status(blocked?.status || 400).json(blocked?.body || { error: pwdError });
  }

  const nameError = validateUsername(username);
  if (nameError) {
    const blocked = afterRegisterFailure(req, '用户名不合法');
    return res.status(blocked?.status || 400).json(blocked?.body || { error: nameError });
  }
  if (findUserByUsername(username)) {
    const blocked = afterRegisterFailure(req, '用户名重复');
    return res.status(blocked?.status || 409).json(blocked?.body || { error: '该用户名已被使用，请换一个' });
  }

  // 清洗昵称，避免 HTML/脚本注入
  const nick = sanitizeText(nickname, 16) || String(username).trim();
  const nickError = validateNickname(nick);
  if (nickError) {
    const blocked = afterRegisterFailure(req, '昵称不合法');
    return res.status(blocked?.status || 400).json(blocked?.body || { error: nickError });
  }

  // 2) 账号标识校验
  let emailInfo = null;
  let normalizedPhone = '';
  if (method === 'phone') {
    const phoneError = validatePhone(phone);
    if (phoneError) {
      const blocked = afterRegisterFailure(req, '手机号不合法');
      return res.status(blocked?.status || 400).json(blocked?.body || { error: phoneError });
    }
    normalizedPhone = normalizePhone(phone);
    if (findUserByPhone(normalizedPhone)) {
      const blocked = afterRegisterFailure(req, '手机号已注册');
      return res.status(blocked?.status || 409).json(blocked?.body || { error: '该手机号已注册，请直接登录' });
    }
  } else {
    // 注册固定使用「QQ号@qq.com」
    const parsed = parseQQNumberEmail(email);
    if (!parsed) {
      const blocked = afterRegisterFailure(req, 'QQ 邮箱格式不正确');
      return res
        .status(blocked?.status || 400)
        .json(blocked?.body || { error: '请输入 5-11 位 QQ 号，邮箱后缀固定为 @qq.com' });
    }
    email = parsed.email;
    emailInfo = { valid: true, domain: 'qq.com', provider: 'qq' };
    if (findUserByEmail(email)) {
      const blocked = afterRegisterFailure(req, '邮箱已注册');
      return res.status(blocked?.status || 409).json(blocked?.body || { error: '该邮箱已注册，请直接登录' });
    }
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

  // 3) 所有校验通过，正式消费滑块（一次性）
  const commit = commitCaptcha(req);
  if (!commit.ok) return res.status(commit.status).json(commit.body);

  // 4) 创建账号
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

  // 记录成功尝试：频率窗口继续累计，仅清空失败计数
  recordRegisterAttempt(req, 'success', { success: true });
  resetRegisterAttempts(req);

  const token = createSession(user.id);
  setSessionCookie(res, token);
  eventLog(req, '注册账号', method === 'phone' ? `${user.username} · ${user.phone}` : `${user.username} · ${user.email}`);
  res.status(201).json({ user: publicUser(user) });
});

/* ---------------- 密码登录（邮箱 / 手机号 / 用户名） ---------------- */
router.post('/login', (req, res) => {
  const { identifier, password } = req.body || {};
  const raw = String(identifier || '').trim();
  if (!raw) return res.status(400).json({ error: '请输入邮箱、手机号或用户名' });

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
  touchLogin(user, req);
  const token = createSession(user.id);
  setSessionCookie(res, token);
  eventLog(req, '登录成功', user.email || user.phone || user.username);
  res.json({ user: publicUser(user) });
});

/* ---------------- 验证码登录（QQ 邮箱） ---------------- */
router.post('/login-code', (req, res) => {
  let { email, code } = req.body || {};
  const parsed = parseQQNumberEmail(email);
  if (!parsed) return res.status(400).json({ error: '请输入 5-11 位 QQ 号，邮箱后缀固定为 @qq.com' });
  email = parsed.email;
  const user = findUserByEmail(email);
  if (!user) return res.status(404).json({ error: '该邮箱尚未注册，请先注册账号' });
  if (user.status === 'banned') return res.status(403).json({ error: '账号已被封禁，如有疑问请加入交流群联系管理员' });

  if (!/^\d{6}$/.test(String(code || ''))) return res.status(400).json({ error: '请输入 6 位数字验证码' });
  const checked = consumeCode(email, code, 'login');
  if (!checked.ok) return res.status(400).json({ error: checked.error });

  touchLogin(user, req);
  const token = createSession(user.id);
  setSessionCookie(res, token);
  eventLog(req, '验证码登录成功', user.email);
  res.json({ user: publicUser(user) });
});

/* ---------------- 会话 ---------------- */
router.get('/me', attachUser, (req, res) => {
  res.json({ user: req.user ? publicUser(req.user) : null, mailConfigured: isMailConfigured() });
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
