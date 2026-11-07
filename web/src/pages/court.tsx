import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowLeft, ArrowLeftRight, Check, Clock3, Gavel, Loader2, MessageSquare,
  Scale, Send, ShieldAlert, ThumbsUp, Users, X, ImagePlus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { UserAvatar } from '@/components/user-avatar';
import { Pager } from '@/components/admin/pager';
import { useAuth } from '@/lib/auth';
import { api, ApiError, type Court, type PageResult } from '@/lib/api';
import { cn, formatDate, initials, relativeTime } from '@/lib/utils';

const STATUS_META: Record<string, { label: string; tone: string; desc: string }> = {
  pending: { label: '待启动', tone: 'border-white/15 bg-white/5 text-slate-300', desc: '等待争议双方准备材料' },
  running: { label: '提交材料中', tone: 'border-sky-300/30 bg-sky-400/10 text-sky-200', desc: '双方轮番提交材料与理由' },
  voting: { label: '投票中', tone: 'border-violet-300/30 bg-violet-400/12 text-violet-200', desc: '全体注册用户可投票' },
  closed: { label: '已判决', tone: 'border-emerald-300/30 bg-emerald-400/10 text-emerald-200', desc: '投票结束，已产生结果' },
};

/* ================= 列表页 ================= */
export function CourtListPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<(PageResult<Court> & { counts: any; canVote: boolean }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<any>(`/court?status=${status}&page=${page}&pageSize=10`);
      setData(res);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [status, page]);

  useEffect(() => { load(); }, [load]);

  if (!user) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
        <div className="glass grid size-14 place-items-center rounded-2xl">
          <Scale className="size-6 text-violet-300" />
        </div>
        <h2 className="text-lg font-semibold text-white">小法庭</h2>
        <p className="text-[13px] leading-relaxed text-slate-400">
          归属争议由社区共同裁决。登录后即可查看进行中的案件并参与投票。
        </p>
        <Button asChild><Link to="/login?redirect=/court">登录后参与</Link></Button>
      </div>
    );
  }

  const tabs = [
    { key: 'all', label: '全部', n: data?.counts?.all ?? 0 },
    { key: 'voting', label: '投票中', n: data?.counts?.voting ?? 0 },
    { key: 'running', label: '提交材料', n: data?.counts?.running ?? 0 },
    { key: 'closed', label: '已判决', n: data?.counts?.closed ?? 0 },
  ];

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-white">
          <Scale className="size-5 text-violet-300" /> 小法庭
        </h1>
        <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-slate-400">
          当圈名归属存在争议时，争议双方可申请小法庭介入。双方轮番提交材料，全体注册用户投票裁决，
          票数最高的一方自动获得归属。管理员可在必要时改判。
        </p>
        {!data?.canVote && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-300/25 bg-amber-400/[0.08] p-3 text-[11.5px] text-amber-200">
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
            你的小法庭投票权限已被管理员收回，仍可浏览案件但无法投票。
          </div>
        )}
      </div>

      <div className="mb-4 flex flex-wrap gap-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => { setStatus(t.key); setPage(1); }}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] transition',
              status === t.key ? 'bg-white/12 text-white' : 'text-slate-400 hover:bg-white/6',
            )}
          >
            {t.label}
            {t.n > 0 && <span className="rounded bg-white/10 px-1 text-[10px] text-slate-300">{t.n}</span>}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="glass flex items-center justify-center gap-2 rounded-2xl py-16 text-[13px] text-slate-400">
          <Loader2 className="size-4 animate-spin" /> 加载中…
        </div>
      ) : !data?.items.length ? (
        <div className="glass flex flex-col items-center gap-3 rounded-2xl py-16 text-center">
          <Gavel className="size-7 text-slate-600" />
          <p className="text-[13px] text-slate-400">暂无相关案件</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {data.items.map((c) => {
            const meta = STATUS_META[c.status];
            return (
              <button
                key={c.id}
                onClick={() => navigate(`/court/${c.id}`)}
                className="glass w-full rounded-2xl p-4 text-left transition hover:border-white/20"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14.5px] font-medium text-white">圈名「{c.nameText}」</span>
                  <span className={cn('rounded-full border px-1.5 py-0 text-[10px]', meta.tone)}>{meta.label}</span>
                  {c.viewer?.isClaimant && <Badge variant="cyan" className="text-[9.5px]">我是主张方</Badge>}
                  {c.viewer?.isRespondent && <Badge variant="warning" className="text-[9.5px]">我是应诉方</Badge>}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-slate-400">
                  <span className="flex items-center gap-1">
                    <span className="text-violet-300">主张</span> {c.claimant?.nickname || '—'}
                  </span>
                  <ArrowLeftRight className="size-3 text-slate-600" />
                  <span className="flex items-center gap-1">
                    <span className="text-sky-300">应诉</span> {c.respondent?.nickname || '—'}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                  <span className="flex items-center gap-1"><ThumbsUp className="size-3" /> 共 {c.votes.total} 票</span>
                  <span>主张 {c.votes.claimant}</span>
                  <span>应诉 {c.votes.respondent}</span>
                  {c.status === 'voting' && c.votingEndsAt && (
                    <span className="flex items-center gap-1 text-violet-300">
                      <Clock3 className="size-3" /> 截止 {formatDate(c.votingEndsAt, true)}
                    </span>
                  )}
                  {c.status === 'closed' && c.verdictReason && (
                    <span className="text-emerald-300/80">{c.verdictReason}</span>
                  )}
                  <span className="ml-auto">{relativeTime(c.createdAt)}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {data && data.pages > 1 && (
        <Pager page={data.page} pages={data.pages} total={data.total} onChange={setPage} />
      )}
    </div>
  );
}

/* ================= 详情页 ================= */
export function CourtDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [court, setCourt] = useState<Court | null>(null);
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [voteSide, setVoteSide] = useState<'claimant' | 'respondent' | null>(null);
  const [voteReason, setVoteReason] = useState('');
  const [voting, setVoting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ court: Court }>(`/court/${id}`);
      setCourt(res.court);
      setVoteSide(res.court.viewer?.votedSide || null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="mx-auto flex min-h-[50vh] max-w-3xl items-center justify-center px-4">
        <Loader2 className="size-5 animate-spin text-slate-500" />
      </div>
    );
  }
  if (!court) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <X className="mx-auto size-8 text-slate-600" />
        <p className="mt-3 text-[13px] text-slate-400">案件不存在或无权访问</p>
        <Button asChild variant="secondary" className="mt-4"><Link to="/court">返回小法庭</Link></Button>
      </div>
    );
  }

  const meta = STATUS_META[court.status];
  const isParty = court.viewer?.isClaimant || court.viewer?.isRespondent;
  const mySide: 'claimant' | 'respondent' | null = court.viewer?.isClaimant
    ? 'claimant'
    : court.viewer?.isRespondent
      ? 'respondent'
      : null;

  const submitStatement = async () => {
    if (content.trim().length < 5 && files.length === 0) {
      return toast.error('请填写理由或上传材料');
    }
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append('content', content.trim());
      files.forEach((f) => form.append('images', f));
      const res = await api.post<{ court: Court }>(`/court/${id}/statements`, form);
      setCourt(res.court);
      setContent('');
      setFiles([]);
      toast.success('材料已提交');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  const startVoting = async () => {
    setSubmitting(true);
    try {
      const res = await api.post<{ court: Court }>(`/court/${id}/start`);
      setCourt(res.court);
      toast.success('投票已开启');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  const doVote = async () => {
    if (!voteSide) return toast.error('请选择支持的一方');
    if (voteReason.trim().length < 2) return toast.error('请填写支持理由');
    setVoting(true);
    try {
      const res = await api.post<{ court: Court }>(`/court/${id}/vote`, {
        side: voteSide,
        reason: voteReason.trim(),
      });
      setCourt(res.court);
      toast.success('投票成功');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '投票失败');
    } finally {
      setVoting(false);
    }
  };

  const total = Math.max(1, court.votes.total);
  const claimPct = Math.round((court.votes.claimant / total) * 100);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <Link to="/court" className="mb-5 inline-flex items-center gap-1.5 text-[12.5px] text-slate-400 hover:text-white">
        <ArrowLeft className="size-3.5" /> 返回小法庭
      </Link>

      {/* 案件头部 */}
      <Card className="gap-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-white">圈名「{court.nameText}」</h1>
          <span className={cn('rounded-full border px-2 py-0.5 text-[10.5px]', meta.tone)}>{meta.label}</span>
        </div>
        <p className="text-[12px] text-slate-500">{meta.desc}</p>

        {/* 双方 */}
        <div className="grid gap-2.5 sm:grid-cols-2">
          {[
            { side: 'claimant' as const, label: '主张方', person: court.claimant, count: court.votes.claimant, tone: 'violet' },
            { side: 'respondent' as const, label: '应诉方', person: court.respondent, count: court.votes.respondent, tone: 'sky' },
          ].map((p) => (
            <div
              key={p.side}
              className={cn(
                'rounded-xl border p-3',
                court.winnerId === p.person?.id && court.status === 'closed'
                  ? 'border-emerald-300/40 bg-emerald-400/[0.08]'
                  : 'border-white/8 bg-white/[0.03]',
              )}
            >
              <div className="flex items-center gap-2">
                <UserAvatar className="size-8" name={p.person?.nickname || '?'} url={p.person?.avatarUrl} hue={p.person?.avatarHue} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className={cn('text-[10.5px]', p.side === 'claimant' ? 'text-violet-300' : 'text-sky-300')}>{p.label}</span>
                    {court.winnerId === p.person?.id && court.status === 'closed' && (
                      <Badge variant="success" className="text-[9px]">胜出</Badge>
                    )}
                    {mySide === p.side && <Badge variant="secondary" className="text-[9px]">我</Badge>}
                  </div>
                  <div className="truncate text-[13px] font-medium text-white">{p.person?.nickname || '未指定'}</div>
                </div>
                <div className="text-right">
                  <div className="text-[15px] font-semibold text-white">{p.count}</div>
                  <div className="text-[9.5px] text-slate-500">票</div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* 票数进度 */}
        {court.votes.total > 0 && (
          <div>
            <div className="mb-1 flex justify-between text-[10.5px] text-slate-500">
              <span>主张方 {claimPct}%</span>
              <span>应诉方 {100 - claimPct}%</span>
            </div>
            <div className="flex h-2 overflow-hidden rounded-full bg-white/8">
              <div className="bg-gradient-to-r from-violet-500 to-violet-400" style={{ width: `${claimPct}%` }} />
              <div className="flex-1 bg-gradient-to-r from-sky-400 to-sky-500" />
            </div>
          </div>
        )}

        {/* 判决结果 */}
        {court.status === 'closed' && (
          <div className="rounded-xl border border-emerald-300/25 bg-emerald-400/[0.08] p-3">
            <div className="flex items-center gap-1.5 text-[12px] font-medium text-emerald-200">
              <Check className="size-3.5" /> 判决结果
            </div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-emerald-100/90">{court.verdictReason}</p>
            <div className="mt-1 text-[10.5px] text-emerald-300/60">
              {court.verdict === 'admin' ? `管理员 ${court.judgedBy} 改判` : '系统按票数自动判决'} · {formatDate(court.closedAt, true)}
            </div>
          </div>
        )}

        {court.status === 'voting' && court.votingEndsAt && (
          <div className="flex items-center gap-1.5 rounded-xl border border-violet-300/20 bg-violet-400/[0.08] p-2.5 text-[11.5px] text-violet-200">
            <Clock3 className="size-3.5" /> 投票截止：{formatDate(court.votingEndsAt, true)}
          </div>
        )}

        {/* 投票开启提示：仅管理员可设置截止时间 */}
        {court.status === 'running' && (
          <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3 text-[11.5px] leading-relaxed text-slate-400">
            <div className="flex items-center gap-1.5 text-slate-300">
              <Clock3 className="size-3.5" /> 等待管理员开启投票
            </div>
            <p className="mt-1 text-slate-500">
              双方各提交至少一次材料后，由管理员设置投票截止时间并开启投票。
            </p>
          </div>
        )}
      </Card>

      {/* 双方材料 */}
      <div className="mt-4 space-y-2.5">
        <h2 className="flex items-center gap-2 px-1 text-[13.5px] font-medium text-white">
          <MessageSquare className="size-4 text-slate-400" /> 材料与理由
        </h2>
        {(court.statements || []).length === 0 ? (
          <div className="glass-soft rounded-2xl p-6 text-center text-[12px] text-slate-500">
            还没有提交材料
          </div>
        ) : (
          /* 按轮次分组：每一轮展示主张方与应诉方各自的提交 */
          [...new Set((court.statements || []).map((s) => s.round))]
            .sort((a, b) => a - b)
            .map((round) => {
              const roundItems = (court.statements || []).filter((s) => s.round === round);
              return (
                <div key={round} className="space-y-2">
                  <div className="flex items-center gap-2 px-1">
                    <span className="rounded-md bg-white/8 px-2 py-0.5 text-[10.5px] font-medium text-slate-300">
                      第 {round} 轮
                    </span>
                    <span className="h-px flex-1 bg-white/8" />
                    <span className="text-[10px] text-slate-600">{roundItems.length} 条提交</span>
                  </div>
                  {roundItems.map((s) => (
            <div
              key={s.id}
              className={cn(
                'glass-soft rounded-2xl p-4',
                s.side === 'claimant' ? 'border-l-2 border-l-violet-400/60' : 'border-l-2 border-l-sky-400/60',
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn('text-[11px] font-medium', s.side === 'claimant' ? 'text-violet-300' : 'text-sky-300')}>
                  {s.side === 'claimant' ? '主张方' : '应诉方'}
                </span>
                <span className="text-[12px] text-white">{s.user?.nickname}</span>
                <Badge variant="secondary" className="text-[9px]">第 {s.round} 轮</Badge>
                <span className="ml-auto text-[10.5px] text-slate-600">{relativeTime(s.createdAt)}</span>
              </div>
              {s.content && (
                <p className="mt-2 text-[12.5px] leading-relaxed whitespace-pre-wrap text-slate-300">{s.content}</p>
              )}
              {s.images?.length > 0 && (
                <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {s.images.map((img, i) => (
                    <a key={img.url + i} href={img.url} target="_blank" rel="noreferrer" className="aspect-square overflow-hidden rounded-lg border border-white/10">
                      <img src={img.url} alt={img.name} loading="lazy" className="size-full object-cover" />
                    </a>
                  ))}
                </div>
              )}
            </div>
                  ))}
                </div>
              );
            })
        )}
      </div>

      {/* 提交材料（当事人） */}
      {isParty && ['running', 'voting'].includes(court.status) && (
        <Card className="mt-4 gap-3 p-5">
          <h3 className="text-[13px] font-medium text-white">提交我的材料（{mySide === 'claimant' ? '主张方' : '应诉方'}）</h3>
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value.slice(0, 3000))}
            placeholder="说明你的主张、事实依据与理由…"
            className="min-h-24"
          />
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-white/15 px-2.5 py-1.5 text-[11.5px] text-slate-400 hover:border-violet-300/40">
              <ImagePlus className="size-3.5" /> 添加图片（最多4张）
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  const list = Array.from(e.target.files || []).slice(0, 4);
                  setFiles(list);
                }}
              />
            </label>
            {files.length > 0 && <span className="text-[11px] text-slate-400">已选 {files.length} 张</span>}
            <span className="ml-auto text-[10.5px] text-slate-600">{content.length}/3000</span>
          </div>
          <Button onClick={submitStatement} disabled={submitting} className="w-full">
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} 提交材料
          </Button>
        </Card>
      )}

      {/* 投票 */}
      {court.status === 'voting' && !isParty && (
        <Card className="mt-4 gap-3 p-5">
          <h3 className="flex items-center gap-2 text-[13px] font-medium text-white">
            <ThumbsUp className="size-4 text-violet-200" /> 参与投票
          </h3>
          {court.viewer?.votedSide ? (
            <div className="rounded-xl border border-emerald-300/25 bg-emerald-400/[0.08] p-3 text-[12px] text-emerald-200">
              你已投票支持「{court.viewer.votedSide === 'claimant' ? '主张方' : '应诉方'}」，可在截止前修改。
            </div>
          ) : (
            <p className="text-[11.5px] text-slate-500">请阅读上方材料后，选择你认为应当获得该圈名的一方，并填写理由。</p>
          )}
          <div className="grid grid-cols-2 gap-2">
            {[
              { side: 'claimant' as const, label: '支持主张方', name: court.claimant?.nickname, tone: 'violet' },
              { side: 'respondent' as const, label: '支持应诉方', name: court.respondent?.nickname, tone: 'sky' },
            ].map((o) => (
              <button
                key={o.side}
                onClick={() => setVoteSide(o.side)}
                className={cn(
                  'rounded-xl border px-3 py-2.5 text-left transition',
                  voteSide === o.side
                    ? o.side === 'claimant'
                      ? 'border-violet-300/50 bg-violet-400/12'
                      : 'border-sky-300/50 bg-sky-400/12'
                    : 'border-white/10 bg-white/[0.03] hover:border-white/20',
                )}
              >
                <div className="text-[12px] font-medium text-white">{o.label}</div>
                <div className="mt-0.5 truncate text-[11px] text-slate-500">{o.name || '—'}</div>
              </button>
            ))}
          </div>
          <Input
            value={voteReason}
            onChange={(e) => setVoteReason(e.target.value.slice(0, 300))}
            placeholder="填写你支持该方的理由（必填，会公开展示）"
          />
          <Button onClick={doVote} disabled={voting} className="w-full">
            {voting ? <Loader2 className="size-4 animate-spin" /> : <ThumbsUp className="size-4" />}
            {court.viewer?.votedSide ? '修改投票' : '提交投票'}
          </Button>
        </Card>
      )}

      {/* 投票理由列表 */}
      {(court.voteDetails || []).length > 0 && (
        <div className="mt-4 space-y-2">
          <h2 className="flex items-center gap-2 px-1 text-[13.5px] font-medium text-white">
            <Users className="size-4 text-slate-400" /> 投票理由（{court.voteDetails?.length}）
          </h2>
          {(court.voteDetails || []).map((v) => (
            <div key={v.id} className="glass-soft rounded-xl p-3">
              <div className="flex items-center gap-2">
                <span className={cn('text-[11px] font-medium', v.side === 'claimant' ? 'text-violet-300' : 'text-sky-300')}>
                  支持{v.side === 'claimant' ? '主张方' : '应诉方'}
                </span>
                <span className="text-[11.5px] text-slate-400">{v.user?.nickname}</span>
                <span className="ml-auto text-[10px] text-slate-600">{relativeTime(v.createdAt)}</span>
              </div>
              {v.reason && <p className="mt-1 text-[12px] leading-relaxed text-slate-300">{v.reason}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
