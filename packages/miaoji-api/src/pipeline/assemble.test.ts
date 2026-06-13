import { describe, it, expect } from 'vitest'
import { assembleTranscript } from './assemble.js'
import type { AsrTranscribeResponse } from '@wuji/miaoji-contracts'

function w(word: string, start: number, end: number) {
  return { w: word, start, end }
}

const base: AsrTranscribeResponse = {
  language: 'zh',
  speakerEmbeddings: {},
  embeddingModel: '',
  durationSec: 10,
  speakers: ['SPEAKER_00', 'SPEAKER_01'],
  segments: [
    { start: 0, end: 2, text: '你好', speaker: 'SPEAKER_00', words: [w('你好', 0, 2)] },
    { start: 2.1, end: 3.5, text: '世界', speaker: 'SPEAKER_00', words: [w('世界', 2.1, 3.5)] },
    {
      start: 5,
      end: 7,
      text: 'hello there',
      speaker: 'SPEAKER_01',
      words: [w('hello', 5, 6), w('there', 6, 7)]
    }
  ],
  engine: { asrModel: 'test', diarized: true, deviceUsed: 'cpu' }
}

describe('assembleTranscript', () => {
  it('合并相邻同说话人句段(间隔<1.8s)', () => {
    const r = assembleTranscript(base)
    // 前两段 SPEAKER_00 间隔 100ms → 合并为一段
    const sp0Segs = r.segments.filter(s => s.speakerVoiceprintKey === 'SPEAKER_00')
    expect(sp0Segs.length).toBe(1)
    expect(sp0Segs[0]!.text).toContain('你好')
    expect(sp0Segs[0]!.text).toContain('世界')
    expect(sp0Segs[0]!.endMs).toBe(3500)
  })

  it('按首次出现顺序产出说话人并命名', () => {
    const r = assembleTranscript(base)
    expect(r.speakers.length).toBe(2)
    expect(r.speakers[0]!.displayName).toBe('说话人1')
    expect(r.speakers[1]!.displayName).toBe('说话人2')
    expect(r.speakers[0]!.voiceprintKey).toBe('SPEAKER_00')
  })

  it('发言占比与词数有统计', () => {
    const r = assembleTranscript(base)
    const sp0 = r.speakers[0]!
    expect(sp0.totalSpeakingMs).toBeGreaterThan(0)
    expect(sp0.speakingRatio).toBeGreaterThan(0)
    expect(sp0.speakingRatio).toBeLessThanOrEqual(1)
    expect(sp0.wordCount).toBeGreaterThan(0)
  })

  it('切换说话人开启新段落', () => {
    const r = assembleTranscript(base)
    const paras = new Set(r.segments.map(s => s.paragraphId))
    expect(paras.size).toBe(2)
  })

  it('同人相邻段在 0.9s / 1.5s 停顿处合并(1800ms 窗口 · 治碎段),>1.8s 不合并', () => {
    // 2026-06-12 实测:DiariZen 把一个人连续的话按 turn 切成多段,段间常有 0.9-1.5s 停顿;
    // 旧 800ms 窗口合不上 → 「华。」「为小总管。陈。」碎段。1800ms 窗口把它们合回整段。
    const r = assembleTranscript({
      ...base,
      durationSec: 30,
      speakers: ['SPEAKER_00'],
      segments: [
        { start: 0, end: 2, text: '讲述', speaker: 'SPEAKER_00', words: [w('讲述', 0, 2)] },
        { start: 2.9, end: 4, text: '这些故事', speaker: 'SPEAKER_00', words: [w('这些故事', 2.9, 4)] }, // gap 900ms → 合
        { start: 5.5, end: 7, text: '你知道吗', speaker: 'SPEAKER_00', words: [w('你知道吗', 5.5, 7)] }, // gap 1500ms → 合
        { start: 9.5, end: 11, text: '另起一句', speaker: 'SPEAKER_00', words: [w('另起一句', 9.5, 11)] } // gap 2500ms → 不合
      ],
      engine: { ...base.engine, diarized: true }
    })
    expect(r.segments.length).toBe(2) // 前三段合一 + 末段独立
    expect(r.segments[0]!.text).toBe('讲述这些故事你知道吗')
    expect(r.segments[0]!.endMs).toBe(7000)
    expect(r.segments[1]!.text).toBe('另起一句')
  })

  it('三明治平滑:A,短b,A 把 b 归还 A 并三段合一(治分离边界碎段如「前」断「前期」)', () => {
    const r = assembleTranscript({
      ...base,
      durationSec: 20,
      speakers: ['SPEAKER_00', 'SPEAKER_01'],
      segments: [
        {
          start: 0,
          end: 2,
          text: '我们先把这话说一说要更多的人',
          speaker: 'SPEAKER_00',
          words: [w('我们先把这话说一说要更多的人', 0, 2)]
        },
        { start: 2.3, end: 2.7, text: '前', speaker: 'SPEAKER_01', words: [w('前', 2.3, 2.7)] }, // 短(400ms,1字)·两侧 A
        {
          start: 3.0,
          end: 5,
          text: '期还是要用你的流量来做',
          speaker: 'SPEAKER_00',
          words: [w('期还是要用你的流量来做', 3, 5)]
        }
      ],
      engine: { ...base.engine, diarized: true }
    })
    expect(r.segments.length).toBe(1) // 三段合一
    expect(r.segments[0]!.speakerVoiceprintKey).toBe('SPEAKER_00')
    expect(r.segments[0]!.text).toBe('我们先把这话说一说要更多的人前期还是要用你的流量来做')
    expect(r.speakers.length).toBe(1) // SPEAKER_01 的噪声段被吸收,不再单列说话人
  })

  it('三明治平滑不吞真插话:b 较长(>700ms)或字多(>6字)时保留', () => {
    const r = assembleTranscript({
      ...base,
      durationSec: 20,
      speakers: ['SPEAKER_00', 'SPEAKER_01'],
      segments: [
        {
          start: 0,
          end: 2,
          text: '你怎么看这个方案呢',
          speaker: 'SPEAKER_00',
          words: [w('你怎么看这个方案呢', 0, 2)]
        },
        {
          start: 2.3,
          end: 4,
          text: '我觉得这个不太行',
          speaker: 'SPEAKER_01',
          words: [w('我觉得这个不太行', 2.3, 4)]
        }, // 1.7s·8字 = 真插话
        {
          start: 4.3,
          end: 6,
          text: '那我们再讨论一下',
          speaker: 'SPEAKER_00',
          words: [w('那我们再讨论一下', 4.3, 6)]
        }
      ],
      engine: { ...base.engine, diarized: true }
    })
    expect(r.segments.length).toBe(3) // 真插话保留,不合并
    expect(r.speakers.length).toBe(2)
  })

  it('无说话人(未分离)时不崩溃', () => {
    const nodiar: AsrTranscribeResponse = {
      ...base,
      speakers: [],
      segments: base.segments.map(s => ({ ...s, speaker: null })),
      engine: { ...base.engine, diarized: false }
    }
    const r = assembleTranscript(nodiar)
    expect(r.speakers.length).toBe(1)
    expect(r.speakers[0]!.voiceprintKey).toBeNull()
    expect(r.segments.length).toBeGreaterThan(0)
  })
})
