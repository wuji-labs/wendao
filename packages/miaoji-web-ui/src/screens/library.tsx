'use client'
import * as React from 'react'
import { Search, Plus, Inbox } from 'lucide-react'
import { MinuteStatus } from '@wuji/miaoji-contracts'
import { trpc } from '../lib/trpc'
import { FolderSidebar } from '../components/folder-sidebar'
import { MinuteCard } from '../components/minute-card'
import { UploadDialog } from '../components/upload-dialog'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import { Spinner } from '../components/ui/spinner'
import clsx from 'clsx'

type StatusFilter = 'ALL' | 'PROCESSING' | 'READY' | 'FAILED'

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'ALL', label: '全部' },
  { key: 'PROCESSING', label: '处理中' },
  { key: 'READY', label: '已就绪' },
  { key: 'FAILED', label: '失败' }
]

const PROCESSING_STATUSES: string[] = MinuteStatus.options.filter(s => s !== 'READY' && s !== 'FAILED')

export function MiaojiLibrary() {
  const [activeFolderId, setActiveFolderId] = React.useState<string | null>(null)
  const [rawQuery, setRawQuery] = React.useState('')
  const [query, setQuery] = React.useState('')
  const [filter, setFilter] = React.useState<StatusFilter>('ALL')
  const [uploadOpen, setUploadOpen] = React.useState(false)

  // 输入防抖
  React.useEffect(() => {
    const t = window.setTimeout(() => setQuery(rawQuery.trim()), 250)
    return () => window.clearTimeout(t)
  }, [rawQuery])

  // 服务端只支持单一 status；处理中是多态，故只下发 READY/FAILED，处理中在前端过滤
  const serverStatus = filter === 'READY' ? 'READY' : filter === 'FAILED' ? 'FAILED' : undefined

  const minutesQuery = trpc.minute.list.useQuery({
    folderId: activeFolderId,
    query: query || undefined,
    status: serverStatus,
    limit: 100,
    offset: 0
  })

  const foldersQuery = trpc.folder.list.useQuery(undefined)
  const folders = foldersQuery.data ?? []

  const minutes = React.useMemo(() => {
    const rows = minutesQuery.data ?? []
    if (filter === 'PROCESSING') return rows.filter(m => PROCESSING_STATUSES.includes(m.status))
    return rows
  }, [minutesQuery.data, filter])

  return (
    <div className="flex min-h-screen">
      <FolderSidebar activeFolderId={activeFolderId} onSelect={setActiveFolderId} />

      <main className="flex-1">
        {/* 顶部栏 */}
        <header className="sticky top-0 z-20 border-b border-mj-border bg-[color-mix(in_srgb,var(--color-mj-bg)_85%,transparent)] backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-4">
            <h1 className="text-2xl font-semibold tracking-tight text-mj-ink">闻道</h1>
            <div className="relative ml-2 max-w-md flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mj-ink-faint" />
              <Input
                value={rawQuery}
                onChange={e => setRawQuery(e.target.value)}
                placeholder="搜索闻道标题"
                className="pl-9"
              />
            </div>
            <Button variant="primary" onClick={() => setUploadOpen(true)} className="ml-auto shrink-0">
              <Plus className="h-4 w-4" /> 上传闻道
            </Button>
          </div>
        </header>

        <div className="mx-auto max-w-6xl px-6 py-8">
          {/* 状态过滤 */}
          <div className="mb-6 flex items-center gap-2">
            {FILTERS.map(f => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={clsx(
                  'rounded-full px-3.5 py-1.5 text-sm font-medium transition',
                  filter === f.key
                    ? 'bg-mj-ink text-white'
                    : 'bg-mj-surface text-mj-ink-soft hover:bg-mj-surface-2'
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* 内容 */}
          {minutesQuery.isLoading ? (
            <div className="flex items-center justify-center py-24 text-mj-ink-faint">
              <Spinner className="h-6 w-6" />
            </div>
          ) : minutesQuery.isError ? (
            <div className="py-24 text-center text-sm text-mj-accent">
              加载失败：{minutesQuery.error.message}
            </div>
          ) : minutes.length === 0 ? (
            <EmptyState onUpload={() => setUploadOpen(true)} hasQuery={!!query || filter !== 'ALL'} />
          ) : (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {minutes.map(m => (
                <MinuteCard key={m.id} minute={m} folders={folders} />
              ))}
            </div>
          )}
        </div>
      </main>

      <UploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} folderId={activeFolderId} />
    </div>
  )
}

function EmptyState({ onUpload, hasQuery }: { onUpload: () => void; hasQuery: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-full bg-mj-surface-2 text-mj-ink-faint">
        <Inbox className="h-8 w-8" />
      </div>
      {hasQuery ? (
        <p className="text-sm text-mj-ink-soft">没有匹配的闻道</p>
      ) : (
        <>
          <div>
            <p className="text-lg font-medium text-mj-ink">还没有闻道</p>
            <p className="mt-1 text-sm text-mj-ink-faint">上传一段音频或视频，自动转写并生成智能纪要</p>
          </div>
          <Button variant="primary" onClick={onUpload}>
            <Plus className="h-4 w-4" /> 上传闻道
          </Button>
        </>
      )}
    </div>
  )
}
