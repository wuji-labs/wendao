'use client'
import { miaojiConfig } from '../lib/config'
import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@wuji/miaoji-api/router'
import { Mic, Video, MoreHorizontal, Pencil, FolderInput, Trash2, Eye, MessageSquare } from 'lucide-react'
import { toast } from 'sonner'
import clsx from 'clsx'
import { trpc } from '../lib/trpc'
import { fmtDuration, fmtDate, mediaUrl } from '../lib/format'
import { StatusBadge } from './status-badge'
import { Dropdown, DropdownItem } from './ui/dropdown'
import { Dialog } from './ui/dialog'
import { Input, Select } from './ui/input'
import { Button } from './ui/button'

type MinuteRow = inferRouterOutputs<AppRouter>['minute']['list'][number]
type FolderRow = inferRouterOutputs<AppRouter>['folder']['list'][number]

const ACTIVE = new Set(['READY', 'FAILED'])

export function MinuteCard({ minute, folders }: { minute: MinuteRow; folders: FolderRow[] }) {
  const router = useRouter()
  const utils = trpc.useUtils()

  const processing = !ACTIVE.has(minute.status)

  // 处理中时轮询 status，实时更新卡片
  const statusQuery = trpc.minute.status.useQuery(
    { id: minute.id },
    {
      enabled: processing,
      refetchInterval: q => {
        const s = q.state.data?.status
        return s && ACTIVE.has(s) ? false : 2000
      }
    }
  )
  const liveStatus = statusQuery.data?.status ?? minute.status
  const liveDuration = statusQuery.data?.durationMs ?? minute.durationMs
  const isProcessing = !ACTIVE.has(liveStatus)

  // status 落定后刷新列表，拿封面 / 完整数据
  const prevProcessing = React.useRef(processing)
  React.useEffect(() => {
    if (prevProcessing.current && !isProcessing) void utils.minute.list.invalidate()
    prevProcessing.current = isProcessing
  }, [isProcessing, utils])

  const [renaming, setRenaming] = React.useState(false)
  const [moving, setMoving] = React.useState(false)
  const [confirmDel, setConfirmDel] = React.useState(false)
  const [titleDraft, setTitleDraft] = React.useState(minute.title || '')

  const renameMut = trpc.minute.rename.useMutation({
    onSuccess: () => {
      void utils.minute.list.invalidate()
      setRenaming(false)
      toast.success('已重命名')
    },
    onError: e => toast.error(e.message)
  })
  const moveMut = trpc.minute.move.useMutation({
    onSuccess: () => {
      void utils.minute.list.invalidate()
      setMoving(false)
      toast.success('已移动')
    },
    onError: e => toast.error(e.message)
  })
  const removeMut = trpc.minute.remove.useMutation({
    onSuccess: () => {
      void utils.minute.list.invalidate()
      setConfirmDel(false)
      toast.success('已删除')
    },
    onError: e => toast.error(e.message)
  })

  const open = () => router.push(`${miaojiConfig.routeBase}/m/${minute.token}`)
  const title = minute.title || '未命名闻道'

  return (
    <>
      <article
        onClick={open}
        className="group flex cursor-pointer flex-col overflow-hidden rounded-[calc(var(--mj-radius)+2px)] border border-mj-border bg-mj-surface transition hover:border-mj-border-strong"
      >
        {/* 封面 */}
        <div className="relative aspect-video w-full overflow-hidden bg-mj-surface-2">
          {minute.cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mediaUrl(minute.cover)} alt={title} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-mj-ink-faint">
              {minute.mediaType === 'VIDEO' ? <Video className="h-10 w-10" /> : <Mic className="h-10 w-10" />}
            </div>
          )}
          {isProcessing && (
            <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-white/40 to-transparent" />
          )}
          {liveDuration > 0 && (
            <span className="absolute bottom-2 right-2 rounded bg-black/55 px-1.5 py-0.5 text-xs font-medium text-white">
              {fmtDuration(liveDuration)}
            </span>
          )}
        </div>

        {/* 正文 */}
        <div className="flex flex-1 flex-col gap-2 p-4">
          <div className="flex items-start justify-between gap-2">
            <h3 className="line-clamp-2 flex-1 text-base font-medium leading-snug text-mj-ink">{title}</h3>
            <div onClick={e => e.stopPropagation()}>
              <Dropdown
                trigger={
                  <span className="grid h-7 w-7 place-items-center rounded-md text-mj-ink-faint opacity-0 transition hover:bg-mj-surface-2 hover:text-mj-ink group-hover:opacity-100">
                    <MoreHorizontal className="h-4 w-4" />
                  </span>
                }
              >
                <DropdownItem
                  onClick={() => {
                    setTitleDraft(minute.title || '')
                    setRenaming(true)
                  }}
                >
                  <Pencil className="h-4 w-4" /> 重命名
                </DropdownItem>
                <DropdownItem onClick={() => setMoving(true)}>
                  <FolderInput className="h-4 w-4" /> 移动到文件夹
                </DropdownItem>
                <DropdownItem danger onClick={() => setConfirmDel(true)}>
                  <Trash2 className="h-4 w-4" /> 删除
                </DropdownItem>
              </Dropdown>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <StatusBadge status={liveStatus} />
            <span className="text-xs text-mj-ink-faint">{fmtDate(minute.createdAt)}</span>
          </div>

          <div className="mt-auto flex items-center gap-3 pt-1 text-xs text-mj-ink-faint">
            <span className="inline-flex items-center gap-1">
              <Eye className="h-3.5 w-3.5" /> {minute.visitCount}
            </span>
            <span className="inline-flex items-center gap-1">
              <MessageSquare className="h-3.5 w-3.5" /> {minute.commentCount}
            </span>
          </div>
        </div>
      </article>

      {/* 重命名 */}
      <Dialog open={renaming} onClose={() => setRenaming(false)} title="重命名闻道">
        <form
          onSubmit={e => {
            e.preventDefault()
            renameMut.mutate({ id: minute.id, title: titleDraft.trim() })
          }}
          className="flex flex-col gap-4"
        >
          <Input
            autoFocus
            value={titleDraft}
            onChange={e => setTitleDraft(e.target.value)}
            placeholder="闻道标题"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRenaming(false)}>
              取消
            </Button>
            <Button type="submit" variant="primary" disabled={renameMut.isPending}>
              保存
            </Button>
          </div>
        </form>
      </Dialog>

      {/* 移动 */}
      <Dialog open={moving} onClose={() => setMoving(false)} title="移动到文件夹">
        <div className="flex flex-col gap-4">
          <Select
            defaultValue={minute.folderId ?? ''}
            onChange={e => {
              const v = e.target.value
              moveMut.mutate({ id: minute.id, folderId: v === '' ? null : v })
            }}
            disabled={moveMut.isPending}
          >
            <option value="">全部闻道（根目录）</option>
            {folders.map(f => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </Select>
          <div className="flex justify-end">
            <Button variant="ghost" onClick={() => setMoving(false)}>
              关闭
            </Button>
          </div>
        </div>
      </Dialog>

      {/* 删除确认 */}
      <Dialog open={confirmDel} onClose={() => setConfirmDel(false)} title="删除闻道">
        <p className="text-sm text-mj-ink-soft">
          确定删除「<span className={clsx('font-medium text-mj-ink')}>{title}</span>」？此操作不可恢复。
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDel(false)}>
            取消
          </Button>
          <Button
            variant="danger"
            disabled={removeMut.isPending}
            onClick={() => removeMut.mutate({ id: minute.id })}
          >
            删除
          </Button>
        </div>
      </Dialog>
    </>
  )
}
