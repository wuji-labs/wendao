import { describe, expect, it } from 'vitest'

import { titleFromMediaKey } from './title.js'

describe('titleFromMediaKey', () => {
  it('uploads/<uuid>/<文件名.ext> → 文件名(去扩展名)', () => {
    expect(
      titleFromMediaKey('uploads/ed7e7291-7d66-4280-8b99-9df7c4e1d76c/20260609_132138_三楼茶室.wav')
    ).toBe('20260609_132138_三楼茶室')
  })

  it('多个点只去最后一段扩展名', () => {
    expect(titleFromMediaKey('uploads/x/产品周会.v2.final.mp4')).toBe('产品周会.v2.final')
  })

  it('无扩展名原样返回', () => {
    expect(titleFromMediaKey('uploads/x/录音')).toBe('录音')
  })

  it('空/畸形 key 返回空串(调用方保持原空标题)', () => {
    expect(titleFromMediaKey('')).toBe('')
    expect(titleFromMediaKey('uploads/x/')).toBe('')
  })
})
