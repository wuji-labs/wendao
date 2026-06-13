import { miaojiConfig } from './config'

/** 毫秒 → mm:ss / h:mm:ss */
export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

/** 毫秒时长 → 「12 分 30 秒」 */
export function fmtDuration(ms: number): string {
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h} 小时 ${m} 分`
  if (m > 0) return `${m} 分 ${s} 秒`
  return `${s} 秒`
}

export function fmtDate(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/** 媒体播放地址 · 经 next rewrites 代理到 miaoji-api /media */
export function mediaUrl(key: string | null | undefined): string {
  if (!key) return ''
  return `${miaojiConfig.mediaBase}/${key}`
}

export const STATUS_LABEL: Record<string, string> = {
  UPLOADING: '上传中',
  TRANSCODING: '转码中',
  TRANSCRIBING: '转写中',
  DIARIZING: '分离说话人',
  SEGMENTING: '整理段落',
  SUMMARIZING: '生成纪要',
  READY: '已就绪',
  FAILED: '处理失败'
}
