import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function Pager({
  page,
  pages,
  total,
  onChange,
}: {
  page: number;
  pages: number;
  total?: number;
  onChange: (p: number) => void;
}) {
  if (pages <= 1) {
    return total !== undefined ? (
      <div className="pt-1 text-center text-[11.5px] text-slate-500">共 {total} 条</div>
    ) : null;
  }
  const nums: number[] = [];
  const start = Math.max(1, Math.min(page - 2, pages - 4));
  for (let i = start; i <= Math.min(pages, start + 4); i += 1) nums.push(i);

  return (
    <div className="flex items-center justify-center gap-2 pt-2">
      <Button variant="secondary" size="icon-sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        <ChevronLeft className="size-3.5" />
      </Button>
      {nums.map((n) => (
        <button
          key={n}
          onClick={() => onChange(n)}
          className={
            n === page
              ? 'size-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 text-[12px] text-white'
              : 'size-8 rounded-lg border border-white/10 bg-white/[0.04] text-[12px] text-slate-400 transition hover:text-white'
          }
        >
          {n}
        </button>
      ))}
      <Button variant="secondary" size="icon-sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>
        <ChevronRight className="size-3.5" />
      </Button>
      {total !== undefined && <span className="ml-1 text-[11.5px] text-slate-500">共 {total} 条</span>}
    </div>
  );
}
