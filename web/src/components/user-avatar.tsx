import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn, initials } from '@/lib/utils';

/**
 * 统一用户头像
 *
 * 此前全站几乎只用 AvatarFallback（首字母色块），
 * 即使后端 avatarUrl 已更新，前端也不会显示真实头像，
 * 导致「管理员改完头像仍显示默认头像」。
 *
 * 这里统一处理：有 avatarUrl 就显示图片，加载失败或为空时回退首字母。
 */
export function UserAvatar({
  url,
  name,
  hue = 260,
  className,
  fallbackClassName,
}: {
  /** 头像地址（/uploads/avatars/xxx.png） */
  url?: string | null;
  /** 昵称或用户名，用于生成首字母与 alt */
  name?: string | null;
  /** 无头像时的背景色相 */
  hue?: number;
  className?: string;
  fallbackClassName?: string;
}) {
  const safeUrl = typeof url === 'string' && url.startsWith('/uploads/') ? url : '';

  return (
    <Avatar className={cn('shrink-0', className)}>
      {safeUrl ? (
        <AvatarImage
          src={safeUrl}
          alt={name || '用户头像'}
          // 加载失败时自动回退到首字母（Radix 会移除 img 保留 fallback）
          className="object-cover"
        />
      ) : null}
      <AvatarFallback
        className={cn(fallbackClassName)}
        style={{
          background: `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${(hue + 50) % 360} 75% 45%))`,
        }}
      >
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
