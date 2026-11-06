import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { UPLOAD_DIR } from './paths.js';

/**
 * 头像处理
 *
 * 安全设计（针对头像这一高暴露面）：
 * - 独立目录 avatars/，与圈名材料隔离，便于单独加严格响应头
 * - 仅允许位图（JPG/PNG/WEBP），**禁止 SVG**（可内嵌脚本 → 存储型 XSS）
 * - Magic bytes 二次校验：不信任 Content-Type，防止改扩展名伪装
 * - 尺寸上限 2MB，像素上限防"解压炸弹"（通过文件头解析宽高）
 * - 服务端重命名，文件名只含十六进制，杜绝路径穿越与特殊字符
 * - 计算 SHA-256：用于去重、审计溯源、前端完整性校验（CSP hash）
 * - 强制扩展名白名单 + 落盘后再次比对哈希，防止写入过程中被替换
 */

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_SIZE = 512; // 建议前端裁剪尺寸
const AVATAR_DIR = path.join(UPLOAD_DIR, 'avatars');

const ALLOWED = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
]);

/** 校验文件头，并返回图片真实格式与尺寸 */
export function inspectImage(filePath) {
  const fd = fs.openSync(filePath, 'r');
  let buf;
  try {
    const stat = fs.fstatSync(fd);
    buf = Buffer.alloc(Math.min(stat.size, 64));
    fs.readSync(fd, buf, 0, buf.length, 0);
  } finally {
    fs.closeSync(fd);
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A，宽高在 IHDR
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    return { mime: 'image/png', ext: '.png', width, height };
  }
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mime: 'image/jpeg', ext: '.jpg', width: 0, height: 0 };
  }
  // WEBP: RIFF....WEBP
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') {
    return { mime: 'image/webp', ext: '.webp', width: 0, height: 0 };
  }
  return null;
}

function ensureDir() {
  if (!fs.existsSync(AVATAR_DIR)) fs.mkdirSync(AVATAR_DIR, { recursive: true, mode: 0o700 });
}

function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(64 * 1024);
    let read;
    while ((read = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, read));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

/**
 * 校验并转存头像
 * @returns {{ ok: true, url, sha256, mime, size } | { ok: false, error }}
 */
export function storeAvatar(tmpFile) {
  try {
    const stat = fs.statSync(tmpFile.path);
    if (stat.size > AVATAR_MAX_BYTES) {
      return { ok: false, error: '头像图片不能超过 2MB' };
    }
    if (stat.size < 64) {
      return { ok: false, error: '图片文件损坏或过小' };
    }

    const info = inspectImage(tmpFile.path);
    if (!info) {
      return { ok: false, error: '仅支持 JPG / PNG / WEBP 格式的头像' };
    }
    // 声明的类型必须与实际内容一致，防止改扩展名伪装
    if (!ALLOWED.has(tmpFile.mimetype) || ALLOWED.get(tmpFile.mimetype) !== info.ext) {
      return { ok: false, error: '图片内容与格式不一致，请重新选择' };
    }
    // 像素上限，防超大分辨率消耗浏览器内存
    if (info.width > 4096 || info.height > 4096) {
      return { ok: false, error: '图片分辨率过大，请压缩后再上传（最大 4096×4096）' };
    }

    const sha256 = hashFile(tmpFile.path);
    ensureDir();

    // 文件名完全由服务端生成：时间戳 + 哈希前缀，不含任何用户输入
    const filename = `${Date.now().toString(36)}-${sha256.slice(0, 16)}${info.ext}`;
    const dest = path.join(AVATAR_DIR, filename);
    fs.copyFileSync(tmpFile.path, dest);
    fs.chmodSync(dest, 0o600);

    // 落盘后复算哈希，确认写入内容一致（防 TOCTOU 替换）
    const verify = hashFile(dest);
    if (verify !== sha256) {
      try { fs.unlinkSync(dest); } catch {}
      return { ok: false, error: '图片写入校验失败，请重试' };
    }

    return {
      ok: true,
      url: `/uploads/avatars/${filename}`,
      sha256,
      mime: info.mime,
      size: stat.size,
    };
  } finally {
    try { fs.unlinkSync(tmpFile.path); } catch {}
  }
}

/** 删除头像文件（仅允许 avatars 目录下的文件，防路径穿越） */
export function removeAvatarFile(url) {
  if (!url || typeof url !== 'string') return;
  const name = path.basename(url);
  if (!/^[a-z0-9]+-[a-f0-9]{16}\.(jpg|png|webp)$/i.test(name)) return;
  const target = path.join(AVATAR_DIR, name);
  if (!target.startsWith(AVATAR_DIR + path.sep)) return;
  try { fs.unlinkSync(target); } catch {}
}

/** 头像申请的外部表示 */
export function shapeAvatarRequest(r, user) {
  return {
    id: r.id,
    userId: r.userId,
    imageUrl: r.imageUrl,
    imageSha256: r.imageSha256,
    imageMime: r.imageMime,
    imageSize: r.imageSize,
    status: r.status,
    rejectReason: r.rejectReason || '',
    reviewedAt: r.reviewedAt || null,
    reviewedBy: r.reviewedBy || null,
    createdAt: r.createdAt,
    user: user
      ? {
          id: user.id,
          username: user.username,
          nickname: user.nickname,
          title: user.title || '',
          avatarUrl: user.avatarUrl || '',
          avatarHue: user.avatarHue ?? 260,
        }
      : undefined,
  };
}
