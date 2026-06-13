'use client'
import * as React from 'react'
import clsx from 'clsx'
import {
  Pencil,
  Check,
  Search as SearchIcon,
  Languages,
  MoreHorizontal,
  RefreshCw,
  AlertCircle,
  ChevronLeft
} from 'lucide-react'
import { toast } from 'sonner'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@wuji/miaoji-api/router'
import type { Lang } from '@wuji/miaoji-contracts'
import { trpc } from '../lib/trpc'
import { fmtDate, fmtDuration, STATUS_LABEL } from '../lib/format'
import { miaojiConfig } from '../lib/config'
import { setRate as storeSetRate, usePlayer } from '../lib/player-store'
import { Btn, IconBtn, TextInput, Popover, MenuItem, Spinner } from '../components/detail/ui'
import { MediaPlayer, RATES, type PlayerSegment } from '../components/player/media-player'
import { SpeakerStrip } from '../components/detail/speaker-strip'
import {
  TranscriptView,
  type TSegment,
  type TSpeaker,
  type THighlight,
  type TranslationMap
} from '../components/transcript/transcript-view'
import { SearchBar } from '../components/transcript/search-bar'
import { RightRail } from '../components/detail/right-rail'
import { ShareMenu, type LinkScope } from '../components/detail/share-menu'
import { ExportMenu } from '../components/detail/export-menu'

type Detail = inferRouterOutputs<AppRouter>['minute']['getByToken']

const LANG_LABEL: Record<Lang, string> = { zh: '中文', en: '英文', ja: '日文' }

/** 流水线阶段中文名(JobStage 枚举) */
const STAGE_LABEL: Record<string, string> = {
  TRANSCODE: '转码',
  ASR: '语音转写',
  DIARIZE: '分离说话人',
  SEGMENT: '整理段落',
  SUMMARIZE: '生成纪要',
  INDEX: '建立索引'
}
const STAGE_ORDER = ['TRANSCODE', 'ASR', 'DIARIZE', 'SEGMENT', 'SUMMARIZE', 'INDEX'] as const

/** 返回主页(列表)· 固定左上 · 处理中/失败时也能随时回去(转写在后台继续) */
function HomeLink() {
  const home = miaojiConfig.routeBase || '/'
  return (
    <a
      href={home}
      className="fixed left-5 top-5 z-50 inline-flex items-center gap-1 rounded-full border border-mj-border bg-mj-surface px-3.5 py-1.5 text-sm text-mj-ink-soft shadow-[var(--mj-shadow-sm)] transition hover:text-mj-ink"
    >
      <ChevronLeft size={16} /> 返回主页
    </a>
  )
}

/** 闻道音波处理动效 */
function MiaojiWave() {
  return (
    <span className="mj-wave" aria-hidden>
      <i />
      <i />
      <i />
      <i />
      <i />
    </span>
  )
}

export function MiaojiDetail({ token }: { token: string }): React.ReactElement {
  const detailQ = trpc.minute.getByToken.useQuery({ token })

  if (detailQ.isLoading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-mj-bg">
        <HomeLink />
        <div className="mj-fade-in flex flex-col items-center gap-4 text-mj-ink-faint">
          <MiaojiWave />
          <span className="text-sm tracking-wide">正在打开闻道…</span>
        </div>
      </div>
    )
  }
  if (detailQ.error || !detailQ.data) {
    return (
      <div className="flex h-dvh items-center justify-center bg-mj-bg px-6">
        <HomeLink />
        <div className="mj-fade-in w-full max-w-sm rounded-2xl bg-mj-surface p-8 text-center shadow-[var(--mj-shadow-pop)]">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-mj-accent-soft">
            <AlertCircle className="text-mj-accent" size={24} />
          </div>
          <p className="text-base font-semibold text-mj-ink">无法打开此纪要</p>
          <p className="mt-2 text-sm text-mj-ink-faint">
            {detailQ.error?.message ?? '可能已被删除或无权访问'}
          </p>
        </div>
      </div>
    )
  }

  const d = detailQ.data
  const status = d.minute.status

  if (status === 'FAILED') {
    return <FailedScreen minuteId={d.minute.id} jobs={d.jobs} />
  }
  if (status !== 'READY') {
    return <ProcessingScreen minuteId={d.minute.id} status={status} jobs={d.jobs} />
  }

  return <Workspace detail={d} />
}

/* ---------- 处理中 ---------- */
function ProcessingScreen({
  minuteId,
  status,
  jobs
}: {
  minuteId: string
  status: string
  jobs: Detail['jobs']
}): React.ReactElement {
  const utils = trpc.useUtils()
  const statusQ = trpc.minute.status.useQuery({ id: minuteId }, { refetchInterval: 3000 })

  const live = statusQ.data?.status ?? status
  const liveJobs = statusQ.data?.jobs ?? jobs

  React.useEffect(() => {
    if (live === 'READY' || live === 'FAILED') {
      void utils.minute.getByToken.invalidate()
    }
  }, [live, utils])

  const jobByStage = new Map(liveJobs.map(j => [j.stage, j]))
  const doneCount = liveJobs.filter(j => j.status === 'DONE').length
  const running = liveJobs.find(j => j.status === 'RUNNING')
  const overall = Math.min(
    99,
    Math.round(((doneCount + (running ? running.progress : 0)) / STAGE_ORDER.length) * 100)
  )
  const ringDeg = overall * 3.6

  return (
    <div className="flex min-h-dvh items-center justify-center bg-mj-bg px-6 py-12">
      <HomeLink />
      <div className="mj-fade-in w-full max-w-md rounded-2xl bg-mj-surface p-8 shadow-[var(--mj-shadow-pop)] sm:p-10">
        {/* 顶部:环形进度 + 音波 */}
        <div className="flex flex-col items-center text-center">
          <div
            className="relative flex h-28 w-28 items-center justify-center rounded-full"
            style={{
              background: `conic-gradient(var(--color-mj-primary) ${ringDeg}deg, var(--color-mj-surface-2) 0deg)`
            }}
          >
            <div className="flex h-[100px] w-[100px] items-center justify-center rounded-full bg-mj-surface">
              <MiaojiWave />
            </div>
          </div>
          <div className="mt-5 text-xl font-semibold tracking-tight text-mj-ink">
            {STATUS_LABEL[live] ?? '处理中'}
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-mj-ink-faint">
            闻道正在处理你的录音，完成后将自动打开 · {overall}%
          </p>
        </div>

        {/* 阶段步进 */}
        <ol className="mt-8 space-y-1">
          {STAGE_ORDER.map(stage => {
            const j = jobByStage.get(stage)
            const st = j?.status ?? 'PENDING'
            const realPct = Math.round((j?.progress ?? 0) * 100)
            // 无真实子进度的 RUNNING 阶段 → 不假报百分比,显示流动「进行中」动画(满条)
            const indeterminate = st === 'RUNNING' && realPct < 2
            const pct =
              st === 'DONE' || st === 'FAILED' || indeterminate ? 100 : st === 'RUNNING' ? realPct : 0
            return (
              <li key={stage} className="flex items-center gap-3 py-1.5">
                <span
                  className={clsx(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-medium',
                    st === 'DONE'
                      ? 'bg-mj-positive text-white'
                      : st === 'RUNNING'
                        ? 'bg-mj-primary text-white'
                        : st === 'FAILED'
                          ? 'bg-mj-accent text-white'
                          : 'bg-mj-surface-2 text-mj-ink-faint'
                  )}
                >
                  {st === 'DONE' ? (
                    <Check size={13} />
                  ) : st === 'FAILED' ? (
                    '!'
                  ) : st === 'RUNNING' ? (
                    <span className="mj-spin inline-block h-3 w-3 rounded-full border-[1.5px] border-white border-t-transparent" />
                  ) : (
                    ''
                  )}
                </span>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className={clsx('text-sm', st === 'PENDING' ? 'text-mj-ink-faint' : 'text-mj-ink')}>
                      {STAGE_LABEL[stage]}
                    </span>
                    {st === 'RUNNING' && (
                      <span className="font-mono text-xs tabular-nums text-mj-ink-faint">
                        {indeterminate ? '进行中' : `${realPct}%`}
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-mj-surface-2">
                    <div
                      className={clsx(
                        'h-full rounded-full transition-all duration-500',
                        st === 'DONE'
                          ? 'bg-mj-positive'
                          : st === 'FAILED'
                            ? 'bg-mj-accent'
                            : 'mj-progress bg-mj-primary'
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  {j?.errorMessage && st !== 'DONE' && (
                    <p className="mt-1 text-xs text-mj-accent">{j.errorMessage}</p>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}

/* ---------- 失败 ---------- */
function FailedScreen({ minuteId, jobs }: { minuteId: string; jobs: Detail['jobs'] }): React.ReactElement {
  const utils = trpc.useUtils()
  const reprocess = trpc.minute.reprocess.useMutation({
    onSuccess: () => {
      toast.success('已重新提交处理')
      void utils.minute.getByToken.invalidate()
    }
  })
  const failed = jobs.find(j => j.status === 'FAILED')
  const isAsr = failed?.stage === 'ASR' || /fetch failed|ECONN|9400|ASR/i.test(failed?.errorMessage ?? '')
  return (
    <div className="flex min-h-dvh items-center justify-center bg-mj-bg px-6 py-12">
      <HomeLink />
      <div className="mj-fade-in w-full max-w-md rounded-2xl bg-mj-surface p-8 text-center shadow-[var(--mj-shadow-pop)] sm:p-10">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-mj-accent-soft">
          <AlertCircle className="text-mj-accent" size={26} />
        </div>
        <div className="text-xl font-semibold tracking-tight text-mj-ink">处理失败</div>
        <p className="mt-2 text-sm leading-relaxed text-mj-ink-soft">
          {isAsr
            ? '语音转写服务暂未就绪(转写引擎未连接)。'
            : (failed?.errorMessage ?? '处理过程中出现问题。')}
        </p>
        {isAsr && (
          <p className="mt-1 text-xs leading-relaxed text-mj-ink-faint">
            转码已完成,待转写引擎启动后点「重新处理」即可继续。
          </p>
        )}
        <Btn
          variant="primary"
          className="mt-6 w-full justify-center"
          onClick={() => reprocess.mutate({ id: minuteId })}
          disabled={reprocess.isPending}
        >
          {reprocess.isPending ? <Spinner className="h-4 w-4" /> : <RefreshCw size={15} />} 重新处理
        </Btn>
      </div>
    </div>
  )
}

/* ---------- 工作区 ---------- */
function Workspace({ detail }: { detail: Detail }): React.ReactElement {
  const { minute, role, speakers, segments, summary, chapters, todos, highlights } = detail
  const canEdit = role === 'MANAGER' || role === 'EDITOR'

  const utils = trpc.useUtils()
  const { rate } = usePlayer()

  const [searchOpen, setSearchOpen] = React.useState(false)
  const [scrollTo, setScrollTo] = React.useState<string | null>(null)
  const [bilingual, setBilingual] = React.useState(false)
  const [transLang, setTransLang] = React.useState<Lang | null>(null)

  // 标题编辑
  const [editingTitle, setEditingTitle] = React.useState(false)
  const [titleDraft, setTitleDraft] = React.useState(minute.title)
  const rename = trpc.minute.rename.useMutation({
    onSuccess: () => {
      void utils.minute.getByToken.invalidate()
      setEditingTitle(false)
    }
  })
  React.useEffect(() => {
    setTitleDraft(minute.title)
  }, [minute.title])

  const reprocess = trpc.minute.reprocess.useMutation({
    onSuccess: () => {
      toast.success('已重新提交处理')
      void utils.minute.getByToken.invalidate()
    }
  })
  // 重转人数:多人会议自动检测常偏少(把几人并成一个),指定人数强制聚类更准
  const [reSpeakers, setReSpeakers] = React.useState<string>('')

  // 翻译
  const translateMut = trpc.translation.translateMinute.useMutation({
    onSuccess: () => void utils.translation.get.invalidate()
  })
  const translationQ = trpc.translation.get.useQuery(
    { minuteId: minute.id, targetLang: (transLang ?? 'en') as Lang },
    { enabled: bilingual && transLang !== null }
  )
  const translations = React.useMemo<TranslationMap | null>(() => {
    if (!bilingual || !translationQ.data) return null
    const m: TranslationMap = {}
    for (const row of translationQ.data) m[row.segmentId] = row.text
    return m
  }, [bilingual, translationQ.data])

  function pickLang(lang: Lang): void {
    setTransLang(lang)
    setBilingual(true)
    translateMut.mutate({ minuteId: minute.id, targetLang: lang })
  }

  // 段 id → startMs 映射(供纪要/待办定位)
  const segStartById = React.useMemo(() => {
    const m = new Map<string, number>()
    for (const s of segments) m.set(s.id, s.startMs)
    return m
  }, [segments])

  const playerSegs: PlayerSegment[] = React.useMemo(
    () => segments.map(s => ({ id: s.id, startMs: s.startMs, endMs: s.endMs, text: s.text })),
    [segments]
  )

  // 结构子集投影(契约源含更多字段 · 此处取组件所需)
  const tSegments: TSegment[] = React.useMemo(
    () =>
      segments.map(s => ({
        id: s.id,
        speakerId: s.speakerId,
        startMs: s.startMs,
        endMs: s.endMs,
        text: s.text,
        words: s.words,
        orderIndex: s.orderIndex,
        paragraphId: s.paragraphId,
        isEdited: s.isEdited
      })),
    [segments]
  )
  const tSpeakers: TSpeaker[] = React.useMemo(
    () =>
      speakers.map(sp => ({
        id: sp.id,
        displayName: sp.displayName,
        colorHex: sp.colorHex,
        orderIndex: sp.orderIndex
      })),
    [speakers]
  )
  const tHighlights: THighlight[] = React.useMemo(
    () =>
      highlights.map(h => ({
        id: h.id,
        segmentId: h.segmentId,
        charStart: h.charStart,
        charEnd: h.charEnd,
        createdBy: h.createdBy
      })),
    [highlights]
  )

  return (
    <div className="flex h-dvh flex-col">
      {/* 顶栏 */}
      <header className="flex shrink-0 items-center gap-3 border-b border-mj-border bg-mj-surface px-5 py-3">
        <a
          href={miaojiConfig.routeBase || '/'}
          title="返回列表"
          className="-ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-mj-ink-soft transition hover:bg-mj-surface-2 hover:text-mj-ink"
        >
          <ChevronLeft size={18} />
        </a>
        <div className="min-w-0 flex-1">
          {editingTitle && canEdit ? (
            <div className="flex items-center gap-2">
              <TextInput
                autoFocus
                value={titleDraft}
                onChange={e => setTitleDraft(e.target.value)}
                className="max-w-md"
                onKeyDown={e => {
                  if (e.key === 'Enter' && titleDraft.trim())
                    rename.mutate({ id: minute.id, title: titleDraft.trim() })
                  if (e.key === 'Escape') setEditingTitle(false)
                }}
              />
              <IconBtn
                label="保存标题"
                onClick={() =>
                  titleDraft.trim() && rename.mutate({ id: minute.id, title: titleDraft.trim() })
                }
              >
                {rename.isPending ? <Spinner className="h-4 w-4" /> : <Check size={16} />}
              </IconBtn>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => canEdit && setEditingTitle(true)}
              className={clsx('group flex items-center gap-2 text-left', canEdit && 'cursor-text')}
            >
              <h1 className="truncate text-lg font-semibold text-mj-ink">{minute.title}</h1>
              {canEdit && (
                <Pencil size={14} className="shrink-0 text-mj-ink-faint opacity-0 group-hover:opacity-100" />
              )}
            </button>
          )}
          <div className="mt-0.5 flex items-center gap-2 text-xs text-mj-ink-faint">
            <span>{fmtDate(minute.createdAt)}</span>
            <span>·</span>
            <span>{fmtDuration(minute.durationMs)}</span>
            <span>·</span>
            <span>{minute.visitorCount} 人看过</span>
          </div>
        </div>

        {/* 倍速 */}
        <Popover
          align="right"
          trigger={(open, toggle) => (
            <Btn size="sm" variant="ghost" onClick={toggle} aria-expanded={open}>
              {rate}× 倍速
            </Btn>
          )}
        >
          {close => (
            <div className="min-w-[7rem]">
              {RATES.map(r => (
                <MenuItem
                  key={r}
                  active={r === rate}
                  onClick={() => {
                    storeSetRate(r)
                    close()
                  }}
                >
                  {r}×
                </MenuItem>
              ))}
            </div>
          )}
        </Popover>

        <IconBtn label="搜索转写" active={searchOpen} onClick={() => setSearchOpen(v => !v)}>
          <SearchIcon size={18} />
        </IconBtn>

        {/* 双语 */}
        <Popover
          align="right"
          trigger={(open, toggle) => (
            <IconBtn label="双语对照" active={bilingual || open} onClick={toggle}>
              <Languages size={18} />
            </IconBtn>
          )}
        >
          {close => (
            <div className="min-w-[10rem]">
              <MenuItem
                active={!bilingual}
                onClick={() => {
                  setBilingual(false)
                  close()
                }}
              >
                仅原文
              </MenuItem>
              <div className="px-2.5 pb-1 pt-2 text-[11px] text-mj-ink-faint">译文对照</div>
              {(['zh', 'en', 'ja'] as Lang[]).map(l => (
                <MenuItem
                  key={l}
                  active={bilingual && transLang === l}
                  onClick={() => {
                    pickLang(l)
                    close()
                  }}
                >
                  {LANG_LABEL[l]}
                  {translateMut.isPending && transLang === l && <Spinner className="ml-auto h-3.5 w-3.5" />}
                </MenuItem>
              ))}
            </div>
          )}
        </Popover>

        <ShareMenu
          minuteId={minute.id}
          token={minute.token}
          linkScope={minute.linkScope as LinkScope}
          canEdit={canEdit}
        />
        <ExportMenu minuteId={minute.id} />

        {canEdit && (
          <Popover
            align="right"
            trigger={(open, toggle) => (
              <IconBtn label="更多" active={open} onClick={toggle}>
                <MoreHorizontal size={18} />
              </IconBtn>
            )}
          >
            {close => (
              <div className="min-w-[13rem]">
                <MenuItem
                  onClick={() => {
                    reprocess.mutate({ id: minute.id })
                    close()
                  }}
                >
                  <RefreshCw size={14} /> 重新处理
                </MenuItem>
                <div className="border-t border-mj-border px-3 py-2">
                  <div className="mb-1.5 text-[11px] text-mj-ink-faint">
                    按指定人数重转(多人会议自动识别常偏少)
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={reSpeakers}
                      onChange={e => setReSpeakers(e.target.value)}
                      className="flex-1 rounded-md border border-mj-border bg-mj-surface px-2 py-1 text-sm text-mj-ink outline-none"
                    >
                      <option value="">自动</option>
                      {[2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                        <option key={n} value={n}>
                          {n} 人
                        </option>
                      ))}
                    </select>
                    <Btn
                      size="sm"
                      variant="primary"
                      disabled={reprocess.isPending}
                      onClick={() => {
                        reprocess.mutate({
                          id: minute.id,
                          numSpeakers: reSpeakers ? Number(reSpeakers) : null
                        })
                        close()
                      }}
                    >
                      重转
                    </Btn>
                  </div>
                </div>
              </div>
            )}
          </Popover>
        )}
      </header>

      {/* 主体两栏 */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        {/* 左:播放器 + 声纹条 + 转写 */}
        <div className="flex min-h-0 min-w-0 flex-col gap-4">
          <div className="shrink-0 space-y-3">
            {minute.playableKey ? (
              <MediaPlayer
                playableKey={minute.playableKey}
                mediaType={minute.mediaType}
                cover={minute.cover}
                segments={playerSegs}
              />
            ) : (
              <div className="rounded-[var(--mj-radius)] border border-mj-border bg-mj-surface px-4 py-6 text-center text-sm text-mj-ink-faint">
                媒体尚不可播放
              </div>
            )}
            <SpeakerStrip
              durationMs={minute.durationMs}
              segments={segments.map(s => ({
                id: s.id,
                speakerId: s.speakerId,
                startMs: s.startMs,
                endMs: s.endMs
              }))}
              speakers={tSpeakers}
              canEdit={canEdit}
            />
            {searchOpen && (
              <SearchBar
                minuteId={minute.id}
                onClose={() => setSearchOpen(false)}
                onLocate={id => setScrollTo(id)}
              />
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-auto rounded-[var(--mj-radius)] border border-mj-border bg-mj-surface px-4 py-6">
            <div className="mx-auto max-w-5xl">
              <TranscriptView
                minuteId={minute.id}
                canEdit={canEdit}
                segments={tSegments}
                speakers={tSpeakers}
                highlights={tHighlights}
                translations={translations}
                scrollToSegmentId={scrollTo}
                onScrolled={() => setScrollTo(null)}
              />
            </div>
          </div>
        </div>

        {/* 右:智能面板 */}
        <div className="min-h-0">
          <RightRail
            minuteId={minute.id}
            canEdit={canEdit}
            summary={summary ?? null}
            chapters={chapters}
            todos={todos}
            segStartById={segStartById}
          />
        </div>
      </div>
    </div>
  )
}
