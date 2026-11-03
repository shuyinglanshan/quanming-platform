import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import multer from 'multer';
import { UPLOAD_DIR } from './db.js';
import { hashFile } from './file-integrity.js';

/**
 * 图片上传
 * 安全措施：
 * - 仅允许位图格式（禁止 SVG，避免脚本执行导致的存储型 XSS）
 * - 校验文件头（magic bytes），防止改扩展名伪装
 * - 服务端重命名，忽略原始文件名（避免路径穿越与同名覆盖）
 * - 大小 / 数量限制
 */

const EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'image/avif': '.avif',
};

const ALLOWED = new Set(Object.keys(EXT));

/** 允许的文件扩展名（与 MIME 一一对应） */
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif', '.avif']);

/** 明确禁止的危险扩展名（防止可执行脚本上传） */
const FORBIDDEN_EXT = new Set([
  '.php', '.php3', '.php4', '.php5', '.phtml', '.phar', '.pht',
  '.jsp', '.jspx', '.asp', '.aspx', '.ashx', '.asmx', '.cer',
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx',
  '.py', '.rb', '.pl', '.sh', '.bash', '.zsh', '.cgi', '.lua',
  '.exe', '.dll', '.so', '.bat', '.cmd', '.com', '.msi', '.vbs', '.wsf',
  '.html', '.htm', '.xhtml', '.shtml', '.svg', '.svgz', '.xml', '.xsl',
  '.htaccess', '.htpasswd', '.ini', '.conf', '.config',
  '.jar', '.war', '.class', '.zip', '.rar', '.7z', '.tar', '.gz',
]);

/**
 * 严格校验文件扩展名
 * 拦截：非图片后缀、双扩展名（a.png.php）、尾随点/空格（a.php.）、大小写绕过
 */
function validateExtension(originalName) {
  const raw = String(originalName || '').trim();
  if (!raw) return { ok: false, reason: '文件名缺失' };

  // 规范化：去尾随点与空格（Windows 会忽略，可被用于绕过）
  const cleaned = raw.replace(/[\s.]+$/, '');
  const ext = path.extname(cleaned).toLowerCase();

  if (!ext) return { ok: false, reason: '文件缺少扩展名' };
  if (FORBIDDEN_EXT.has(ext)) return { ok: false, reason: `禁止上传 ${ext} 类型文件` };
  if (!ALLOWED_EXT.has(ext)) return { ok: false, reason: '仅允许 JPG / PNG / WEBP / GIF / HEIC / AVIF 格式' };

  // 双扩展名检测：a.png.php 的 basename 中还含有其他扩展名段
  const base = path.basename(cleaned, ext);
  const innerExt = path.extname(base).toLowerCase();
  if (innerExt && (FORBIDDEN_EXT.has(innerExt) || ALLOWED_EXT.has(innerExt))) {
    return { ok: false, reason: '检测到多重扩展名，请重命名后上传' };
  }
  // 文件名中不得含路径分隔符或空字节
  if (/[\/\\\0]/.test(raw)) return { ok: false, reason: '文件名包含非法字符' };

  return { ok: true, ext };
}

/** 常见图片格式的文件头 */
const SIGNATURES = [
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: 'image/gif', test: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 },
  { mime: 'image/webp', test: (b) => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' },
  { mime: 'image/heic', test: (b) => b.slice(4, 12).toString().includes('ftyp') },
  { mime: 'image/avif', test: (b) => b.slice(4, 12).toString().includes('ftypavi') },
];

function matchesSignature(buffer, mimetype) {
  const sig = SIGNATURES.find((s) => s.mime === mimetype);
  if (!sig) return false;
  return sig.test(buffer);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    const now = new Date();
    const sub = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const dir = path.join(UPLOAD_DIR, sub);
    ensureDir(dir);
    cb(null, dir);
  },
  filename(_req, file, cb) {
    // 完全使用服务端生成的文件名，不信任用户提交的名称
    const ext = EXT[file.mimetype] || '.jpg';
    cb(null, `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  },
});

const uploader = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024, files: 6, fields: 20, parts: 30 },
  fileFilter(_req, file, cb) {
    // ① MIME 白名单
    if (!ALLOWED.has(file.mimetype)) {
      return cb(new Error('仅支持 JPG / PNG / WEBP / GIF / HEIC / AVIF 等图片格式'));
    }
    // ② 扩展名白名单（拦截可执行脚本与双扩展名）
    const check = validateExtension(file.originalname);
    if (!check.ok) {
      return cb(new Error(check.reason));
    }
    // ③ 扩展名必须与 MIME 匹配，防止 .png 伪装成 gif 等
    const expected = EXT[file.mimetype];
    const actual = path.extname(String(file.originalname || '').replace(/[\s.]+$/, '')).toLowerCase();
    const normalizedActual = actual === '.jpeg' ? '.jpg' : actual;
    if (normalizedActual !== expected) {
      return cb(new Error('文件扩展名与内容类型不匹配'));
    }
    cb(null, true);
  },
});

/** 包装：写入后再校验文件头，不匹配则删除并报错 */
function withSignatureCheck(req, res, next) {
  if (!req.files?.length) return next();

  const cleanup = () => {
    for (const f of req.files) {
      try {
        fs.unlinkSync(f.path);
      } catch {}
    }
  };

  for (const file of req.files) {
    try {
      const fd = fs.openSync(file.path, 'r');
      const buf = Buffer.alloc(16);
      fs.readSync(fd, buf, 0, 16, 0);
      fs.closeSync(fd);
      if (!matchesSignature(buf, file.mimetype)) {
        cleanup();
        return res.status(415).json({ error: '文件内容不是有效图片，请重新上传' });
      }
    } catch {
      cleanup();
      return res.status(415).json({ error: '图片校验失败，请重新上传' });
    }
  }
  next();
}

/** 组合中间件：数量限制 + 类型校验 + 文件头校验 */
export const upload = {
  array: (field, maxCount) => {
    const handler = uploader.array(field, maxCount);
    return (req, res, next) => {
      handler(req, res, (err) => {
        if (err) return next(err);
        // 没有文件时直接放行，由业务层决定是否必填
        if (!req.files || req.files.length === 0) return next();
        withSignatureCheck(req, res, next);
      });
    };
  },
};

/**
 * 删除本次请求已落盘的上传文件
 * 业务校验失败（圈名重复、参数非法等）时必须调用，否则文件会永久遗留，
 * 攻击者可借此反复上传撑爆磁盘。
 */
export function discardUploads(files) {
  if (!Array.isArray(files)) return;
  for (const file of files) {
    try {
      fs.unlinkSync(file.path);
    } catch {}
  }
}

/**
 * 单用户上传字节配额（每小时）
 * 防止已登录账号通过 /claims/upload 反复上传但从不提交，无限占用磁盘。
 */
const QUOTA_WINDOW = 3600_000;
const QUOTA_BYTES = 200 * 1024 * 1024;
const quota = new Map(); // userId -> { windowStart, bytes }

function quotaRecord(userId) {
  const now = Date.now();
  let rec = quota.get(userId);
  if (!rec || now - rec.windowStart >= QUOTA_WINDOW) {
    rec = { windowStart: now, bytes: 0 };
    quota.set(userId, rec);
  }
  return rec;
}

/** 解析上传前预估：超出配额直接拒绝，避免大文件落盘 */
export function uploadByteQuota(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '请先登录后再继续操作' });
  const rec = quotaRecord(req.user.id);
  const length = Number(req.get('content-length')) || 0;
  if (rec.bytes + length > QUOTA_BYTES) {
    return res.status(429).json({
      error: '本小时上传流量已用完，请稍后再试',
      code: 'UPLOAD_QUOTA_EXCEEDED',
      retryAfter: Math.max(1, Math.ceil((rec.windowStart + QUOTA_WINDOW - Date.now()) / 1000)),
    });
  }
  req.uploadQuota = rec;
  if (quota.size > 5000) {
    const now = Date.now();
    for (const [key, value] of quota) {
      if (now - value.windowStart >= QUOTA_WINDOW) quota.delete(key);
    }
  }
  next();
}

/** 上传完成后计入配额（失败请求同样计入，防止反复试探） */
export function chargeUploadQuota(req) {
  if (!req.uploadQuota || !Array.isArray(req.files)) return;
  req.uploadQuota.bytes += req.files.reduce((sum, f) => sum + (f.size || 0), 0);
}

/** 将 multer 的落盘信息转为前端可用的相对路径 */
export function fileRecord(file) {
  const rel = path.relative(UPLOAD_DIR, file.path).split(path.sep).join('/');
  // 生成内容哈希：用于防篡改校验、去重与审计溯源
  let sha256 = '';
  try {
    sha256 = hashFile(file.path);
  } catch (err) {
    console.error('[upload] 计算文件哈希失败:', err.message);
  }
  return {
    url: `/uploads/${rel}`,
    // 原始文件名仅用于展示，做长度与字符限制
    name: String(file.originalname || 'image').replace(/[<>\r\n]/g, '').slice(0, 80),
    size: file.size,
    mime: file.mimetype,
    sha256,
    uploadedAt: new Date().toISOString(),
  };
}
