'use client'
import { miaojiConfig } from '../lib/config'
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { UploadCloud, FileAudio, FileVideo, X } from 'lucide-react'
import { toast } from 'sonner'
import clsx from 'clsx'
import { Lang } from '@wuji/miaoji-contracts'
import { trpc } from '../lib/trpc'
import { uploadMedia } from '../lib/upload'
import { Dialog } from './ui/dialog'
import { Button } from './ui/button'
import { Input, Select } from './ui/input'

const LANG_LABEL: Record<(typeof Lang.options)[number], string> = {
  zh: '中文',
  en: 'English',
  ja: '日本語'
}

export function UploadDialog({
  open,
  onClose,
  folderId
}: {
  open: boolean
  onClose: () => void
  folderId: string | null
}) {
  const router = useRouter()
  const utils = trpc.useUtils()
  const createMut = trpc.minute.create.useMutation()

  const [file, setFile] = React.useState<File | null>(null)
  const [lang, setLang] = React.useState<(typeof Lang.options)[number]>('zh')
  const [speakers, setSpeakers] = React.useState<string>('') // '' = 自动检测
  const [title, setTitle] = React.useState('')
  const [dragging, setDragging] = React.useState(false)
  const [progress, setProgress] = React.useState<number | null>(null)
  const [busy, setBusy] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const reset = () => {
    setFile(null)
    setLang('zh')
    setSpeakers('')
    setTitle('')
    setProgress(null)
    setBusy(false)
    setDragging(false)
  }

  const close = () => {
    if (busy) return
    reset()
    onClose()
  }

  const pickFile = (f: File | null | undefined) => {
    if (!f) return
    if (!f.type.startsWith('audio/') && !f.type.startsWith('video/')) {
      toast.error('请选择音频或视频文件')
      return
    }
    setFile(f)
    // 标题预填录音文件名(去扩展名),可改;留空时服务端同样兜底
    setTitle(prev => (prev.trim() ? prev : f.name.replace(/\.[^.]+$/, '')))
  }

  const start = async () => {
    if (!file || busy) return
    setBusy(true)
    setProgress(0)
    try {
      const up = await uploadMedia(file, pct => setProgress(pct))
      setProgress(100)
      const created = await createMut.mutateAsync({
        source: 'UPLOAD',
        mediaType: up.mediaType,
        language: lang,
        mediaKey: up.mediaKey,
        folderId: folderId ?? undefined,
        title: title.trim() || undefined,
        numSpeakers: speakers ? Number(speakers) : null
      })
      await utils.minute.list.invalidate()
      toast.success('已开始处理')
      reset()
      onClose()
      router.push(`${miaojiConfig.routeBase}/m/${created.token}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '上传失败')
      setBusy(false)
      setProgress(null)
    }
  }

  const isVideo = file?.type.startsWith('video/')

  return (
    <Dialog open={open} onClose={close} title="上传闻道">
      <div className="flex flex-col gap-4">
        {!file ? (
          <label
            onDragOver={e => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => {
              e.preventDefault()
              setDragging(false)
              pickFile(e.dataTransfer.files?.[0])
            }}
            className={clsx(
              'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-[calc(var(--mj-radius)+2px)] border-2 border-dashed px-6 py-12 text-center transition',
              dragging
                ? 'border-mj-primary bg-mj-primary-soft'
                : 'border-mj-border-strong hover:border-mj-primary hover:bg-mj-surface-2'
            )}
          >
            <UploadCloud className="h-10 w-10 text-mj-ink-faint" />
            <div>
              <p className="text-sm font-medium text-mj-ink">拖拽音视频文件到此处，或点击选择</p>
              <p className="mt-1 text-xs text-mj-ink-faint">支持常见音频 / 视频格式</p>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept="audio/*,video/*"
              className="hidden"
              onChange={e => pickFile(e.target.files?.[0])}
            />
          </label>
        ) : (
          <div className="flex items-center gap-3 rounded-[var(--mj-radius)] border border-mj-border bg-mj-surface-2 px-4 py-3">
            {isVideo ? (
              <FileVideo className="h-6 w-6 shrink-0 text-mj-primary" />
            ) : (
              <FileAudio className="h-6 w-6 shrink-0 text-mj-primary" />
            )}
            <span className="flex-1 truncate text-sm text-mj-ink">{file.name}</span>
            {!busy && (
              <button
                type="button"
                aria-label="移除文件"
                onClick={() => setFile(null)}
                className="rounded p-1 text-mj-ink-faint transition hover:bg-mj-surface hover:text-mj-ink"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        )}

        {/* 进度条 */}
        {progress !== null && (
          <div className="flex flex-col gap-1">
            <div className="h-2 w-full overflow-hidden rounded-full bg-mj-surface-2">
              <div
                className="h-full rounded-full bg-mj-primary transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-right text-xs text-mj-ink-faint">
              {progress < 100 ? `上传中 ${progress}%` : '正在创建闻道…'}
            </span>
          </div>
        )}

        {/* 选项 */}
        {file && (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-mj-ink">语言</span>
              <Select
                value={lang}
                disabled={busy}
                onChange={e => setLang(e.target.value as (typeof Lang.options)[number])}
              >
                {Lang.options.map(l => (
                  <option key={l} value={l}>
                    {LANG_LABEL[l]}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-mj-ink">说话人数</span>
              <Select value={speakers} disabled={busy} onChange={e => setSpeakers(e.target.value)}>
                <option value="">自动检测</option>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                  <option key={n} value={n}>
                    {n} 人
                  </option>
                ))}
              </Select>
              <span className="text-xs text-mj-ink-faint">
                多人会议建议填人数:自动检测在多人(≥5)会议常偏少(把几个人并成一个)。不确定就估一个,比自动准。
              </span>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-mj-ink">标题（可选）</span>
              <Input
                value={title}
                disabled={busy}
                onChange={e => setTitle(e.target.value)}
                placeholder="默认使用文件名"
              />
            </label>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={close} disabled={busy}>
            取消
          </Button>
          <Button variant="primary" onClick={start} disabled={!file || busy}>
            开始
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
