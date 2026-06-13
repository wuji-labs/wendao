import { describe, it, expect } from 'vitest'
import { renderExport, type ExportSegment } from './export-render.js'

const segs: ExportSegment[] = [
  { startMs: 0, endMs: 2000, speaker: '说话人1', text: '你好' },
  { startMs: 3000, endMs: 5000, speaker: '说话人2', text: '世界' }
]

describe('renderExport', () => {
  it('SRT 含序号与时间码', () => {
    const r = renderExport('SRT', segs, { title: 't', includeSpeaker: true, includeTimestamp: true })
    expect(r.ext).toBe('srt')
    expect(r.content).toContain('00:00:00,000 --> 00:00:02,000')
    expect(r.content).toContain('说话人1: 你好')
    expect(r.content.startsWith('1\n')).toBe(true)
  })

  it('TXT 可关闭说话人与时间戳', () => {
    const r = renderExport('TXT', segs, { title: 'T', includeSpeaker: false, includeTimestamp: false })
    expect(r.content).toContain('你好')
    expect(r.content).not.toContain('说话人1:')
    expect(r.content).not.toContain('[00:00]')
  })

  it('MD 带标题与加粗说话人', () => {
    const r = renderExport('MD', segs, { title: '会议', includeSpeaker: true, includeTimestamp: true })
    expect(r.content).toContain('# 会议')
    expect(r.content).toContain('**说话人1**')
  })

  it('DOCX 产出 Word 可读 HTML 且转义', () => {
    const r = renderExport('DOCX', [{ startMs: 0, endMs: 1, speaker: null, text: 'a<b>' }], {
      title: 'x',
      includeSpeaker: true,
      includeTimestamp: false
    })
    expect(r.ext).toBe('doc')
    expect(r.mime).toBe('application/msword')
    expect(r.content).toContain('a&lt;b&gt;')
  })
})
