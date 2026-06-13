'use client'
import * as React from 'react'
import clsx from 'clsx'
import { RefreshCw, Check, User, ArrowRight } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { seek } from '../../lib/player-store'
import { Btn, Spinner, EmptyState } from '../detail/ui'

export type TodoStatus = 'OPEN' | 'DONE' | 'CANCELLED'
export interface TodoData {
  id: string
  text: string
  owner: string | null
  sourceSegmentId: string | null
  status: TodoStatus
  orderIndex: number
}

interface TodosPanelProps {
  minuteId: string
  canEdit: boolean
  todos: TodoData[]
  segStartById: Map<string, number>
}

export function TodosPanel({ minuteId, canEdit, todos, segStartById }: TodosPanelProps): React.ReactElement {
  const utils = trpc.useUtils()
  const regen = trpc.ai.regenerateTodos.useMutation({
    onSuccess: () => void utils.minute.getByToken.invalidate()
  })
  const setStatus = trpc.ai.setTodoStatus.useMutation({
    onSuccess: () => void utils.minute.getByToken.invalidate()
  })

  const ordered = React.useMemo(() => [...todos].sort((a, b) => a.orderIndex - b.orderIndex), [todos])

  return (
    <div className="space-y-3 p-4">
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
          <p className="text-sm text-mj-ink-faint">从会议中提取待办事项(本机 AI)</p>
          {canEdit ? (
            <Btn variant="primary" onClick={() => regen.mutate({ minuteId })} disabled={regen.isPending}>
              {regen.isPending ? (
                <>
                  <Spinner className="h-4 w-4" /> 正在生成…
                </>
              ) : (
                '生成待办'
              )}
            </Btn>
          ) : (
            <span className="text-xs text-mj-ink-faint">暂无待办</span>
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {ordered.map(t => {
            const done = t.status === 'DONE'
            const cancelled = t.status === 'CANCELLED'
            const ms = t.sourceSegmentId ? segStartById.get(t.sourceSegmentId) : undefined
            return (
              <li
                key={t.id}
                className="flex items-start gap-2.5 rounded-[var(--mj-radius)] border border-mj-border px-3 py-2.5"
              >
                <button
                  type="button"
                  disabled={!canEdit || cancelled}
                  onClick={() => setStatus.mutate({ id: t.id, status: done ? 'OPEN' : 'DONE' })}
                  aria-label={done ? '标记未完成' : '标记完成'}
                  className={clsx(
                    'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition',
                    done
                      ? 'border-mj-positive bg-mj-positive text-white'
                      : 'border-mj-border-strong text-transparent hover:border-mj-primary'
                  )}
                >
                  <Check size={13} />
                </button>
                <div className="min-w-0 flex-1">
                  <div
                    className={clsx(
                      'text-sm leading-6',
                      done && 'text-mj-ink-faint line-through',
                      cancelled && 'text-mj-ink-faint line-through',
                      !done && !cancelled && 'text-mj-ink'
                    )}
                  >
                    {t.text}
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    {t.owner && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-mj-surface-2 px-2 py-0.5 text-[11px] text-mj-ink-soft">
                        <User size={11} /> {t.owner}
                      </span>
                    )}
                    {ms !== undefined && (
                      <button
                        type="button"
                        onClick={() => seek(ms)}
                        className="inline-flex items-center gap-0.5 text-[11px] text-mj-primary hover:underline"
                      >
                        定位原文 <ArrowRight size={11} />
                      </button>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default TodosPanel
