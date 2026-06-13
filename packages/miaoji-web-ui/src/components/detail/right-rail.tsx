'use client'
import * as React from 'react'
import { Tabs } from './ui'
import { SummaryPanel, type SummaryData } from '../panels/summary-panel'
import { ChaptersPanel, type ChapterData } from '../panels/chapters-panel'
import { TodosPanel, type TodoData } from '../panels/todos-panel'
import { QaPanel } from '../panels/qa-panel'
import { StatsPanel } from '../panels/stats-panel'

type RailTab = 'summary' | 'chapters' | 'todos' | 'qa' | 'stats'

interface RightRailProps {
  minuteId: string
  canEdit: boolean
  summary: SummaryData | null
  chapters: ChapterData[]
  todos: TodoData[]
  segStartById: Map<string, number>
}

export function RightRail({
  minuteId,
  canEdit,
  summary,
  chapters,
  todos,
  segStartById
}: RightRailProps): React.ReactElement {
  const [tab, setTab] = React.useState<RailTab>('summary')

  return (
    <div className="flex h-full min-h-0 flex-col rounded-[var(--mj-radius)] border border-mj-border bg-mj-surface">
      <Tabs
        className="px-2"
        value={tab}
        onChange={k => setTab(k as RailTab)}
        items={[
          { key: 'summary', label: '智能纪要' },
          { key: 'chapters', label: '章节' },
          { key: 'todos', label: '待办' },
          { key: 'qa', label: '对话' },
          { key: 'stats', label: '统计' }
        ]}
      />
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'summary' && (
          <SummaryPanel minuteId={minuteId} canEdit={canEdit} summary={summary} segStartById={segStartById} />
        )}
        {tab === 'chapters' && <ChaptersPanel minuteId={minuteId} canEdit={canEdit} chapters={chapters} />}
        {tab === 'todos' && (
          <TodosPanel minuteId={minuteId} canEdit={canEdit} todos={todos} segStartById={segStartById} />
        )}
        {tab === 'qa' && <QaPanel minuteId={minuteId} />}
        {tab === 'stats' && <StatsPanel minuteId={minuteId} />}
      </div>
    </div>
  )
}

export default RightRail
