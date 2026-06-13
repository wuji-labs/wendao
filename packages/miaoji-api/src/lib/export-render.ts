// 导出渲染 · TXT / SRT / Markdown / DOCX(HTML-doc · 无额外依赖,Word 可直接打开)
import type { ExportFormat } from '@wuji/miaoji-contracts'

export interface ExportSegment {
  startMs: number
  endMs: number
  speaker: string | null
  text: string
}

function fmtClock(ms: number, srt = false): string {
  const totalMs = Math.max(0, Math.floor(ms))
  const h = Math.floor(totalMs / 3600000)
  const m = Math.floor((totalMs % 3600000) / 60000)
  const s = Math.floor((totalMs % 60000) / 1000)
  const msec = totalMs % 1000
  if (srt) {
    return `${pad(h)}:${pad(m)}:${pad(s)},${String(msec).padStart(3, '0')}`
  }
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}
const pad = (n: number) => String(n).padStart(2, '0')

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export interface RenderOpts {
  title: string
  includeSpeaker: boolean
  includeTimestamp: boolean
}

export function renderExport(
  format: ExportFormat,
  segs: ExportSegment[],
  opts: RenderOpts
): { content: string; mime: string; ext: string } {
  switch (format) {
    case 'SRT': {
      const content = segs
        .map((s, i) => {
          const head = `${fmtClock(s.startMs, true)} --> ${fmtClock(s.endMs, true)}`
          const speaker = opts.includeSpeaker && s.speaker ? `${s.speaker}: ` : ''
          return `${i + 1}\n${head}\n${speaker}${s.text}\n`
        })
        .join('\n')
      return { content, mime: 'application/x-subrip', ext: 'srt' }
    }
    case 'TXT': {
      const content = segs
        .map(s => {
          const ts = opts.includeTimestamp ? `[${fmtClock(s.startMs)}] ` : ''
          const sp = opts.includeSpeaker && s.speaker ? `${s.speaker}: ` : ''
          return `${ts}${sp}${s.text}`
        })
        .join('\n')
      return { content: `${opts.title}\n\n${content}`, mime: 'text/plain', ext: 'txt' }
    }
    case 'MD': {
      const lines = segs.map(s => {
        const ts = opts.includeTimestamp ? `\`${fmtClock(s.startMs)}\` ` : ''
        const sp = opts.includeSpeaker && s.speaker ? `**${s.speaker}**: ` : ''
        return `${ts}${sp}${s.text}`
      })
      return { content: `# ${opts.title}\n\n${lines.join('\n\n')}\n`, mime: 'text/markdown', ext: 'md' }
    }
    case 'DOCX': {
      // Word 可直接打开的 HTML-doc(免引入 docx 库)
      const body = segs
        .map(s => {
          const ts = opts.includeTimestamp ? `<span style="color:#888">[${fmtClock(s.startMs)}]</span> ` : ''
          const sp = opts.includeSpeaker && s.speaker ? `<b>${escapeHtml(s.speaker)}：</b>` : ''
          return `<p>${ts}${sp}${escapeHtml(s.text)}</p>`
        })
        .join('\n')
      const content = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${escapeHtml(
        opts.title
      )}</title></head><body><h1>${escapeHtml(opts.title)}</h1>\n${body}</body></html>`
      return { content, mime: 'application/msword', ext: 'doc' }
    }
  }
}
