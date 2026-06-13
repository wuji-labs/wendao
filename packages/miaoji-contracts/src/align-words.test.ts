import { describe, expect, it } from 'vitest'

import { alignTextToWords } from './align-words'

const W = (...ws: string[]) => ws.map(w => ({ w }))

describe('alignTextToWords', () => {
  it('句末标点挂到末词,渲染文本与 seg.text 一字不差(2026-06-12 无标点真案)', () => {
    const g = alignTextToWords('他们都喊口号的。', W('他们', '都', '喊', '口号', '的'))
    expect(g).not.toBeNull()
    expect(g!.map(x => x.text).join('')).toBe('他们都喊口号的。')
    expect(g!.at(-1)!.text).toBe('的。')
    expect(g!.at(-1)!.wordIdx).toBe(4)
  })

  it('句中标点挂到前一个词', () => {
    const g = alignTextToWords('还吓人呢，这个人反正。', W('还', '吓人', '呢', '这个', '人', '反正'))!
    expect(g.map(x => x.text).join('')).toBe('还吓人呢，这个人反正。')
    const ne = g.find(x => x.text.includes('，'))!
    expect(ne.text).toBe('呢，')
    expect(ne.wordIdx).toBe(2)
  })

  it('charStart 是组首字符在 text 中的偏移', () => {
    const g = alignTextToWords('你好，世界。', W('你好', '世界'))!
    expect(g[0]).toMatchObject({ text: '你好，', charStart: 0, wordIdx: 0 })
    expect(g[1]).toMatchObject({ text: '世界。', charStart: 3, wordIdx: 1 })
  })

  it('英文词带空格与自带标点也能对齐', () => {
    const g = alignTextToWords('Hello, world.', W('Hello', 'world'))!
    expect(g.map(x => x.text).join('')).toBe('Hello, world.')
    expect(g[0]!.text).toBe('Hello, ')
    expect(g[1]!.text).toBe('world.')
  })

  it('开头标点挂到第一个词', () => {
    const g = alignTextToWords('“你好”', W('你好'))!
    expect(g).toHaveLength(1)
    expect(g[0]!.text).toBe('“你好”')
  })

  it('人工编辑后文本与词对不上 → null(调用方退回纯文本渲染)', () => {
    expect(alignTextToWords('完全重写的内容', W('他们', '都', '喊'))).toBeNull()
  })

  it('无词/空文本 → null', () => {
    expect(alignTextToWords('', W('你好'))).toBeNull()
    expect(alignTextToWords('你好', [])).toBeNull()
  })
})
