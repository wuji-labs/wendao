'use client'
import * as React from 'react'
import { RefreshCw, AlertTriangle, ArrowRight } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { seek } from '../../lib/player-store'
import { Btn, Spinner, EmptyState } from '../detail/ui'

export interface SummaryData {
  overview: string
  keyPoints: { text: string; sourceSegmentId: string | null }[]
  risks: string[]
}

interface SummaryPanelProps {
  minuteId: string
  canEdit: boolean
  summary: SummaryData | null
  segStartById: Map<string, number>
}

export function SummaryPanel({
  minuteId,
  canEdit,
  summary,
  segStartById
}: SummaryPanelProps): React.ReactElement {
  const utils = trpc.useUtils()
  const regen = trpc.ai.regenerateSummary.useMutation({
    onSuccess: () => void utils.minute.getByToken.invalidate()
  })

  return (
    <div className="space-y-6 p-4">
      {canEdit && summary && (
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

      {!summary ? (
        <div className="flex flex-col items-center gap-3 py-14 text-center">
          <p className="text-sm text-mj-ink-faint">智能纪要按需生成 · 总结 / 要点 / 风险(本机 AI)</p>
          {canEdit ? (
            <Btn variant="primary" onClick={() => regen.mutate({ minuteId })} disabled={regen.isPending}>
              {regen.isPending ? (
                <>
                  <Spinner className="h-4 w-4" /> 正在生成…
                </>
              ) : (
                '生成智能纪要'
              )}
            </Btn>
          ) : (
            <span className="text-xs text-mj-ink-faint">暂无纪要</span>
          )}
        </div>
      ) : (
        <>
          <section>
            <h3 className="mb-2 text-sm font-semibold text-mj-ink">概览</h3>
            <p className="text-sm leading-7 text-mj-ink-soft">{summary.overview}</p>
          </section>

          {summary.keyPoints.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-mj-ink">要点</h3>
              <ul className="space-y-2">
                {summary.keyPoints.map((kp, i) => {
                  const ms = kp.sourceSegmentId ? segStartById.get(kp.sourceSegmentId) : undefined
                  return (
                    <li key={i}>
                      <button
                        type="button"
                        disabled={ms === undefined}
                        onClick={() => ms !== undefined && seek(ms)}
                        className="group flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm leading-7 text-mj-ink-soft enabled:hover:bg-mj-surface-2"
                      >
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-mj-primary" />
                        <span className="flex-1">{kp.text}</span>
                        {ms !== undefined && (
                          <ArrowRight
                            size={14}
                            className="mt-1.5 shrink-0 text-mj-ink-faint opacity-0 group-hover:opacity-100"
                          />
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          {summary.risks.length > 0 && (
            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-mj-warn">
                <AlertTriangle size={15} /> 风险与待澄清
              </h3>
              <ul className="space-y-1.5">
                {summary.risks.map((r, i) => (
                  <li
                    key={i}
                    className="rounded-md bg-mj-surface-2 px-3 py-2 text-sm leading-6 text-mj-ink-soft"
                  >
                    {r}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}

export default SummaryPanel
