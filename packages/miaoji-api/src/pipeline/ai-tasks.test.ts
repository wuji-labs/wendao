import { describe, expect, it } from 'vitest'

import { chunkLines, unwrapText, type TranscriptLine } from './ai-tasks.js'

const mkLines = (n: number): TranscriptLine[] =>
  Array.from({ length: n }, (_, i) => ({
    lineNo: i + 1,
    speaker: 'A',
    startMs: i * 1000,
    text: `第${i + 1}句`
  }))

describe('chunkLines (map-reduce 窗口切分 · 长会议纪要不再超时返回空的根基)', () => {
  it('整除:600 行按 180 切成 4 窗口(末窗 60 行)', () => {
    const w = chunkLines(mkLines(600), 180)
    expect(w.map(x => x.length)).toEqual([180, 180, 180, 60])
  })

  it('窗口覆盖全部行且不重不漏 · 顺序保持 · 行号连续', () => {
    const lines = mkLines(500)
    const w = chunkLines(lines, 180)
    const flat = w.flat()
    expect(flat).toHaveLength(500)
    expect(flat.map(l => l.lineNo)).toEqual(lines.map(l => l.lineNo))
  })

  it('恰好整除不产生空末窗', () => {
    expect(chunkLines(mkLines(360), 180).map(x => x.length)).toEqual([180, 180])
  })

  it('少于一窗:原样单窗', () => {
    expect(chunkLines(mkLines(50), 180).map(x => x.length)).toEqual([50])
  })

  it('空输入 → 空数组(无 LLM 调用)', () => {
    expect(chunkLines([], 180)).toEqual([])
  })

  it('size<=0 抛错(防御误用导致死循环)', () => {
    expect(() => chunkLines(mkLines(10), 0)).toThrow()
    expect(() => chunkLines(mkLines(10), -5)).toThrow()
  })
})

describe('unwrapText (reduce 步模型把纯文本裹成 JSON 时拆出正文 · 实测 qwen3 真案)', () => {
  it('纯文本原样返回', () => {
    expect(unwrapText('会议讨论了预算。')).toBe('会议讨论了预算。')
  })

  it('{"summary":...} 拆出正文(2026-06-12 实测真案)', () => {
    expect(unwrapText('{\n  "summary": "会议讨论徐老师定位。"\n}')).toBe('会议讨论徐老师定位。')
  })

  it('{"overview":...} 同样拆出', () => {
    expect(unwrapText('{"overview":"整体概述"}')).toBe('整体概述')
  })

  it('未知键但有字符串值 → 取首个字符串', () => {
    expect(unwrapText('{"foo":"兜底正文"}')).toBe('兜底正文')
  })

  it('看似 JSON 实则非法 → 原样返回不抛', () => {
    expect(unwrapText('{这不是JSON')).toBe('{这不是JSON')
  })
})
