'use client'
import * as React from 'react'
import clsx from 'clsx'
import { Pencil, Check, X, ChevronDown, Highlighter, MessageSquarePlus, Scissors } from 'lucide-react'
import { alignTextToWords } from '@wuji/miaoji-contracts'
import { trpc } from '../../lib/trpc'
import { fmtClock } from '../../lib/format'
import { seek, usePlayer } from '../../lib/player-store'
import { Btn, IconBtn, TextInput, Popover, MenuItem, Spinner } from '../detail/ui'

/* ---- 本地类型(取 tRPC 返回结构的子集) ---- */

export interface TWord {
  w: string
  start: number // 秒
  end: number // 秒
  score?: number
}
export interface TSegment {
  id: string
  speakerId: string | null
  startMs: number
  endMs: number
  text: string
  words: TWord[]
  orderIndex: number
  paragraphId: string | null
  isEdited: boolean
}
export interface TSpeaker {
  id: string
  displayName: string
  colorHex: string | null
  orderIndex: number
}

/** 说话人无指定色时的回退 */
const FALLBACK_COLOR = 'var(--color-mj-ink-faint)'
export interface THighlight {
  id: string
  segmentId: string
  charStart: number
  charEnd: number
  createdBy: string
}
export type TranslationMap = Record<string, string> // segmentId -> 译文

interface TranscriptViewProps {
  minuteId: string
  canEdit: boolean
  segments: TSegment[]
  speakers: TSpeaker[]
  highlights: THighlight[]
  /** 译文映射(双语开时传入) */
  translations?: TranslationMap | null
  /** 要求滚动到该段(搜索 / 外部跳转) */
  scrollToSegmentId?: string | null
  onScrolled?: () => void
}

interface Paragraph {
  key: string
  speakerId: string | null
  segments: TSegment[]
}

export function TranscriptView({
  minuteId,
  canEdit,
  segments,
  speakers,
  highlights,
  translations,
  scrollToSegmentId,
  onScrolled
}: TranscriptViewProps): React.ReactElement {
  const { currentMs } = usePlayer()
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [editingSeg, setEditingSeg] = React.useState<string | null>(null)

  const speakerMap = React.useMemo(() => {
    const m = new Map<string, TSpeaker>()
    for (const s of speakers) m.set(s.id, s)
    return m
  }, [speakers])

  const hlBySeg = React.useMemo(() => {
    const m = new Map<string, THighlight[]>()
    for (const h of highlights) {
      const arr = m.get(h.segmentId) ?? []
      arr.push(h)
      m.set(h.segmentId, arr)
    }
    return m
  }, [highlights])

  // 当前播放段
  const activeSegId = React.useMemo(() => {
    const seg = segments.find(s => currentMs >= s.startMs && currentMs < s.endMs)
    return seg?.id ?? null
  }, [segments, currentMs])

  // 段落分组(按 paragraphId · 保持 orderIndex)
  const paragraphs = React.useMemo<Paragraph[]>(() => {
    const ordered = [...segments].sort((a, b) => a.orderIndex - b.orderIndex)
    const out: Paragraph[] = []
    for (const s of ordered) {
      const last = out[out.length - 1]
      // paragraphId 为空时按说话人连续性分组(不把无关 null 段合并成一大段)
      const sameGroup =
        last !== undefined &&
        ((s.paragraphId !== null && last.segments[0]?.paragraphId === s.paragraphId) ||
          (s.paragraphId === null &&
            last.segments[0]?.paragraphId === null &&
            last.speakerId === s.speakerId))
      if (sameGroup && last) last.segments.push(s)
      else out.push({ key: s.id, speakerId: s.speakerId, segments: [s] })
    }
    return out
  }, [segments])

  // 自动滚动到当前播放段
  React.useEffect(() => {
    if (!activeSegId) return
    const node = containerRef.current?.querySelector<HTMLElement>(`[data-seg="${activeSegId}"]`)
    if (node) node.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeSegId])

  // 外部请求滚动(搜索命中)
  React.useEffect(() => {
    if (!scrollToSegmentId) return
    const node = containerRef.current?.querySelector<HTMLElement>(`[data-seg="${scrollToSegmentId}"]`)
    if (node) node.scrollIntoView({ block: 'center', behavior: 'smooth' })
    onScrolled?.()
  }, [scrollToSegmentId, onScrolled])

  return (
    <div ref={containerRef} className="space-y-7">
      {paragraphs.map(p => {
        const speaker = p.speakerId ? (speakerMap.get(p.speakerId) ?? null) : null
        return (
          <div key={p.key} className="flex gap-3">
            <ParagraphSpeaker
              speaker={speaker}
              speakers={speakers}
              canEdit={canEdit}
              firstSegId={p.segments[0]?.id ?? null}
            />
            <div className="min-w-0 flex-1 space-y-3">
              {p.segments.map(seg => (
                <SegmentRow
                  key={seg.id}
                  minuteId={minuteId}
                  seg={seg}
                  active={seg.id === activeSegId}
                  currentMs={currentMs}
                  highlights={hlBySeg.get(seg.id) ?? []}
                  translation={translations ? (translations[seg.id] ?? null) : null}
                  canEdit={canEdit}
                  editing={editingSeg === seg.id}
                  onEnterEdit={() => setEditingSeg(seg.id)}
                  onExitEdit={() => setEditingSeg(null)}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ---- 说话人头(可改名) ---- */
function ParagraphSpeaker({
  speaker,
  speakers,
  canEdit,
  firstSegId
}: {
  speaker: TSpeaker | null
  speakers: TSpeaker[]
  canEdit: boolean
  firstSegId: string | null
}): React.ReactElement {
  const [renaming, setRenaming] = React.useState(false)
  const [name, setName] = React.useState(speaker?.displayName ?? '')
  const utils = trpc.useUtils()
  const rename = trpc.speaker.rename.useMutation({
    onSuccess: () => {
      void utils.minute.getByToken.invalidate()
      setRenaming(false)
    }
  })
  const reassign = trpc.speaker.reassignSegment.useMutation({
    onSuccess: () => void utils.minute.getByToken.invalidate()
  })

  React.useEffect(() => {
    setName(speaker?.displayName ?? '')
  }, [speaker?.displayName])

  const color = speaker?.colorHex ?? FALLBACK_COLOR

  if (renaming && speaker) {
    return (
      <div className="w-28 shrink-0">
        <div className="flex items-center gap-1">
          <TextInput
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            className="h-7 text-xs"
            onKeyDown={e => {
              if (e.key === 'Enter' && name.trim())
                rename.mutate({ speakerId: speaker.id, displayName: name.trim() })
              if (e.key === 'Escape') setRenaming(false)
            }}
          />
          <IconBtn
            label="保存"
            className="h-7 w-7"
            onClick={() => name.trim() && rename.mutate({ speakerId: speaker.id, displayName: name.trim() })}
          >
            {rename.isPending ? <Spinner className="h-3.5 w-3.5" /> : <Check size={14} />}
          </IconBtn>
        </div>
      </div>
    )
  }

  return (
    <div className="w-28 shrink-0 pt-0.5">
      <Popover
        align="left"
        trigger={(open, toggle) => (
          <button
            type="button"
            onClick={canEdit ? toggle : undefined}
            className={clsx(
              'flex max-w-full items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium',
              canEdit && 'hover:bg-mj-surface-2'
            )}
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
            <span className="truncate text-mj-ink">{speaker?.displayName ?? '未知'}</span>
            {canEdit && <ChevronDown size={12} className="shrink-0 text-mj-ink-faint" />}
          </button>
        )}
      >
        {close => (
          <div className="min-w-[12rem]">
            {speaker && (
              <MenuItem
                onClick={() => {
                  setRenaming(true)
                  close()
                }}
              >
                <Pencil size={14} /> 重命名说话人
              </MenuItem>
            )}
            {firstSegId && (
              <>
                <div className="px-2.5 pb-1 pt-2 text-[11px] text-mj-ink-faint">改派此段说话人</div>
                {speakers.map(sp => (
                  <MenuItem
                    key={sp.id}
                    active={sp.id === speaker?.id}
                    onClick={() => {
                      reassign.mutate({ segmentId: firstSegId, speakerId: sp.id })
                      close()
                    }}
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: sp.colorHex ?? FALLBACK_COLOR }}
                    />
                    {sp.displayName}
                  </MenuItem>
                ))}
              </>
            )}
          </div>
        )}
      </Popover>
    </div>
  )
}

/* ---- 单段(词级 karaoke + 高亮 + 编辑 + 选区工具条) ---- */
interface SegmentRowProps {
  minuteId: string
  seg: TSegment
  active: boolean
  currentMs: number
  highlights: THighlight[]
  translation: string | null
  canEdit: boolean
  editing: boolean
  onEnterEdit: () => void
  onExitEdit: () => void
}

function SegmentRow({
  minuteId,
  seg,
  active,
  currentMs,
  highlights,
  translation,
  canEdit,
  editing,
  onEnterEdit,
  onExitEdit
}: SegmentRowProps): React.ReactElement {
  const utils = trpc.useUtils()
  const editMut = trpc.transcript.editSegment.useMutation({
    onSuccess: () => {
      void utils.minute.getByToken.invalidate()
      onExitEdit()
    }
  })
  const addHl = trpc.collab.addHighlight.useMutation({
    onSuccess: () => void utils.minute.getByToken.invalidate()
  })
  const addComment = trpc.collab.addComment.useMutation({
    onSuccess: () => {
      void utils.minute.getByToken.invalidate()
      void utils.collab.listComments.invalidate()
    }
  })
  const createClip = trpc.collab.createClip.useMutation({
    onSuccess: () => {
      void utils.minute.getByToken.invalidate()
      void utils.collab.listClips.invalidate()
    }
  })

  const [draft, setDraft] = React.useState(seg.text)
  const [sel, setSel] = React.useState<{ start: number; end: number } | null>(null)
  const [composing, setComposing] = React.useState(false)
  const [commentBody, setCommentBody] = React.useState('')
  const textRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    setDraft(seg.text)
  }, [seg.text])

  // 词级渲染 + 字符级高亮叠加
  // 渲染源永远是 seg.text(带标点);words 只供时间戳。直接 join words 会丢标点
  // (whisper 词不含标点,标点在 text 里)。对不齐(编辑过)→ 退回纯文本。
  const groups = React.useMemo(() => alignTextToWords(seg.text, seg.words), [seg.text, seg.words])

  function isHl(charIdx: number): boolean {
    return highlights.some(h => charIdx >= h.charStart && charIdx < h.charEnd)
  }

  // 计算文本选区的字符偏移(相对本段)
  function captureSelection(): void {
    const s = window.getSelection()
    if (!s || s.rangeCount === 0 || s.isCollapsed || !textRef.current) {
      setSel(null)
      return
    }
    const range = s.getRangeAt(0)
    if (!textRef.current.contains(range.commonAncestorContainer)) {
      setSel(null)
      return
    }
    const pre = range.cloneRange()
    pre.selectNodeContents(textRef.current)
    pre.setEnd(range.startContainer, range.startOffset)
    const start = pre.toString().length
    const end = start + range.toString().length
    if (end > start) setSel({ start, end })
    else setSel(null)
  }

  function commitEdit(): void {
    const t = draft.trim()
    if (t && t !== seg.text) editMut.mutate({ segmentId: seg.id, text: t })
    else onExitEdit()
  }

  return (
    <div
      data-seg={seg.id}
      className={clsx(
        'group relative rounded-[var(--mj-radius)] px-3 py-2 transition',
        active ? 'mj-segment-active' : 'hover:bg-mj-surface-2/60'
      )}
    >
      <div className="mb-1 flex items-center gap-2">
        <button
          type="button"
          onClick={() => seek(seg.startMs)}
          className="font-mono text-[11px] tabular-nums text-mj-ink-faint hover:text-mj-primary"
        >
          {fmtClock(seg.startMs)}
        </button>
        {seg.isEdited && <span className="text-[10px] text-mj-ink-faint">已编辑</span>}
        {canEdit && !editing && (
          <IconBtn
            label="编辑此段"
            className="h-6 w-6 opacity-0 group-hover:opacity-100"
            onClick={() => {
              setDraft(seg.text)
              onEnterEdit()
            }}
          >
            <Pencil size={13} />
          </IconBtn>
        )}
      </div>

      {editing ? (
        <div>
          <textarea
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commitEdit}
            rows={Math.max(2, Math.ceil(draft.length / 40))}
            className="w-full resize-none rounded-md border border-mj-primary bg-mj-surface p-2 text-[15px] leading-8 text-mj-ink outline-none"
            onKeyDown={e => {
              if (e.key === 'Escape') {
                setDraft(seg.text)
                onExitEdit()
              }
            }}
          />
          <div className="mt-1.5 flex items-center gap-2">
            <Btn size="sm" variant="primary" onClick={commitEdit} disabled={editMut.isPending}>
              {editMut.isPending ? <Spinner className="h-3.5 w-3.5" /> : <Check size={14} />}
              保存
            </Btn>
            <Btn
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(seg.text)
                onExitEdit()
              }}
            >
              取消
            </Btn>
          </div>
        </div>
      ) : (
        <>
          <div ref={textRef} className="text-[15px] leading-8 text-mj-ink" onMouseUp={captureSelection}>
            {groups
              ? groups.map((g, i) => {
                  const w = seg.words[g.wordIdx]!
                  const wActive = currentMs >= w.start * 1000 && currentMs < w.end * 1000
                  const highlighted = isHl(g.charStart)
                  return (
                    <span
                      key={i}
                      onClick={() => seek(Math.round(w.start * 1000))}
                      className={clsx(
                        'cursor-pointer',
                        wActive && 'mj-word-active',
                        highlighted && 'mj-hl-mark'
                      )}
                    >
                      {g.text}
                    </span>
                  )
                })
              : seg.text}
          </div>

          {translation && (
            <div className="mt-1 border-l-2 border-mj-border pl-2.5 text-sm leading-7 text-mj-ink-soft">
              {translation}
            </div>
          )}

          {/* 选区浮动工具条 */}
          {sel && canEdit && (
            <div className="mt-1.5 inline-flex items-center gap-1 rounded-[var(--mj-radius)] border border-mj-border bg-mj-surface px-1.5 py-1 shadow-md">
              <IconBtn
                label="高亮"
                className="h-7 w-7"
                onClick={() => {
                  addHl.mutate({
                    minuteId,
                    segmentId: seg.id,
                    charStart: sel.start,
                    charEnd: sel.end
                  })
                  setSel(null)
                  window.getSelection()?.removeAllRanges()
                }}
              >
                <Highlighter size={15} />
              </IconBtn>
              <IconBtn
                label="评论"
                className="h-7 w-7"
                active={composing}
                onClick={() => setComposing(v => !v)}
              >
                <MessageSquarePlus size={15} />
              </IconBtn>
              <IconBtn
                label="创建片段"
                className="h-7 w-7"
                onClick={() => {
                  createClip.mutate({
                    minuteId,
                    startMs: seg.startMs,
                    endMs: seg.endMs,
                    title: seg.text.slice(0, 24)
                  })
                  setSel(null)
                  window.getSelection()?.removeAllRanges()
                }}
              >
                <Scissors size={15} />
              </IconBtn>
            </div>
          )}

          {composing && sel && canEdit && (
            <div className="mt-2 rounded-[var(--mj-radius)] border border-mj-border bg-mj-surface-2 p-2">
              <TextInput
                autoFocus
                value={commentBody}
                placeholder="写下评论…"
                onChange={e => setCommentBody(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Escape') {
                    setComposing(false)
                    setCommentBody('')
                  }
                }}
              />
              <div className="mt-2 flex items-center justify-end gap-2">
                <Btn
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setComposing(false)
                    setCommentBody('')
                  }}
                >
                  <X size={14} /> 取消
                </Btn>
                <Btn
                  size="sm"
                  variant="primary"
                  disabled={!commentBody.trim() || addComment.isPending}
                  onClick={() => {
                    addComment.mutate(
                      {
                        minuteId,
                        segmentId: seg.id,
                        charStart: sel.start,
                        charEnd: sel.end,
                        body: commentBody.trim()
                      },
                      {
                        onSuccess: () => {
                          setComposing(false)
                          setCommentBody('')
                          setSel(null)
                        }
                      }
                    )
                  }}
                >
                  {addComment.isPending ? <Spinner className="h-3.5 w-3.5" /> : '发送'}
                </Btn>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default TranscriptView
