import { describe, it, expect } from 'vitest'
import { stripThinking } from './llm.js'

describe('stripThinking', () => {
  it('剥离闭合的 <think> 段', () => {
    expect(stripThinking('<think>推理过程</think>正式回答')).toBe('正式回答')
  })

  it('剥离未闭合的 <think>', () => {
    expect(stripThinking('前言<think>没闭合的思考')).toBe('前言')
  })

  it('无 think 标签原样返回(去空白)', () => {
    expect(stripThinking('  纯文本  ')).toBe('纯文本')
  })
})
