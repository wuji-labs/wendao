'use client'
import * as React from 'react'
import { toast } from 'sonner'
import { Check, Mic } from 'lucide-react'
import { fmtClock } from '../../lib/format'
import { seek, usePlayer } from '../../lib/player-store'
import { trpc } from '../../lib/trpc'
import { Dialog } from '../ui/dialog'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { Spinner } from '../ui/spinner'
import { VoiceprintEnrollDialog } from './voiceprint-enroll-dialog'

export interface StripSegment {
  id: string
  speakerId: string | null
  startMs: number
  endMs: number
}
export interface StripSpeaker {
  id: string
  displayName: string
  colorHex: string | null
}

interface SpeakerStripProps {
  durationMs: number
  segments: StripSegment[]
  speakers: StripSpeaker[]
  /** 可编辑(MANAGER/EDITOR)才显示命名/声纹入口 */
  canEdit?: boolean
}

export function SpeakerStrip({
  durationMs,
  segments,
  speakers,
  canEdit
}: SpeakerStripProps): React.ReactElement | null {
  const { currentMs } = usePlayer()
  const utils = trpc.useUtils()
  const [editing, setEditing] = React.useState<StripSpeaker | null>(null)
  const [name, setName] = React.useState('')
  const [recordOpen, setRecordOpen] = React.useState(false)

  const vpList = trpc.voiceprint.list.useQuery(undefined, { enabled: !!editing })
  const done = () => {
    void utils.minute.getByToken.invalidate()
    void utils.voiceprint.list.invalidate()
    setEditing(null)
    setName('')
  }
  const enroll = trpc.voiceprint.enroll.useMutation({
    onSuccess: () => {
      toast.success('已命名并存入声纹库,以后会自动识别')
      done()
    },
    onError: e => toast.error(e.message)
  })
  const assign = trpc.voiceprint.assign.useMutation({
    onSuccess: () => {
      toast.success('已认领')
      done()
    },
    onError: e => toast.error(e.message)
  })

  const speakerMap = React.useMemo(() => {
    const m = new Map<string, StripSpeaker>()
    for (const s of speakers) m.set(s.id, s)
    return m
  }, [speakers])

  if (durationMs <= 0 || segments.length === 0) return null

  const playheadPct = Math.min(100, (currentMs / durationMs) * 100)

  function onTrackClick(e: React.MouseEvent<HTMLDivElement>): void {
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    seek(ratio * durationMs)
  }

  const openEdit = (sp: StripSpeaker) => {
    setEditing(sp)
    setName(sp.displayName.startsWith('说话人') ? '' : sp.displayName)
  }

  return (
    <div>
      <div
        onClick={onTrackClick}
        className="relative h-6 w-full cursor-pointer overflow-hidden rounded-md bg-mj-surface-2"
        role="presentation"
      >
        {segments.map(seg => {
          const left = (seg.startMs / durationMs) * 100
          const width = Math.max(0.3, ((seg.endMs - seg.startMs) / durationMs) * 100)
          const sp = seg.speakerId ? speakerMap.get(seg.speakerId) : undefined
          const color = sp?.colorHex ?? 'var(--color-mj-ink-faint)'
          return (
            <div
              key={seg.id}
              className="absolute inset-y-0 transition-opacity hover:opacity-80"
              style={{ left: `${left}%`, width: `${width}%`, background: color }}
              title={`${sp?.displayName ?? '未知'} · ${fmtClock(seg.startMs)}`}
              onClick={e => {
                e.stopPropagation()
                seek(seg.startMs)
              }}
            />
          )
        })}
        <div
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-mj-ink"
          style={{ left: `${playheadPct}%` }}
        />
      </div>

      {speakers.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5">
          {speakers.map(sp => {
            const chip = (
              <>
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: sp.colorHex ?? 'var(--color-mj-ink-faint)' }}
                />
                {sp.displayName}
              </>
            )
            return canEdit ? (
              <button
                key={sp.id}
                type="button"
                onClick={() => openEdit(sp)}
                className="inline-flex items-center gap-1.5 rounded-full border border-mj-border px-2 py-0.5 text-[11px] text-mj-ink-soft transition hover:border-mj-primary hover:text-mj-ink"
                title="点击命名 / 认领声纹"
              >
                {chip}
              </button>
            ) : (
              <span key={sp.id} className="inline-flex items-center gap-1.5 text-[11px] text-mj-ink-soft">
                {chip}
              </span>
            )
          })}
        </div>
      )}

      <Dialog open={!!editing} onClose={() => setEditing(null)} title="命名说话人 · 声纹库">
        {editing && (
          <div className="flex flex-col gap-4">
            <div>
              <p className="mb-1.5 text-sm font-medium text-mj-ink">设为真名(并存入声纹库)</p>
              <div className="flex gap-2">
                <Input
                  autoFocus
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="如:邹总 / 龙董"
                  onKeyDown={e =>
                    e.key === 'Enter' &&
                    name.trim() &&
                    enroll.mutate({ speakerId: editing.id, name: name.trim() })
                  }
                />
                <Button
                  variant="primary"
                  disabled={!name.trim() || enroll.isPending}
                  onClick={() => enroll.mutate({ speakerId: editing.id, name: name.trim() })}
                >
                  {enroll.isPending ? <Spinner className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                  保存
                </Button>
              </div>
              <p className="mt-1 text-xs text-mj-ink-faint">下次会议这个人说话会自动标上此名</p>
              <button
                type="button"
                onClick={() => setRecordOpen(true)}
                className="mt-2 inline-flex items-center gap-1.5 text-xs text-mj-primary hover:underline"
              >
                <Mic className="h-3.5 w-3.5" /> 录一段更准的声纹(会议里说得少时推荐)
              </button>
            </div>

            {(vpList.data?.length ?? 0) > 0 && (
              <div>
                <p className="mb-1.5 text-sm font-medium text-mj-ink">或认领已有声纹</p>
                <div className="flex flex-wrap gap-2">
                  {vpList.data!.map(vp => (
                    <button
                      key={vp.id}
                      type="button"
                      disabled={assign.isPending}
                      onClick={() => assign.mutate({ speakerId: editing.id, voiceprintId: vp.id })}
                      className="inline-flex items-center gap-1 rounded-full border border-mj-border px-3 py-1 text-sm text-mj-ink-soft transition hover:border-mj-primary hover:text-mj-ink"
                    >
                      <Check className="h-3.5 w-3.5" />
                      {vp.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Dialog>

      <VoiceprintEnrollDialog
        open={recordOpen}
        onClose={() => setRecordOpen(false)}
        defaultName={name}
        onEnrolled={vpId => {
          if (editing) assign.mutate({ speakerId: editing.id, voiceprintId: vpId })
        }}
      />
    </div>
  )
}

export default SpeakerStrip
