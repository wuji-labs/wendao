'use client'
import * as React from 'react'
import { AlertCircle } from 'lucide-react'
import { trpc } from '../lib/trpc'
import { fmtClock } from '../lib/format'
import { seek } from '../lib/player-store'
import { MediaPlayer, type PlayerSegment } from '../components/player/media-player'
import { Spinner } from '../components/detail/ui'

export function MiaojiClip({ token }: { token: string }): React.ReactElement {
  const q = trpc.collab.getClipByToken.useQuery({ token })

  if (q.isLoading) {
    return (
      <div className="flex h-dvh items-center justify-center text-mj-ink-faint">
        <Spinner className="h-6 w-6" />
      </div>
    )
  }
  if (q.error || !q.data || !q.data.minute) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 text-mj-ink-soft">
        <AlertCircle className="text-mj-accent" size={28} />
        <p>片段不存在或已被删除</p>
      </div>
    )
  }

  const { clip, minute, segments } = q.data

  const playerSegs: PlayerSegment[] = segments.map(s => ({
    id: s.id,
    startMs: s.startMs,
    endMs: s.endMs,
    text: s.text
  }))

  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-mj-ink">{clip.title}</h1>
        <p className="mt-1 text-sm text-mj-ink-faint">
          {minute.title} · 片段 {fmtClock(clip.startMs)} – {fmtClock(clip.endMs)}
        </p>
      </div>

      {minute.playableKey ? (
        <MediaPlayer
          playableKey={minute.playableKey}
          mediaType={minute.mediaType}
          cover={minute.cover}
          segments={playerSegs}
          clipRange={{ startMs: clip.startMs, endMs: clip.endMs }}
        />
      ) : (
        <div className="rounded-[var(--mj-radius)] border border-mj-border bg-mj-surface px-4 py-6 text-center text-sm text-mj-ink-faint">
          媒体不可播放
        </div>
      )}

      <div className="mt-6 space-y-3 rounded-[var(--mj-radius)] border border-mj-border bg-mj-surface px-4 py-5">
        {segments.length === 0 ? (
          <div className="py-6 text-center text-sm text-mj-ink-faint">此片段无转写内容</div>
        ) : (
          segments.map(s => (
            <div key={s.id} className="flex gap-3">
              <button
                type="button"
                onClick={() => seek(s.startMs)}
                className="shrink-0 pt-1 font-mono text-[11px] tabular-nums text-mj-ink-faint hover:text-mj-primary"
              >
                {fmtClock(s.startMs)}
              </button>
              <p className="flex-1 text-[15px] leading-8 text-mj-ink">{s.text}</p>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
