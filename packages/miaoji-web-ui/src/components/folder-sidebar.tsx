'use client'
import * as React from 'react'
import { FolderClosed, FolderPlus, Library, Pencil, Trash2, Check, X } from 'lucide-react'
import { toast } from 'sonner'
import clsx from 'clsx'
import { trpc } from '../lib/trpc'
import { Button } from './ui/button'
import { Input } from './ui/input'

export function FolderSidebar({
  activeFolderId,
  onSelect
}: {
  activeFolderId: string | null
  onSelect: (id: string | null) => void
}) {
  const utils = trpc.useUtils()
  const foldersQuery = trpc.folder.list.useQuery(undefined)
  const folders = foldersQuery.data ?? []

  const [creating, setCreating] = React.useState(false)
  const [newName, setNewName] = React.useState('')
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [editName, setEditName] = React.useState('')

  const createMut = trpc.folder.create.useMutation({
    onSuccess: () => {
      void utils.folder.list.invalidate()
      setCreating(false)
      setNewName('')
    },
    onError: e => toast.error(e.message)
  })
  const renameMut = trpc.folder.rename.useMutation({
    onSuccess: () => {
      void utils.folder.list.invalidate()
      setEditingId(null)
    },
    onError: e => toast.error(e.message)
  })
  const removeMut = trpc.folder.remove.useMutation({
    onSuccess: () => {
      void utils.folder.list.invalidate()
      void utils.minute.list.invalidate()
      toast.success('已删除文件夹')
    },
    onError: e => toast.error(e.message)
  })

  const submitCreate = () => {
    const name = newName.trim()
    if (!name) return setCreating(false)
    createMut.mutate({ name })
  }

  const rowBase =
    'group flex items-center gap-2 rounded-[var(--mj-radius)] px-3 py-2 text-sm transition cursor-pointer'

  return (
    <aside className="flex w-60 shrink-0 flex-col gap-1 border-r border-mj-border bg-mj-surface px-3 py-5">
      <div className="mb-2 flex items-center justify-between px-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-mj-ink-faint">文件夹</span>
        <button
          type="button"
          aria-label="新建文件夹"
          onClick={() => {
            setCreating(true)
            setNewName('')
          }}
          className="rounded-md p-1 text-mj-ink-faint transition hover:bg-mj-surface-2 hover:text-mj-ink"
        >
          <FolderPlus className="h-4 w-4" />
        </button>
      </div>

      {/* 全部闻道 */}
      <div
        onClick={() => onSelect(null)}
        className={clsx(
          rowBase,
          activeFolderId === null ? 'bg-mj-primary-soft text-mj-primary' : 'text-mj-ink hover:bg-mj-surface-2'
        )}
      >
        <Library className="h-4 w-4 shrink-0" />
        <span className="truncate">全部闻道</span>
      </div>

      {/* 新建输入 */}
      {creating && (
        <div className="flex items-center gap-1 px-1 py-1">
          <Input
            autoFocus
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') submitCreate()
              if (e.key === 'Escape') setCreating(false)
            }}
            placeholder="文件夹名称"
            className="h-8 text-sm"
          />
          <button
            type="button"
            aria-label="确定"
            onClick={submitCreate}
            className="p-1 text-mj-positive hover:opacity-80"
          >
            <Check className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="取消"
            onClick={() => setCreating(false)}
            className="p-1 text-mj-ink-faint hover:opacity-80"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* 文件夹列表 */}
      {folders.map(f =>
        editingId === f.id ? (
          <div key={f.id} className="flex items-center gap-1 px-1 py-1">
            <Input
              autoFocus
              value={editName}
              onChange={e => setEditName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') renameMut.mutate({ id: f.id, name: editName.trim() })
                if (e.key === 'Escape') setEditingId(null)
              }}
              className="h-8 text-sm"
            />
            <button
              type="button"
              aria-label="确定"
              onClick={() => renameMut.mutate({ id: f.id, name: editName.trim() })}
              className="p-1 text-mj-positive hover:opacity-80"
            >
              <Check className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="取消"
              onClick={() => setEditingId(null)}
              className="p-1 text-mj-ink-faint hover:opacity-80"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div
            key={f.id}
            onClick={() => onSelect(f.id)}
            className={clsx(
              rowBase,
              activeFolderId === f.id
                ? 'bg-mj-primary-soft text-mj-primary'
                : 'text-mj-ink hover:bg-mj-surface-2'
            )}
          >
            <FolderClosed className="h-4 w-4 shrink-0" />
            <span className="flex-1 truncate">{f.name}</span>
            <span className="flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
              <button
                type="button"
                aria-label="重命名"
                onClick={e => {
                  e.stopPropagation()
                  setEditingId(f.id)
                  setEditName(f.name)
                }}
                className="rounded p-0.5 text-mj-ink-faint hover:text-mj-ink"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label="删除"
                onClick={e => {
                  e.stopPropagation()
                  if (confirm(`删除文件夹「${f.name}」？内含闻道将移回「全部闻道」。`)) {
                    if (activeFolderId === f.id) onSelect(null)
                    removeMut.mutate({ id: f.id })
                  }
                }}
                className="rounded p-0.5 text-mj-ink-faint hover:text-mj-accent"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </span>
          </div>
        )
      )}

      {!creating && folders.length === 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 justify-start text-mj-ink-faint"
          onClick={() => setCreating(true)}
        >
          <FolderPlus className="h-4 w-4" /> 新建文件夹
        </Button>
      )}
    </aside>
  )
}
