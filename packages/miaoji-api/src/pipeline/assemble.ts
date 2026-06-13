// ASR 原子句段 → 妙记句段 + 说话人统计 · 纯函数(可单测)
// 规则:相邻同说话人句段合并为「发言段」并归入同一 paragraph;统计每人发言时长/词数/占比。
import type { AsrTranscribeResponse, Word } from '@wuji/miaoji-contracts'

export interface AssembledSpeaker {
  voiceprintKey: string | null
  displayName: string
  orderIndex: number
  totalSpeakingMs: number
  segmentCount: number
  wordCount: number
  speakingRatio: number
  colorHex: string
}

export interface AssembledSegment {
  /** 指向 AssembledSpeaker.voiceprintKey · null = 未分离 */
  speakerVoiceprintKey: string | null
  startMs: number
  endMs: number
  text: string
  words: Word[]
  orderIndex: number
  paragraphId: string
}

export interface Assembled {
  speakers: AssembledSpeaker[]
  segments: AssembledSegment[]
}

// 飞书风格说话人配色
const SPEAKER_COLORS = [
  '#2B7FFF',
  '#00B96B',
  '#FF7A00',
  '#9254DE',
  '#F5222D',
  '#13C2C2',
  '#EB2F96',
  '#A0522D'
]

function countWords(text: string): number {
  // 中文按字、英文按空格词计;混合时取较大者更接近直觉
  const cjk = (text.match(/[一-鿿]/g) ?? []).length
  const latin = (text.trim().match(/[A-Za-z0-9]+/g) ?? []).length
  return cjk + latin
}

// 同说话人相邻段合并间隔。会议中同一人语句间常有 1s 上下的自然停顿;
// 800ms 太紧 → 一个人的话被切成「华。」「为小总管。陈。」这类碎段(2026-06-12 实测一会 25% 段 ≤6 字)。
// 放宽到 1.8s 把同人停顿合回整段,显著减少碎段;跨说话人不受影响(speaker 不同不合并)。
const MERGE_GAP_MS = 1800

// 三明治平滑:A 说话中间夹一个极短的「B」段(A,b,A · 两侧同人)= 几乎必是分离边界噪声
// (如「前」被误判给 B,切断 A 的「前期」)。把 b 归还 A 并三段合一。
// 实测一会 2h:528 碎段里 388 个是此模式(占全段 30%)。保守阈值防误吞真插话:
// b 时长 ≤700ms(真插话多更长)且字数 ≤6 且与两侧间隔都 ≤1000ms(连续 A 语流中)。
const SANDWICH_MAX_MS = 700
const SANDWICH_MAX_CHARS = 6
const SANDWICH_MAX_GAP_MS = 1000

function smoothSandwiches(
  merged: { speaker: string | null; startMs: number; endMs: number; text: string; words: Word[] }[]
): void {
  let i = 1
  while (i < merged.length - 1) {
    const prev = merged[i - 1]!
    const cur = merged[i]!
    const next = merged[i + 1]!
    const dur = cur.endMs - cur.startMs
    const isSandwich =
      prev.speaker !== null &&
      prev.speaker === next.speaker &&
      cur.speaker !== prev.speaker &&
      dur <= SANDWICH_MAX_MS &&
      cur.text.length <= SANDWICH_MAX_CHARS &&
      cur.startMs - prev.endMs <= SANDWICH_MAX_GAP_MS &&
      next.startMs - cur.endMs <= SANDWICH_MAX_GAP_MS
    if (isSandwich) {
      // b 归还 A,三段合一(prev 吸收 cur + next)
      prev.endMs = next.endMs
      prev.text = `${prev.text}${cur.text}${next.text}`.replace(/\s+/g, ' ').trim()
      prev.words.push(...cur.words, ...next.words)
      merged.splice(i, 2)
      // 不前进 i:合出的新 prev 可能与其后又构成三明治
    } else {
      i++
    }
  }
}

export function assembleTranscript(asr: AsrTranscribeResponse): Assembled {
  const totalDurMs = Math.max(1, Math.round(asr.durationSec * 1000))

  // 1) 合并相邻同说话人原子段
  type Merged = { speaker: string | null; startMs: number; endMs: number; text: string; words: Word[] }
  const merged: Merged[] = []
  for (const seg of asr.segments) {
    const startMs = Math.round(seg.start * 1000)
    const endMs = Math.round(seg.end * 1000)
    const last = merged[merged.length - 1]
    if (last && last.speaker === seg.speaker && startMs - last.endMs <= MERGE_GAP_MS) {
      last.endMs = endMs
      last.text = `${last.text}${seg.text.startsWith(' ') ? '' : ''}${seg.text}`.replace(/\s+/g, ' ').trim()
      last.words.push(...seg.words)
    } else {
      merged.push({ speaker: seg.speaker, startMs, endMs, text: seg.text.trim(), words: [...seg.words] })
    }
  }

  // 1.5) 三明治平滑:消除 A,短b,A 的跨说话人碎段(分离边界噪声)
  smoothSandwiches(merged)

  // 2) 收集说话人顺序(首次出现序)
  const speakerOrder: (string | null)[] = []
  for (const m of merged) {
    if (!speakerOrder.includes(m.speaker)) speakerOrder.push(m.speaker)
  }

  // 3) 统计
  const stats = new Map<string | null, { ms: number; words: number; segs: number }>()
  for (const m of merged) {
    const s = stats.get(m.speaker) ?? { ms: 0, words: 0, segs: 0 }
    s.ms += Math.max(0, m.endMs - m.startMs)
    s.words += countWords(m.text)
    s.segs += 1
    stats.set(m.speaker, s)
  }

  const speakers: AssembledSpeaker[] = speakerOrder.map((key, i) => {
    const s = stats.get(key) ?? { ms: 0, words: 0, segs: 0 }
    return {
      voiceprintKey: key,
      displayName: key === null ? '说话人' : `说话人${i + 1}`,
      orderIndex: i,
      totalSpeakingMs: s.ms,
      segmentCount: s.segs,
      wordCount: s.words,
      speakingRatio: Math.min(1, s.ms / totalDurMs),
      colorHex: SPEAKER_COLORS[i % SPEAKER_COLORS.length]!
    }
  })

  // 4) 段落:每次切换说话人开启新 paragraph
  const segments: AssembledSegment[] = []
  let paragraphCounter = 0
  let prevSpeaker: string | null | undefined = undefined
  merged.forEach((m, i) => {
    if (m.speaker !== prevSpeaker) {
      paragraphCounter += 1
      prevSpeaker = m.speaker
    }
    segments.push({
      speakerVoiceprintKey: m.speaker,
      startMs: m.startMs,
      endMs: m.endMs,
      text: m.text,
      words: m.words,
      orderIndex: i,
      paragraphId: `p${paragraphCounter}`
    })
  })

  return { speakers, segments }
}
