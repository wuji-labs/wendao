'use client'
import * as React from 'react'
import clsx from 'clsx'
import { RefreshCw } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { fmtClock } from '../../lib/format'
import { seek, usePlayer } from '../../lib/player-store'
import { Btn, Spinner, EmptyState } from '../detail/ui'

export interface ChapterData {
  id: string
  title: string
  startMs: number
  endMs: number
  summary: string
  orderIndex: number
}

interface ChaptersPanelProps {
  minuteId: string
  canEdit: boolean
  chapters: ChapterData[]
}

export function ChaptersPanel({ minuteId, canEdit, chapters }: ChaptersPanelProps): React.ReactElement {
  const { currentMs } = usePlayer()
  const utils = trpc.useUtils()
  const regen = trpc.ai.regenerateChapters.useMutation({
    onSuccess: () => void utils.minute.getByToken.invalidate()
  })

  const ordered = React.useMemo(() => [...chapters].sort((a, b) => a.orderIndex - b.orderIndex), [chapters])

  return (
    <div className="space-y-4 p-4">
      {canEdit && ordered.length > 0 && (
        <div className="flex justify-end">
          <Btn
            size="sm"
            variant="ghost"
            onClick={() => regen.mutate({ minuteId })}
            disabled={regen.isPending}
          >
            {regen.isPending ? <Spinner className="h-3.5 w-3.5" /> : <RefreshCw size={14} />}
            重新生成
          </Btn>
        </div>
      )}

      {ordered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-14 text-center">
          <p className="text-sm text-mj-ink-faint">按内容自动划分章节(本机 AI)</p>
          {canEdit ? (
            <Btn variant="primary" onClick={() => regen.mutate({ minuteId })} disabled={regen.isPending}>
              {regen.isPending ? (
                <>
                  <Spinner className="h-4 w-4" /> 正在生成…
                </>
              ) : (
                '生成章节'
              )}
            </Btn>
          ) : (
            <span className="text-xs text-mj-ink-faint">暂无章节</span>
          )}
        </div>
      ) : (
        <ol className="space-y-2">
          {ordered.map((c, i) => {
            const current = currentMs >= c.startMs && currentMs < c.endMs
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => seek(c.startMs)}
                  className={clsx(
                    'w-full rounded-[var(--mj-radius)] border px-3 py-2.5 text-left transition',
                    current
                      ? 'border-mj-primary bg-mj-primary-soft'
                      : 'border-mj-border hover:bg-mj-surface-2'
                  )}
                >
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-xs tabular-nums text-mj-ink-faint">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span
                      className={clsx(
                        'flex-1 text-sm font-medium',
                        current ? 'text-mj-primary' : 'text-mj-ink'
                      )}
                    >
                      {c.title}
                    </span>
                    <span className="font-mono text-[11px] tabular-nums text-mj-ink-faint">
                      {fmtClock(c.startMs)}
                    </span>
                  </div>
                  {c.summary && <p className="mt-1 pl-7 text-xs leading-6 text-mj-ink-soft">{c.summary}</p>}
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

export default ChaptersPanel
