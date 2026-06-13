'use client'
import * as React from 'react'
import { Clock, Type, Eye, MessageSquare, Users } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { fmtDuration } from '../../lib/format'
import { Spinner, EmptyState } from '../detail/ui'

interface StatsPanelProps {
  minuteId: string
}

const PALETTE = ['#1f6feb', '#c3272b', '#1a7f55', '#b7791f', '#7c3aed', '#0891b2', '#db2777', '#65a30d']

export function StatsPanel({ minuteId }: StatsPanelProps): React.ReactElement {
  const stats = trpc.minute.stats.useQuery({ id: minuteId })

  if (stats.isLoading) {
    return (
      <div className="flex items-center justify-center p-12 text-mj-ink-faint">
        <Spinner className="h-5 w-5" />
      </div>
    )
  }
  if (!stats.data) return <EmptyState>暂无统计</EmptyState>

  const d = stats.data
  const speakers = [...d.speakers].sort((a, b) => b.speakingRatio - a.speakingRatio)

  return (
    <div className="space-y-6 p-4">
      <div className="grid grid-cols-2 gap-3">
        <StatCard icon={<Clock size={16} />} label="时长" value={fmtDuration(d.durationMs)} />
        <StatCard icon={<Type size={16} />} label="字数" value={d.wordCount.toLocaleString('zh-CN')} />
        <StatCard
          icon={<Eye size={16} />}
          label="访问次数"
          value={`${d.visitCount}（${d.visitorCount} 人）`}
        />
        <StatCard icon={<MessageSquare size={16} />} label="评论" value={String(d.commentCount)} />
      </div>

      <section>
        <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-mj-ink">
          <Users size={15} /> 说话人占比
        </h3>
        <div className="space-y-3">
          {speakers.map((sp, i) => {
            const pct = Math.round(sp.speakingRatio * 100)
            const color = PALETTE[i % PALETTE.length]
            return (
              <div key={sp.speakerId}>
                <div className="mb-1 flex items-baseline justify-between text-xs">
                  <span className="font-medium text-mj-ink">{sp.displayName}</span>
                  <span className="tabular-nums text-mj-ink-faint">
                    {pct}% · {fmtDuration(sp.speakingMs)} · {sp.wordCount.toLocaleString('zh-CN')} 字
                  </span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-mj-surface-2">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
                </div>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function StatCard({
  icon,
  label,
  value
}: {
  icon: React.ReactNode
  label: string
  value: string
}): React.ReactElement {
  return (
    <div className="rounded-[var(--mj-radius)] border border-mj-border bg-mj-surface p-3">
      <div className="flex items-center gap-1.5 text-xs text-mj-ink-faint">
        {icon}
        {label}
      </div>
      <div className="mt-1.5 text-base font-semibold text-mj-ink">{value}</div>
    </div>
  )
}

export default StatsPanel
