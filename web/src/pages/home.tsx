import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowUpRight,
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  Compass,
  Flame,
  ImagePlus,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import { SearchBox } from '@/components/search-box';
import { NameCard } from '@/components/name-card';
import { JoinGroupButton } from '@/components/join-group-button';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { api, type NameItem, type PageResult } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';

type Overview = { names: number; users: number; approved: number; pending: number; appeals: number };

const SORTS = [
  { key: 'latest', label: '最新收录', icon: Sparkles },
  { key: 'hot', label: '最多浏览', icon: Flame },
  { key: 'name', label: '名称排序', icon: Compass },
];

export default function HomePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [committed, setCommitted] = useState('');
  const [sort, setSort] = useState('latest');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PageResult<NameItem> | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [hot, setHot] = useState<{ id: string; name: string; views: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const listRef = useRef<HTMLElement>(null);
  const pendingScroll = useRef(false);

  const fetchNames = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ q: committed, sort, page: String(page), pageSize: '12' });
      const res = await api.get<PageResult<NameItem>>(`/names?${params}`);
      setData(res);
    } catch {
      setData({ items: [], total: 0, page: 1, pageSize: 12, pages: 1 });
    } finally {
      setLoading(false);
    }
  }, [committed, sort, page]);

  useEffect(() => {
    fetchNames();
  }, [fetchNames]);

  useEffect(() => {
    api.get<Overview>('/names/stats/overview').then(setOverview).catch(() => {});
    // 热门圈名来自真实数据，按浏览量排名
    api.get<{ items: { id: string; name: string; views: number }[] }>('/names/hot?limit=6')
      .then((res) => setHot(res.items.filter((i) => i.views > 0)))
      .catch(() => setHot([]));
  }, []);

  const scrollToList = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - 72;
    window.scrollTo({ top, behavior: 'smooth' });
  }, []);

  const onSearch = (q: string) => {
    setCommitted(q);
    setPage(1);
    pendingScroll.current = true;
    if (q) api.post('/names/search-log', { q, hit: true }).catch(() => {});
  };

  // 列表加载完成后自动下滑到列表区
  useEffect(() => {
    if (!pendingScroll.current || loading) return;
    pendingScroll.current = false;
    const timer = window.setTimeout(scrollToList, 120);
    return () => window.clearTimeout(timer);
  }, [loading, data, scrollToList]);

  const stats = [
    { label: '已登记圈名', value: overview?.names ?? '—', icon: BadgeCheck, tone: 'from-violet-500/20 to-indigo-500/5' },
    { label: '注册圈友', value: overview?.users ?? '—', icon: Users, tone: 'from-cyan-500/20 to-sky-500/5' },
    { label: '审核通过', value: overview?.approved ?? '—', icon: ShieldCheck, tone: 'from-emerald-500/20 to-teal-500/5' },
    { label: '等待审核', value: overview?.pending ?? '—', icon: ScanSearch, tone: 'from-amber-500/20 to-orange-500/5' },
  ];

  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-10 sm:px-6 lg:px-8">
      {/* Hero */}
      <section className="relative pt-14 pb-10 sm:pt-20 sm:pb-14">
        <div className="mx-auto max-w-3xl text-center">
          <Badge variant="secondary" className="mx-auto mb-5 gap-1.5 border-white/12 px-3 py-1 text-[11.5px]">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex size-1.5 rounded-full bg-emerald-400" />
            </span>
            圈名归属审核 · 支持归属申诉
          </Badge>

          <h1 className="text-4xl leading-[1.15] font-semibold tracking-tight text-balance sm:text-5xl lg:text-[3.4rem]">
            <span className="text-gradient">给每一个圈名</span>
            <br className="sm:hidden" />
            <span className="text-gradient sm:ml-2">一个清晰的归属</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-[14px] leading-relaxed text-pretty text-slate-400 sm:text-[15px]">
            小天才圈名平台记录你独一无二的圈名，通过材料审核确认归属权，避免撞名与冒用。
            对归属有异议？在圈名详情页提交申诉材料，由人工复核。
          </p>

          <div className="mx-auto mt-8 max-w-2xl">
            <SearchBox
              value={query}
              onChange={setQuery}
              onSubmit={onSearch}
              autoFocus
              placeholder={hot[0] ? `输入圈名，例如「${hot[0].name}」…` : '输入圈名、关键词或作者昵称…'}
            />
            {hot.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-[11.5px] text-slate-500">
                <span>热门：</span>
                {hot.map((item, i) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      setQuery(item.name);
                      onSearch(item.name);
                    }}
                    title={`浏览量 ${item.views}`}
                    className={cn(
                      'group flex items-center gap-1 rounded-full border px-2.5 py-1',
                      'transition-[background-color,border-color,color,transform,box-shadow] duration-200 ease-out',
                      'hover:-translate-y-px active:translate-y-0 active:scale-[0.96]',
                      i === 0
                        ? 'border-amber-300/25 bg-amber-400/10 text-amber-200 hover:border-amber-300/45 hover:shadow-[0_8px_20px_-12px_rgba(251,191,36,.8)]'
                        : 'border-white/8 bg-white/[0.04] hover:border-violet-300/30 hover:bg-violet-400/10 hover:text-violet-200',
                    )}
                  >
                    {i < 3 && <span className={cn('text-[10px] font-semibold', i === 0 ? 'text-amber-300' : 'text-slate-400')}>{i + 1}</span>}
                    {item.name}
                    <span className="text-[10px] text-slate-500 group-hover:text-violet-300/80">{item.views}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg" className="gap-2">
              <Link to={user ? '/me?tab=claim' : '/register'}>
                <ImagePlus className="size-4" />
                {user ? '提交圈名归属审核' : '免费注册并登记圈名'}
              </Link>
            </Button>
            <JoinGroupButton variant="outline" className="h-12 rounded-2xl px-5 text-[14px]" label="加入交流群" />
          </div>
        </div>

        {/* Stats */}
        <div className="mx-auto mt-12 grid max-w-4xl grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map((s, i) => (
            <div key={s.label} className="glass animate-rise relative overflow-hidden rounded-2xl p-4" style={{ animationDelay: `${i * 60}ms` }}>
              <div className={cn('absolute inset-0 bg-gradient-to-br opacity-70', s.tone)} />
              <div className="relative">
                <s.icon className="mb-2.5 size-4 text-slate-300/80" />
                <div className="text-2xl font-semibold tracking-tight text-white">{s.value}</div>
                <div className="mt-0.5 text-[11.5px] text-slate-400">{s.label}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* List */}
      <section ref={listRef} className="mt-2 scroll-mt-24">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-white">
              <span className="grid size-7 place-items-center rounded-lg border border-white/10 bg-white/[0.05]">
                <Sparkles className="size-3.5 text-violet-300" />
              </span>
              圈名广场
              <span className="text-[12px] font-normal text-slate-500">共 {data?.total ?? 0} 个</span>
            </h2>
            <p className="mt-1 text-[12.5px] text-slate-500">以下圈名均已完成归属权审核并绑定到对应圈友，点击卡片查看详情与申诉入口。</p>
          </div>

          <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.04] p-1">
            {SORTS.map((s) => (
              <button
                key={s.key}
                onClick={() => {
                  setSort(s.key);
                  setPage(1);
                }}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px]',
                  'transition-[background-color,color,box-shadow,transform] duration-200 ease-out',
                  'active:scale-[0.96]',
                  sort === s.key
                    ? 'bg-white/[0.13] text-white shadow-[inset_0_1px_0_rgba(255,255,255,.18)]'
                    : 'text-slate-400 hover:bg-white/[0.06] hover:text-slate-200',
                )}
              >
                <s.icon className="size-3" />
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {committed && (
          <div className="mb-4 flex flex-wrap items-center gap-2 text-[12px] text-slate-400">
            <span>搜索「<span className="text-white">{committed}</span>」的结果</span>
            <button
              onClick={() => {
                setQuery('');
                setCommitted('');
                setPage(1);
              }}
              className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-slate-400 transition hover:text-white"
            >
              清除筛选
            </button>
          </div>
        )}

        {loading ? (
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="glass rounded-2xl p-5">
                <Skeleton className="h-5 w-28" />
                <Skeleton className="mt-3 h-3.5 w-full" />
                <Skeleton className="mt-2 h-3.5 w-2/3" />
                <Skeleton className="mt-5 h-3 w-24" />
              </div>
            ))}
          </div>
        ) : data && data.items.length > 0 ? (
          <>
            <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
              {data.items.map((item, i) => (
                <NameCard key={item.id} item={item} index={i} onOpen={() => navigate(`/names/${item.id}`)} />
              ))}
            </div>

            {data.pages > 1 && (
              <div className="mt-7 flex items-center justify-center gap-2">
                <Button variant="secondary" size="icon" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  <ChevronLeft className="size-4" />
                </Button>
                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.min(data.pages, 7) }).map((_, i) => {
                    const p = i + 1;
                    return (
                      <button
                        key={p}
                        onClick={() => setPage(p)}
                        className={cn(
                          'size-9 rounded-xl text-[13px]',
                          'transition-[background,color,transform,box-shadow] duration-200 ease-out',
                          'hover:-translate-y-px active:translate-y-0 active:scale-95',
                          page === p
                            ? 'bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-[0_8px_20px_-10px_rgba(139,92,246,.9),inset_0_1px_0_rgba(255,255,255,.2)]'
                            : 'border border-white/10 bg-white/[0.04] text-slate-400 hover:border-white/20 hover:text-white',
                        )}
                      >
                        {p}
                      </button>
                    );
                  })}
                </div>
                <Button variant="secondary" size="icon" disabled={page >= data.pages} onClick={() => setPage((p) => Math.min(data.pages, p + 1))}>
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="glass flex flex-col items-center gap-4 rounded-3xl px-6 py-16 text-center">
            <div className="grid size-14 place-items-center rounded-2xl border border-white/10 bg-white/[0.04]">
              <ScanSearch className="size-6 text-slate-400" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-base font-medium text-white">{committed ? `没有找到「${committed}」` : '暂时还没有圈名'}</h3>
              <p className="mx-auto max-w-sm text-[13px] leading-relaxed text-slate-500">
                {committed
                  ? '这个圈名还没有被登记，或者关键词不匹配。你可以清空搜索条件重新浏览，也可以直接申请登记它。'
                  : '成为第一个登记圈名的人吧，上传材料即可完成归属审核。'}
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {committed && (
                <Button variant="secondary" onClick={() => { setQuery(''); setCommitted(''); setPage(1); }}>
                  清空搜索
                </Button>
              )}
              <Button asChild>
                <Link to={user ? '/me?tab=claim' : '/register'}>
                  登记这个圈名 <ArrowUpRight className="size-3.5" />
                </Link>
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* CTA */}
      <section className="liquid liquid-sheen relative mt-14 overflow-hidden rounded-3xl px-6 py-10 sm:px-10">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(30rem_22rem_at_85%_-10%,rgba(139,92,246,.22),transparent_70%)]" />
        <div className="relative flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
          <div className="max-w-xl">
            <h3 className="text-xl font-semibold tracking-tight text-white">担心喜欢的圈名被别人抢先？</h3>
            <p className="mt-2 text-[13.5px] leading-relaxed text-slate-400">
              注册后即可提交归属权审核：上传能证明你使用该圈名的截图（主页、作品、发布记录等），
              管理员或审核员会在后台人工复核。审核不通过时会附上具体理由，方便你补充材料后重新提交。
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
            <Button asChild size="lg">
              <Link to={user ? '/me?tab=claim' : '/register'}>
                <Sparkles className="size-4" /> 立即登记圈名
              </Link>
            </Button>
            <JoinGroupButton variant="outline" className="h-12 rounded-2xl px-5 text-[14px]" />
          </div>
        </div>
      </section>
    </div>
  );
}
