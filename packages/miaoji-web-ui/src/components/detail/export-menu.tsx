'use client'
import * as React from 'react'
import { Download } from 'lucide-react'
import { toast } from 'sonner'
import type { Lang } from '@wuji/miaoji-contracts'
import { trpc } from '../../lib/trpc'
import { Btn, Popover, Toggle, Spinner, MenuItem } from './ui'

type ExportFormat = 'TXT' | 'SRT' | 'DOCX' | 'MD'
const FORMATS: { value: ExportFormat; label: string }[] = [
  { value: 'TXT', label: '纯文本 TXT' },
  { value: 'SRT', label: '字幕 SRT' },
  { value: 'MD', label: 'Markdown' },
  { value: 'DOCX', label: 'Word DOCX' }
]
const LANGS: { value: Lang; label: string }[] = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: '英文' },
  { value: 'ja', label: '日文' }
]

interface ExportMenuProps {
  minuteId: string
}

function base64ToBlob(content: string, mime: string): Blob {
  // DOCX 等二进制格式后端以 base64 传回; 文本格式直接是字符串
  try {
    const bin = atob(content)
    const len = bin.length
    const bytes = new Uint8Array(len)
    for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i)
    return new Blob([bytes], { type: mime })
  } catch {
    return new Blob([content], { type: mime })
  }
}

export function ExportMenu({ minuteId }: ExportMenuProps): React.ReactElement {
  const utils = trpc.useUtils()
  const [format, setFormat] = React.useState<ExportFormat>('TXT')
  const [includeSpeaker, setIncludeSpeaker] = React.useState(true)
  const [includeTimestamp, setIncludeTimestamp] = React.useState(true)
  const [lang, setLang] = React.useState<Lang | ''>('')
  const [busy, setBusy] = React.useState(false)

  async function doExport(close: () => void): Promise<void> {
    setBusy(true)
    try {
      const res = await utils.export.minute.fetch({
        minuteId,
        format,
        includeSpeaker,
        includeTimestamp,
        ...(lang ? { lang } : {})
      })
      const isText = format === 'TXT' || format === 'SRT' || format === 'MD'
      const blob = isText ? new Blob([res.content], { type: res.mime }) : base64ToBlob(res.content, res.mime)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = res.filename || `export.${res.ext}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success('已开始下载')
      close()
    } catch {
      toast.error('导出失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Popover
      align="right"
      className="min-w-[16rem]"
      trigger={(open, toggle) => (
        <Btn size="sm" variant="outline" onClick={toggle} aria-expanded={open}>
          <Download size={15} /> 导出
        </Btn>
      )}
    >
      {close => (
        <div className="space-y-3">
          <div>
            <div className="px-1 pb-1 text-[11px] font-medium text-mj-ink-faint">格式</div>
            {FORMATS.map(f => (
              <MenuItem key={f.value} active={f.value === format} onClick={() => setFormat(f.value)}>
                {f.label}
              </MenuItem>
            ))}
          </div>

          <div className="space-y-2 border-t border-mj-border pt-2">
            <label className="flex items-center justify-between px-1 text-sm text-mj-ink">
              包含说话人
              <Toggle checked={includeSpeaker} onChange={setIncludeSpeaker} label="包含说话人" />
            </label>
            <label className="flex items-center justify-between px-1 text-sm text-mj-ink">
              包含时间戳
              <Toggle checked={includeTimestamp} onChange={setIncludeTimestamp} label="包含时间戳" />
            </label>
          </div>

          <div className="border-t border-mj-border pt-2">
            <div className="px-1 pb-1 text-[11px] font-medium text-mj-ink-faint">语言（默认原文）</div>
            <div className="flex flex-wrap gap-1.5 px-1">
              <button
                type="button"
                onClick={() => setLang('')}
                className={
                  'rounded-full border px-2.5 py-1 text-xs ' +
                  (lang === ''
                    ? 'border-mj-primary bg-mj-primary-soft text-mj-primary'
                    : 'border-mj-border text-mj-ink-soft')
                }
              >
                原文
              </button>
              {LANGS.map(l => (
                <button
                  key={l.value}
                  type="button"
                  onClick={() => setLang(l.value)}
                  className={
                    'rounded-full border px-2.5 py-1 text-xs ' +
                    (lang === l.value
                      ? 'border-mj-primary bg-mj-primary-soft text-mj-primary'
                      : 'border-mj-border text-mj-ink-soft')
                  }
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-mj-border pt-2">
            <Btn
              variant="primary"
              size="md"
              className="w-full"
              disabled={busy}
              onClick={() => void doExport(close)}
            >
              {busy ? <Spinner className="h-4 w-4" /> : <Download size={15} />} 下载
            </Btn>
          </div>
        </div>
      )}
    </Popover>
  )
}

export default ExportMenu
