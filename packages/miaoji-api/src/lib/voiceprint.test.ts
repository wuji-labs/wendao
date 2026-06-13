import { describe, expect, it } from 'vitest'

import {
  addSample,
  cosine,
  l2norm,
  matchVoiceprint,
  sampleQuality,
  type Vp,
  type VpSample
} from './voiceprint.js'

// 造一个朝向 axis 的单位向量(dim=8),带少量噪声 → 模拟同一人不同场合的样本
function vec(axis: number, noise = 0, dim = 8): number[] {
  return Array.from({ length: dim }, (_, i) => (i === axis ? 1 : 0) + (i === (axis + 1) % dim ? noise : 0))
}

const M = 'eres2netv2_zh'
const mkSample = (emb: number[], speechSec = 15, snrDb = 30, model = M): VpSample => ({
  emb,
  model,
  speechSec,
  snrDb,
  source: 'recording',
  at: '2026-06-13'
})

describe('l2norm', () => {
  it('归一化到单位长度', () => {
    const n = l2norm([3, 4])
    expect(Math.hypot(n[0]!, n[1]!)).toBeCloseTo(1, 6)
    expect(n).toEqual([0.6, 0.8])
  })
  it('零向量原样返回不除零', () => {
    expect(l2norm([0, 0])).toEqual([0, 0])
  })
})

describe('addSample (多样本抗噪入列)', () => {
  it('入列后中心是归一化均值,样本被 L2 归一化', () => {
    const { samples, centroid } = addSample([], mkSample([3, 4]))
    expect(samples).toHaveLength(1)
    expect(Math.hypot(samples[0]!.emb[0]!, samples[0]!.emb[1]!)).toBeCloseTo(1, 6)
    expect(Math.hypot(centroid[0]!, centroid[1]!)).toBeCloseTo(1, 6)
  })

  it('满 K 时淘汰最低质量样本(短/吵的被挤掉)', () => {
    let samples: VpSample[] = []
    // 先放 5 条高质量(20s/40dB),再来一条更高质量 → 应淘汰一条,仍 5 条
    for (let i = 0; i < 5; i++) ({ samples } = addSample(samples, mkSample(vec(i), 20, 40)))
    expect(samples).toHaveLength(5)
    const lowQ = mkSample(vec(6), 3, 10) // 短又吵
    const r = addSample(samples, lowQ, 5)
    expect(r.samples).toHaveLength(5)
    expect(r.samples.some(s => s.speechSec === 3)).toBe(false) // 低质量没进
  })

  it('换模型(维度不同)→ 丢弃旧维样本,只留新样本', () => {
    const old = addSample([], mkSample([1, 0, 0, 0, 0, 0, 0, 0])).samples
    const r = addSample(old, mkSample([1, 0, 0])) // 3 维新模型
    expect(r.samples).toHaveLength(1)
    expect(r.samples[0]!.emb).toHaveLength(3)
  })
})

describe('sampleQuality', () => {
  it('时长越长、SNR 越高分越高', () => {
    expect(sampleQuality({ speechSec: 20, snrDb: 40 })).toBeGreaterThan(
      sampleQuality({ speechSec: 8, snrDb: 40 })
    )
    expect(sampleQuality({ speechSec: 15, snrDb: 40 })).toBeGreaterThan(
      sampleQuality({ speechSec: 15, snrDb: 5 })
    )
  })
})

describe('matchVoiceprint (多样本最大相似度 · 抗噪)', () => {
  // 同一人两种状态:样本A(axis0)、样本B(axis2)。单中心会落到两者中间,谁都不像;
  // 多样本 max-sim 能命中其中一种状态。
  const built = addSample(addSample([], mkSample(vec(0))).samples, mkSample(vec(2)))
  const vp: Vp = { id: 'p1', name: '甲', embedding: built.centroid, samples: built.samples }

  it('查询接近某一条样本 → 命中(单中心可能落空,多样本兜住)', () => {
    const q = vec(2, 0.05) // 接近样本B
    const hit = matchVoiceprint(q, [vp], M, 0.6, 0.05)
    expect(hit?.vp.id).toBe('p1')
  })

  it('一条坏样本不污染:坏样本拉低中心,但好样本仍能命中', () => {
    const dirty = addSample(built.samples, mkSample(vec(5), 12, 20)) // 加一条不同朝向的样本
    const vp2: Vp = { id: 'p2', name: '乙', embedding: dirty.centroid, samples: dirty.samples }
    const q = vec(0, 0.03) // 接近原样本A
    const hit = matchVoiceprint(q, [vp2], M, 0.6, 0.05)
    expect(hit?.vp.id).toBe('p2')
  })

  it('两个声线接近的人都过线且差距 < margin → 不猜(abstain)', () => {
    const a: Vp = { id: 'a', name: '甲', embedding: l2norm(vec(0)), samples: [mkSample(l2norm(vec(0)))] }
    const b: Vp = {
      id: 'b',
      name: '乙',
      embedding: l2norm(vec(0, 0.02)),
      samples: [mkSample(l2norm(vec(0, 0.02)))]
    }
    const q = vec(0, 0.01)
    expect(matchVoiceprint(q, [a, b], M, 0.6, 0.05)).toBeNull()
  })

  it('v1 旧数据(无 samples)仍按中心匹配,不崩', () => {
    const v1: Vp = { id: 'v1', name: '丙', embedding: l2norm(vec(3)) }
    const hit = matchVoiceprint(vec(3, 0.02), [v1], M, 0.6, 0.05)
    expect(hit?.vp.id).toBe('v1')
  })

  it('低于阈值 → 不命中', () => {
    expect(matchVoiceprint(vec(7), [vp], M, 0.6, 0.05)).toBeNull()
  })

  it('跨模型不可比:查询是新模型,库里是旧模型样本 → 不命中(防同维异模型乱配)', () => {
    const oldModel: Vp = {
      id: 'o',
      name: '旧',
      embedding: l2norm(vec(0)),
      embeddingModel: 'campplus_zh',
      samples: [mkSample(l2norm(vec(0)), 15, 30, 'campplus_zh')]
    }
    expect(matchVoiceprint(vec(0), [oldModel], 'eres2netv2_zh', 0.6, 0.05)).toBeNull() // 模型不同 → 跳过
    expect(matchVoiceprint(vec(0), [oldModel], 'campplus_zh', 0.6, 0.05)?.vp.id).toBe('o') // 同模型 → 命中
  })
})

describe('cosine', () => {
  it('正交=0,同向=1,维度不符=-1', () => {
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 6)
    expect(cosine([1, 1], [2, 2])).toBeCloseTo(1, 6)
    expect(cosine([1, 0], [1, 0, 0])).toBe(-1)
  })
})
