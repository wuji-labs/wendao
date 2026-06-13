// 声纹比对 · 多样本抗噪(v2)· 余弦相似度(向量 L2 归一化后点积)
//
// 设计依据(主流大厂 + SOTA 调研 2024-2026):
//  - 嵌入模型(CAM++)是冻结的预训练特征器,「录入」=存向量,不做按人训练。
//  - 抗噪关键 = 多向量录入 + 最大相似度匹配(Sub-center ArcFace 部署期等价):
//    每个身份存中心向量 + ≤K 条高质量原始样本,匹配取 max(余弦到中心, 各样本余弦)——
//    一条坏样本不污染整体,胜过单一均值中心。
//  - L2 长度归一化是近乎免费的增益,统一阈值口径。

const SAMPLE_CAP = Number(process.env.MIAOJI_VOICEPRINT_SAMPLE_CAP ?? 5)

export interface VpSample {
  emb: number[]
  model: string // 声纹模型 id · 跨模型不可比,匹配只比同模型
  speechSec: number
  snrDb: number
  source: 'recording' | 'meeting'
  at: string
}

/** L2 归一化(零向量原样返回)。 */
export function l2norm(v: number[]): number[] {
  let n = 0
  for (const x of v) n += x * x
  n = Math.sqrt(n)
  if (n === 0) return v.slice()
  return v.map(x => x / n)
}

export function cosine(a: number[], b: number[]): number {
  if (!a?.length || !b?.length || a.length !== b.length) return -1
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!
    const bi = b[i]!
    dot += ai * bi
    na += ai * ai
    nb += bi * bi
  }
  if (na === 0 || nb === 0) return -1
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/** 样本质量分:有效语音时长为主 · SNR 调权(用于满 K 淘汰最低者)。 */
export function sampleQuality(s: { speechSec: number; snrDb: number }): number {
  const snrW = Math.max(0.3, Math.min(2, (s.snrDb || 0) / 20))
  return Math.max(0, s.speechSec) * snrW
}

export interface Vp {
  id: string
  name: string
  embedding: number[] // 中心向量
  embeddingModel?: string // 中心向量的模型 id
  samples?: VpSample[] // 多样本(v2)· 缺省=只有中心(v1 旧数据)
}

/** 一个身份的「最大相似度」= max(余弦到中心, 各样本余弦)· 只比与 queryModel 同模型的向量(跨模型不可比)。
 *  无可比向量(全是别的模型)→ 返回 -1(不命中)。 */
function bestScoreAgainst(query: number[], vp: Vp, queryModel: string): number {
  let best = -1
  // 中心:仅当模型匹配(或 query/vp 模型未知时放行,兼容旧数据)
  if (!queryModel || !vp.embeddingModel || vp.embeddingModel === queryModel) {
    best = cosine(query, vp.embedding)
  }
  for (const s of vp.samples ?? []) {
    if (queryModel && s.model && s.model !== queryModel) continue // 跨模型跳过
    const sc = cosine(query, s.emb)
    if (sc > best) best = sc
  }
  return best
}

/** 在声纹库中找最相近且 ≥ threshold 的条目 · 默认 0.6。
 *  多样本:每身份取与中心+各样本的最大余弦(抗噪)·只比同模型向量。
 *  防混淆边距:最佳与第二名差距 < margin(默认 0.05)时判「分不清」→ 不自动命名
 *  (宁可留「说话人N」让人点名,不可在两个声线接近的人之间猜错)。 */
export function matchVoiceprint(
  emb: number[] | null | undefined,
  lib: Vp[],
  queryModel = '',
  threshold = Number(process.env.MIAOJI_VOICEPRINT_THRESHOLD ?? 0.6),
  margin = Number(process.env.MIAOJI_VOICEPRINT_MARGIN ?? 0.05)
): { vp: Vp; score: number } | null {
  if (!emb?.length || !lib.length) return null
  let best: Vp | null = null
  let bestScore = -1
  let second = -1
  for (const vp of lib) {
    const s = bestScoreAgainst(emb, vp, queryModel)
    if (s > bestScore) {
      second = bestScore
      bestScore = s
      best = vp
    } else if (s > second) {
      second = s
    }
  }
  if (!best || bestScore < threshold) return null
  if (second >= threshold && bestScore - second < margin) return null // 两人都过线且太接近 → 不猜
  return { vp: best, score: bestScore }
}

/** 增量平均:把新声纹并入已有中心(等权样本平均)。v1 兼容保留。 */
export function mergeEmbedding(existing: number[], existingCount: number, fresh: number[]): number[] {
  if (existing.length !== fresh.length) return existing
  const n = existingCount + 1
  return existing.map((v, i) => (v * existingCount + fresh[i]!) / n)
}

/** 把一条新样本并入多样本集:L2 归一化入列 → 满 K 淘汰最低质量 → 重算中心(归一化均值)。
 *  返回 { samples, centroid }。换模型(向量不可比)→ 只保留与新样本同模型者(旧向量永远命不中,需重录)。 */
export function addSample(
  prevSamples: VpSample[],
  fresh: {
    emb: number[]
    model: string
    speechSec: number
    snrDb: number
    source: 'recording' | 'meeting'
    at: string
  },
  cap = SAMPLE_CAP
): { samples: VpSample[]; centroid: number[] } {
  const dim = fresh.emb.length
  // 同模型且同维才并入(跨模型向量不可比,即便同维)
  const compatible = (prevSamples ?? []).filter(
    s => s.emb.length === dim && (!s.model || s.model === fresh.model)
  )
  const next: VpSample[] = [...compatible, { ...fresh, emb: l2norm(fresh.emb) }]
  // 满 K:按质量降序保留前 K
  next.sort((a, b) => sampleQuality(b) - sampleQuality(a))
  const kept = next.slice(0, cap)
  // 中心 = 各样本归一化均值,再归一化
  const mean = new Array<number>(dim).fill(0)
  for (const s of kept) for (let i = 0; i < dim; i++) mean[i]! += s.emb[i]!
  for (let i = 0; i < dim; i++) mean[i]! /= kept.length
  return { samples: kept, centroid: l2norm(mean) }
}
