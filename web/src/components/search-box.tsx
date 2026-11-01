import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Loader2, Search, Sparkles, X } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

type Suggestion = { id: string; name: string; category: string; owner: string };

export function SearchBox({
  value,
  onChange,
  onSubmit,
  placeholder = '搜索圈名、关键词或分类…',
  autoFocus = false,
  size = 'lg',
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  size?: 'lg' | 'md';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const q = value.trim();
    if (!q) {
      setItems([]);
      setOpen(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const data = await api.get<{ items: Suggestion[] }>(`/names/suggest?q=${encodeURIComponent(q)}`);
        if (!cancelled) {
          setItems(data.items);
          setOpen(true);
          setActive(-1);
        }
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const submit = (q: string) => {
    setOpen(false);
    onSubmit(q);
  };

  return (
    <div ref={wrapRef} className={cn('relative w-full', className)}>
      <div
        className={cn(
          'group relative flex items-center gap-2 overflow-hidden rounded-2xl border border-white/12 bg-white/[0.055] backdrop-blur-2xl transition-all',
          'focus-within:border-violet-400/45 focus-within:bg-white/[0.08] focus-within:shadow-[0_0_0_4px_rgba(139,92,246,.12),0_24px_60px_-30px_rgba(139,92,246,.8)]',
          size === 'lg' ? 'h-14 pl-4 pr-2' : 'h-11 pl-3 pr-1.5',
        )}
      >
        <Search className={cn('shrink-0 text-slate-500 transition-colors group-focus-within:text-violet-300', size === 'lg' ? 'size-5' : 'size-4')} />
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => items.length && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (active >= 0 && items[active]) submit(items[active].name);
              else submit(value.trim());
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, items.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, -1));
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
          placeholder={placeholder}
          className={cn(
            'min-w-0 flex-1 bg-transparent text-slate-100 placeholder:text-slate-500 outline-none',
            size === 'lg' ? 'text-[15px]' : 'text-[13.5px]',
          )}
        />
        {value && (
          <button
            onClick={() => {
              onChange('');
              inputRef.current?.focus();
            }}
            className="rounded-lg p-1 text-slate-500 transition hover:bg-white/10 hover:text-slate-200"
            aria-label="清空"
          >
            <X className="size-3.5" />
          </button>
        )}
        {loading && <Loader2 className="size-4 animate-spin text-violet-300/70" />}
        <button
          onClick={() => submit(value.trim())}
          className={cn(
            'ml-1 flex shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 font-medium text-white shadow-[0_10px_28px_-14px_rgba(139,92,246,1)] transition hover:from-violet-400 hover:to-indigo-500 active:scale-95',
            size === 'lg' ? 'h-10 px-4 text-[13.5px]' : 'h-8 px-3 text-xs',
          )}
        >
          搜索
          <ArrowRight className="size-3.5" />
        </button>
      </div>

      {open && items.length > 0 && (
        <div className="absolute top-[calc(100%+8px)] right-0 left-0 z-30 overflow-hidden rounded-2xl border border-white/12 bg-[#0b0b14] p-1.5 text-left shadow-[0_30px_70px_-30px_rgba(0,0,0,1)] animate-rise">
          <div className="px-2.5 py-1.5 text-[10.5px] tracking-[0.16em] text-slate-500 uppercase">匹配的圈名</div>
          {items.map((item, i) => (
            <button
              key={item.id}
              onMouseEnter={() => setActive(i)}
              onClick={() => submit(item.name)}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition',
                active === i ? 'bg-white/10' : 'hover:bg-white/[0.06]',
              )}
            >
              <Sparkles className="size-3.5 shrink-0 text-violet-300/80" />
              <span className="truncate text-[13.5px] text-slate-100">{item.name}</span>
              <span className="ml-auto shrink-0 rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">
                {item.category}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
