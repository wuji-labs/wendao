'use client'
import { miaojiConfig } from '../../lib/config'
import * as React from 'react'
import clsx from 'clsx'
import { Share2, Link as LinkIcon, Check, Scissors, Trash2, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { trpc } from '../../lib/trpc'
import { fmtClock } from '../../lib/format'
import { usePlayer } from '../../lib/player-store'
import { Btn, IconBtn, Popover, MenuItem, Spinner, Modal, TextInput } from './ui'

export type LinkScope = 'CLOSED' | 'TENANT_VIEW' | 'TENANT_EDIT' | 'ANYONE_VIEW'

const SCOPE_OPTS: { value: LinkScope; label: string; desc: string }[] = [
  { value: 'CLOSED', label: '仅自己', desc: '不对外开放' },
  { value: 'TENANT_VIEW', label: '组织可查看', desc: '同组织成员可看' },
  { value: 'TENANT_EDIT', label: '组织可编辑', desc: '同组织成员可编辑' },
  { value: 'ANYONE_VIEW', label: '任何人可查看', desc: '凭链接即可查看' }
]

interface ShareMenuProps {
  minuteId: string
  token: string
  linkScope: LinkScope
  canEdit: boolean
}

function origin(): string {
  return typeof window !== 'undefined' ? window.location.origin : ''
}

export function ShareMenu({ minuteId, token, linkScope, canEdit }: ShareMenuProps): React.ReactElement {
  const utils = trpc.useUtils()
  const setScope = trpc.minute.setLinkScope.useMutation({
    onSuccess: () => {
      void utils.minute.getByToken.invalidate()
      toast.success('已更新分享范围')
    }
  })
  const [clipOpen, setClipOpen] = React.useState(false)

  function copyLink(): void {
    const url = `${origin()}${miaojiConfig.routeBase}/m/${token}`
    void navigator.clipboard.writeText(url).then(() => toast.success('已复制链接'))
  }

  return (
    <>
      <Popover
        align="right"
        className="min-w-[18rem]"
        trigger={(open, toggle) => (
          <Btn size="sm" variant="outline" onClick={toggle} aria-expanded={open}>
            <Share2 size={15} /> 分享
          </Btn>
        )}
      >
        {close => (
          <div className="space-y-3">
            <div>
              <div className="px-1 pb-1 text-[11px] font-medium text-mj-ink-faint">链接权限</div>
              {SCOPE_OPTS.map(o => (
                <MenuItem
                  key={o.value}
                  active={o.value === linkScope}
                  onClick={() => canEdit && setScope.mutate({ id: minuteId, linkScope: o.value })}
                >
                  <span className="flex-1">
                    <span className="block">{o.label}</span>
                    <span className="block text-[11px] text-mj-ink-faint">{o.desc}</span>
                  </span>
                  {o.value === linkScope && <Check size={15} className="text-mj-primary" />}
                </MenuItem>
              ))}
            </div>
            <div className="border-t border-mj-border pt-2">
              <MenuItem
                onClick={() => {
                  copyLink()
                }}
              >
                <LinkIcon size={15} /> 复制链接
              </MenuItem>
              <MenuItem
                onClick={() => {
                  setClipOpen(true)
                  close()
                }}
              >
                <Scissors size={15} /> 管理片段
              </MenuItem>
            </div>
          </div>
        )}
      </Popover>

      <ClipModal open={clipOpen} onClose={() => setClipOpen(false)} minuteId={minuteId} canEdit={canEdit} />
    </>
  )
}

function ClipModal({
  open,
  onClose,
  minuteId,
  canEdit
}: {
  open: boolean
  onClose: () => void
  minuteId: string
  canEdit: boolean
}): React.ReactElement {
  const { currentMs, durationMs } = usePlayer()
  const utils = trpc.useUtils()
  const clips = trpc.collab.listClips.useQuery({ minuteId }, { enabled: open })
  const create = trpc.collab.createClip.useMutation({
    onSuccess: () => {
      void utils.collab.listClips.invalidate()
      void utils.minute.getByToken.invalidate()
      toast.success('已创建片段')
    }
  })
  const remove = trpc.collab.removeClip.useMutation({
    onSuccess: () => {
      void utils.collab.listClips.invalidate()
      void utils.minute.getByToken.invalidate()
    }
  })

  const [title, setTitle] = React.useState('')
  const [startMs, setStartMs] = React.useState(0)
  const [endMs, setEndMs] = React.useState(0)

  React.useEffect(() => {
    if (open) {
      setStartMs(currentMs)
      setEndMs(Math.min(durationMs, currentMs + 30000))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function copyClip(shareToken: string): void {
    const url = `${origin()}${miaojiConfig.routeBase}/clip/${shareToken}`
    void navigator.clipboard.writeText(url).then(() => toast.success('已复制片段链接'))
  }

  const list = clips.data ?? []

  return (
    <Modal open={open} onClose={onClose} title="片段">
      {canEdit && (
        <div className="mb-4 space-y-2 rounded-[var(--mj-radius)] border border-mj-border bg-mj-surface-2 p-3">
          <TextInput placeholder="片段标题（可选）" value={title} onChange={e => setTitle(e.target.value)} />
          <div className="flex items-center gap-2 text-xs text-mj-ink-soft">
            <span>起</span>
            <button
              type="button"
              onClick={() => setStartMs(currentMs)}
              className="rounded-md border border-mj-border px-2 py-1 font-mono hover:bg-mj-surface"
            >
              {fmtClock(startMs)}（取当前）
            </button>
            <span>止</span>
            <button
              type="button"
              onClick={() => setEndMs(currentMs)}
              className="rounded-md border border-mj-border px-2 py-1 font-mono hover:bg-mj-surface"
            >
              {fmtClock(endMs)}（取当前）
            </button>
          </div>
          <Btn
            size="sm"
            variant="primary"
            disabled={endMs <= startMs || create.isPending}
            onClick={() =>
              create.mutate({ minuteId, startMs, endMs, title: title.trim() || `片段 ${fmtClock(startMs)}` })
            }
          >
            {create.isPending ? <Spinner className="h-3.5 w-3.5" /> : <Scissors size={14} />} 创建片段
          </Btn>
        </div>
      )}

      <div className="max-h-72 space-y-2 overflow-auto">
        {clips.isLoading ? (
          <div className="py-6 text-center">
            <Spinner className="h-4 w-4 text-mj-ink-faint" />
          </div>
        ) : list.length === 0 ? (
          <div className="py-6 text-center text-sm text-mj-ink-faint">暂无片段</div>
        ) : (
          list.map(c => (
            <div
              key={c.id}
              className={clsx(
                'flex items-center gap-2 rounded-[var(--mj-radius)] border border-mj-border px-3 py-2'
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-mj-ink">{c.title}</div>
                <div className="font-mono text-[11px] tabular-nums text-mj-ink-faint">
                  {fmtClock(c.startMs)} – {fmtClock(c.endMs)}
                </div>
              </div>
              <IconBtn label="复制片段链接" className="h-8 w-8" onClick={() => copyClip(c.shareToken)}>
                <Copy size={15} />
              </IconBtn>
              {canEdit && (
                <IconBtn
                  label="删除片段"
                  className="h-8 w-8 text-mj-accent"
                  onClick={() => remove.mutate({ id: c.id })}
                >
                  <Trash2 size={15} />
                </IconBtn>
              )}
            </div>
          ))
        )}
      </div>
    </Modal>
  )
}

export default ShareMenu
