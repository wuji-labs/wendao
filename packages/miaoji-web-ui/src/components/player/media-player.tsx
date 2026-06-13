'use client'
import * as React from 'react'
import { Play, Pause, Captions, SkipForward, Gauge } from 'lucide-react'
import { fmtClock, mediaUrl } from '../../lib/format'
import { register, seekOnly, togglePlay, setRate as storeSetRate, usePlayer } from '../../lib/player-store'
import { IconBtn, Popover, MenuItem } from '../detail/ui'

const RATES = [0.75, 1, 1.25, 1.5, 2] as const

export interface PlayerSegment {
  id: string
  startMs: number
  endMs: number
  text: string
}

interface MediaPlayerProps {
  playableKey: string
  mediaType: 'AUDIO' | 'VIDEO'
  cover?: string | null
  segments: PlayerSegment[]
  /** 限定播放区间(片段公开页用) */
  clipRange?: { startMs: number; endMs: number } | null
}

export function MediaPlayer({
  playableKey,
  mediaType,
  cover,
  segments,
  clipRange = null
}: MediaPlayerProps): React.ReactElement {
  const mediaRef = React.useRef<HTMLMediaElement | null>(null)
  const { currentMs, durationMs, playing, rate, seek } = usePlayer()
  const [cc, setCc] = React.useState(true)
  const [skipGaps, setSkipGaps] = React.useState(false)

  const setMedia = React.useCallback((el: HTMLMediaElement | null) => {
    mediaRef.current = el
  }, [])

  // 注册媒体元素到 store
  React.useEffect(() => {
    const el = mediaRef.current
    if (!el) return
    return register(el)
  }, [playableKey, mediaType])

  // 空格键 切换 播放/暂停(在输入框/可编辑区内不拦截)
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return
      const t = e.target as HTMLElement | null
      const tag = t?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || t?.isContentEditable) return
      e.preventDefault()
      togglePlay()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // clip 区间约束 · 到 endMs 自动暂停, 进度回落到 startMs
  React.useEffect(() => {
    if (!clipRange) return
    const el = mediaRef.current
    if (!el) return
    function onTime(): void {
      if (!el) return
      if (clipRange && el.currentTime * 1000 >= clipRange.endMs) {
        el.pause()
        el.currentTime = clipRange.startMs / 1000
      }
    }
    el.addEventListener('timeupdate', onTime)
    return () => el.removeEventListener('timeupdate', onTime)
  }, [clipRange])

  // 跳过空白: 当前在 segment 间隙 > 2s 时跳到下一段开头
  React.useEffect(() => {
    if (!skipGaps || segments.length === 0) return
    const inSeg = segments.some(s => currentMs >= s.startMs && currentMs < s.endMs)
    if (inSeg) return
    const next = segments.find(s => s.startMs > currentMs)
    if (next && next.startMs - currentMs > 2000 && playing) {
      seek(next.startMs)
    }
  }, [skipGaps, currentMs, segments, playing, seek])

  const activeSeg = React.useMemo(
    () => segments.find(s => currentMs >= s.startMs && currentMs < s.endMs) ?? null,
    [segments, currentMs]
  )

  const total = clipRange ? clipRange.endMs - clipRange.startMs : durationMs
  const elapsed = clipRange ? Math.max(0, currentMs - clipRange.startMs) : currentMs
  const pct = total > 0 ? Math.min(100, (elapsed / total) * 100) : 0

  function onScrub(e: React.MouseEvent<HTMLDivElement>): void {
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    const base = clipRange ? clipRange.startMs : 0
    seekOnly(base + ratio * total)
  }

  const src = mediaUrl(playableKey)

  return (
    <div className="overflow-hidden rounded-[var(--mj-radius)] border border-mj-border bg-mj-surface">
      {mediaType === 'VIDEO' ? (
        <div className="relative bg-black">
          <video
            ref={setMedia as React.Ref<HTMLVideoElement>}
            src={src}
            poster={cover ?? undefined}
            className="max-h-[46vh] w-full bg-black"
            playsInline
          />
          {cc && activeSeg && (
            <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-6">
              <span className="rounded-md bg-mj-ink/70 px-3 py-1.5 text-center text-sm leading-relaxed text-white">
                {activeSeg.text}
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-4 bg-mj-surface-2 px-5 py-6">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cover} alt="" className="h-16 w-16 rounded-md object-cover" />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-md bg-mj-primary-soft text-mj-primary">
              <Play size={24} />
            </div>
          )}
          <div className="min-h-[3rem] flex-1 text-sm leading-relaxed text-mj-ink-soft">
            {cc && activeSeg ? activeSeg.text : <span className="text-mj-ink-faint">音频纪要</span>}
          </div>
          <audio ref={setMedia as React.Ref<HTMLAudioElement>} src={src} className="hidden" />
        </div>
      )}

      {/* 控制条 */}
      <div className="px-4 py-3">
        <div
          className="group relative h-2 cursor-pointer rounded-full bg-mj-surface-2"
          onClick={onScrub}
          role="slider"
          aria-label="播放进度"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
          tabIndex={0}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-mj-primary"
            style={{ width: `${pct}%` }}
          />
          <div
            className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-mj-primary shadow opacity-0 transition group-hover:opacity-100"
            style={{ left: `calc(${pct}% - 7px)` }}
          />
        </div>

        <div className="mt-2.5 flex items-center gap-1">
          <IconBtn label={playing ? '暂停' : '播放'} onClick={togglePlay} className="text-mj-ink">
            {playing ? <Pause size={18} /> : <Play size={18} />}
          </IconBtn>

          <span className="ml-1 font-mono text-xs tabular-nums text-mj-ink-soft">
            {fmtClock(elapsed)} / {fmtClock(total)}
          </span>

          <div className="ml-auto flex items-center gap-1">
            <Popover
              align="right"
              trigger={(open, toggle) => (
                <IconBtn label="倍速" active={open || rate !== 1} onClick={toggle}>
                  <span className="flex items-center gap-0.5 text-xs font-medium">
                    <Gauge size={15} />
                    {rate}×
                  </span>
                </IconBtn>
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
                      {r}×{r === 1 && ' · 正常'}
                    </MenuItem>
                  ))}
                </div>
              )}
            </Popover>

            <IconBtn label="字幕" active={cc} onClick={() => setCc(v => !v)}>
              <Captions size={18} />
            </IconBtn>

            {!clipRange && (
              <IconBtn label="跳过空白" active={skipGaps} onClick={() => setSkipGaps(v => !v)}>
                <SkipForward size={18} />
              </IconBtn>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export { RATES }
export default MediaPlayer

export type { MediaPlayerProps }
