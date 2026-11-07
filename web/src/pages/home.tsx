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
import { Reveal } from '@/components/reveal';
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

const STAT_CONFIG = [
  { label: '已登记圈名', icon: BadgeCheck, tone: 'text-violet-300', bg: 'bg-violet-400/10' },
  { label: '注册圈友', icon: Users, tone: 'text-cyan-300', bg: 'bg-cyan-400/10' },
  { label: '审核通过', icon: ShieldCheck, tone: 'text-emerald-300', bg: 'bg-emerald-400/10' },
  { label: '等待审核', icon: ScanSearch, tone: 'text-amber-300', bg: 'bg-amber-400/10' },
] as const;

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
  // 待上报的搜索词：等列表结果返回后再发送，携带真实 hit
  const pendingLog = useRef<string>('');

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
    // 搜索日志改为「拿到结果后」再上报，携带真实命中情况，
    // 避免无结果的关键词也被计入热词（此前 hit 被硬编码为 true）
    pendingLog.current = q.trim();
  };

  // 列表结果回来后上报搜索行为（含真实命中）
  useEffect(() => {
    if (loading || !data) return;
    const q = pendingLog.current;
    if (!q) return;
    pendingLog.current = '';
    api
      .post('/names/search-log', { q, hit: (data.items?.length ?? 0) > 0 })
      .catch(() => {});
  }, [loading, data]);

  useEffect(() => {
    if (!pendingScroll.current || loading) return;
    pendingScroll.current = false;
    const timer = window.setTimeout(scrollToList, 120);
    return () => window.clearTimeout(timer);
  }, [loading, data, scrollToList]);

  const statValues = [overview?.names, overview?.users, overview?.approved, overview?.pending];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-12 sm:px-6 lg:px-8">
      {/* ── Hero：克制的居中排版，无堆砌 ── */}
      <section className="relative pt-12 pb-8 text-center sm:pt-16 sm:pb-10">
        <Reveal>
          <Badge variant="secondary" className="mx-auto mb-5 gap-1.5 border-white/10 px-3 py-1 text-[11px]">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex size-1.5 rounded-full bg-emerald-400" />
            </span>
            圈名归属审核 · 支持归属申诉
          </Badge>
        </Reveal>

        <Reveal delay={60}>
          <h1 className="text-[2rem] leading-[1.2] font-semibold tracking-tight text-balance sm:text-[2.6rem]">
            <span className="text-gradient">给每一个圈名</span>
            <span className="text-gradient"> 一个清晰的归属</span>
          </h1>
        </Reveal>

        <Reveal delay={120}>
          <p className="mx-auto mt-4 max-w-lg text-[13px] leading-relaxed text-slate-400 sm:text-[14px]">
            记录你独一无二的圈名，通过材料审核确认归属，避免撞名与冒用。
            对归属有异议？在详情页提交申诉，由人工复核。
          </p>
        </Reveal>

        <Reveal delay={180}>
          <div className="mx-auto mt-7 max-w-2xl">
            <SearchBox
              value={query}
              onChange={setQuery}
              onSubmit={onSearch}
              autoFocus
              placeholder={hot[0] ? `输入圈名，例如「${hot[0].name}」…` : '输入圈名、关键词或作者昵称…'}
            />
            {hot.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-[11px] text-slate-500">
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
                      'transition-[background-color,border-color,color] duration-200',
                      i === 0
                        ? 'border-amber-300/25 bg-amber-400/10 text-amber-200 hover:border-amber-300/45'
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
        </Reveal>

        <Reveal delay={240}>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg" className="gap-2">
              <Link to={user ? '/me?tab=claim' : '/register'}>
                <ImagePlus className="size-4" />
                {user ? '提交圈名归属审核' : '免费注册并登记圈名'}
              </Link>
            </Button>
            <JoinGroupButton variant="outline" className="h-12 rounded-2xl px-5 text-[14px]" label="加入交流群" />
          </div>
        </Reveal>

        {/* 统计卡：图标 + 数字 + 标签，清爽三行 */}
        <Reveal delay={320}>
          <div className="mx-auto mt-10 grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-4">
            {STAT_CONFIG.map((s, i) => (
              <div key={s.label} className="glass-soft rounded-2xl p-4">
                <div className={cn('mb-2 inline-grid size-7 place-items-center rounded-lg', s.bg)}>
                  <s.icon className={cn('size-3.5', s.tone)} />
                </div>
                <div className="text-xl font-semibold tracking-tight text-white">{statValues[i] ?? '—'}</div>
                <div className="mt-0.5 text-[11px] text-slate-500">{s.label}</div>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      {/* ── 圈名列表 ── */}
      <section ref={listRef} className="mt-6 scroll-mt-24">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-[17px] font-semibold tracking-tight text-white">
              圈名广场
              <span className="text-[12px] font-normal text-slate-500">{data?.total ?? 0} 个</span>
            </h2>
            <p className="mt-1 text-[12px] text-slate-500">均已完成归属审核，点击查看详情与申诉入口。</p>
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
                  'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] transition-[background-color,color] duration-200',
                  sort === s.key ? 'bg-white/[0.13] text-white' : 'text-slate-400 hover:bg-white/[0.06] hover:text-slate-200',
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
            <span>
              搜索「<span className="text-white">{committed}</span>」的结果
            </span>
            <button
              onClick={() => {
                setQuery('');
                setCommitted('');
              }}
              className="text-violet-300 transition hover:text-violet-200"
            >
              清除
            </button>
          </div>
        )}

        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="glass-soft rounded-2xl p-5">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="mt-3 h-3.5 w-full" />
                <Skeleton className="mt-2 h-3.5 w-2/3" />
                <Skeleton className="mt-4 h-3 w-20" />
              </div>
            ))}
          </div>
        ) : data && data.items.length > 0 ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
                  {Array.from({ length: data.pages }).slice(0, 7).map((_, i) => {
                    const p = i + 1;
                    return (
                      <button
                        key={p}
                        onClick={() => setPage(p)}
                        className={cn(
                          'size-9 rounded-xl text-[13px] transition-colors duration-200',
                          page === p
                            ? 'bg-gradient-to-br from-violet-500 to-indigo-600 text-white'
                            : 'border border-white/10 bg-white/[0.04] text-slate-400 hover:text-white',
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
          <div className="glass-soft flex flex-col items-center gap-4 rounded-3xl px-6 py-14 text-center">
            <div className="grid size-14 place-items-center rounded-2xl border border-white/10 bg-white/[0.04]">
              <ScanSearch className="size-6 text-slate-400" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-base font-medium text-white">{committed ? `没有找到「${committed}」` : '暂时还没有圈名'}</h3>
              <p className="mx-auto max-w-sm text-[13px] leading-relaxed text-slate-500">
                {committed ? '换个关键词试试，或直接登记这个圈名。' : '成为第一个登记圈名的人吧，上传材料即可完成归属审核。'}
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {committed && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setQuery('');
                    setCommitted('');
                    setPage(1);
                  }}
                >
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

      {/* ── 底部行动卡 ── */}
      <Reveal className="mt-12">
        <div className="glass relative overflow-hidden rounded-3xl px-6 py-9 sm:px-10">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(26rem_16rem_at_100%_0%,rgba(139,92,246,.16),transparent_70%)]" />
          <div className="relative flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
            <div className="max-w-xl">
              <h3 className="text-[19px] font-semibold tracking-tight text-white">担心喜欢的圈名被别人抢先？</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-slate-400">
                注册后即可提交归属权审核：上传能证明你使用该圈名的截图，管理员会人工复核。
                审核不通过时会附上具体理由，方便补充材料后重新提交。
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
        </div>
      </Reveal>
    </div>
  );
}
