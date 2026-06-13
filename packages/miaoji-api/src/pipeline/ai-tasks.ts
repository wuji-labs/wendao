// AI 智能纪要生成 · 总结 / 要点 / 章节 / 待办 / 翻译 / 与妙记对话
// 用本机 Ollama(qwen3)。所有产出均带「原文溯源」:模型引用行号,调用方映射回 segmentId。
import { chat, chatJson } from '../lib/llm.js'
import type { Lang } from '@wuji/miaoji-contracts'

/** 喂给模型的转写行 · lineNo 从 1 起 */
export interface TranscriptLine {
  lineNo: number
  speaker: string
  startMs: number
  text: string
}

function renderTranscript(lines: TranscriptLine[]): string {
  return lines.map(l => `[${l.lineNo}] (${fmtTime(l.startMs)} ${l.speaker}) ${l.text}`).join('\n')
}

function fmtTime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

/** 转写过长时截断到约 N 行(对超长会议做均匀采样,保住首尾) */
function clampLines(lines: TranscriptLine[], max = 600): TranscriptLine[] {
  if (lines.length <= max) return lines
  const head = lines.slice(0, Math.floor(max * 0.6))
  const tail = lines.slice(lines.length - Math.floor(max * 0.4))
  return [...head, ...tail]
}

/**
 * 把转写切成连续窗口(map-reduce 的 map 输入)。
 * 长会议一次性塞 600-800 行给本机 qwen3 会超 240s 超时 → 返回空(纪要按钮「点了没反应」的根因)。
 * 改为每窗口 ≤size 行各自摘要(每次小而快),再合并。纯函数,可单测。
 */
export function chunkLines(lines: TranscriptLine[], size: number): TranscriptLine[][] {
  if (size <= 0) throw new Error('chunk size must be > 0')
  if (lines.length === 0) return []
  const out: TranscriptLine[][] = []
  for (let i = 0; i < lines.length; i += size) {
    out.push(lines.slice(i, i + size))
  }
  return out
}

/** 长会议判定阈值:超过即走 map-reduce(单窗口大小留足模型在超时内跑完的余量) */
const MAPREDUCE_THRESHOLD = 220
const WINDOW_SIZE = 180

/**
 * 把模型本应输出纯文本、却裹成 JSON(如 {"summary":"..."} / {"overview":"..."})的情况拆出正文。
 * qwen3 偶尔无视「输出纯文本」指令裹 JSON;不拆则整段 JSON 串当概述存进库。纯函数,可单测。
 */
export function unwrapText(raw: string): string {
  const s = raw.trim()
  if (!s.startsWith('{')) return s
  try {
    const o = JSON.parse(s) as Record<string, unknown>
    for (const k of ['summary', 'overview', 'text', 'content', 'result']) {
      if (typeof o[k] === 'string') return (o[k] as string).trim()
    }
    const firstStr = Object.values(o).find(v => typeof v === 'string')
    if (typeof firstStr === 'string') return firstStr.trim()
  } catch {
    // 非合法 JSON → 原样返回
  }
  return s
}

/* ───────── 总结 + 要点 + 风险 ───────── */

export interface SummaryResult {
  overview: string
  keyPoints: { text: string; sourceLineNo: number | null }[]
  risks: string[]
}

const SUMMARY_SYS = '你是会议纪要助手。根据带行号的转写,输出 JSON。语言与转写一致。不要编造转写里没有的内容。'

/** 单窗口/短会议:一次成结构化纪要 */
async function summarizeOnce(lines: TranscriptLine[]): Promise<SummaryResult> {
  const transcript = renderTranscript(lines)
  const user = `转写(每行格式 [行号] (时间 说话人) 内容):
${transcript}

请输出严格 JSON,字段:
{
  "overview": "200字以内的整体会议概述",
  "keyPoints": [{"text":"要点", "sourceLineNo": 引用的行号或null}],
  "risks": ["识别到的风险/待澄清点(没有则空数组)"]
}
只输出 JSON。`
  try {
    const r = await chatJson<SummaryResult>([
      { role: 'system', content: SUMMARY_SYS },
      { role: 'user', content: user }
    ])
    return {
      overview: String(r.overview ?? ''),
      keyPoints: Array.isArray(r.keyPoints)
        ? r.keyPoints.map(k => ({ text: String(k.text ?? ''), sourceLineNo: numOrNull(k.sourceLineNo) }))
        : [],
      risks: Array.isArray(r.risks) ? r.risks.map(String) : []
    }
  } catch {
    const text = await chat([
      { role: 'system', content: SUMMARY_SYS },
      { role: 'user', content: `用200字概述这段会议:\n${transcript}` }
    ])
    return { overview: text, keyPoints: [], risks: [] }
  }
}

export async function generateSummary(lines: TranscriptLine[]): Promise<SummaryResult> {
  // 短会议直接一次成;长会议 map-reduce(每窗口小而快,避开 240s 超时返回空)
  if (lines.length <= MAPREDUCE_THRESHOLD) return summarizeOnce(lines)

  const windows = chunkLines(lines, WINDOW_SIZE)
  // map:每窗口各自摘要(真实行号保留在窗口内)
  const partials = await Promise.all(windows.map(w => summarizeOnce(w)))
  const allKeyPoints = partials.flatMap(p => p.keyPoints)
  const allRisks = [...new Set(partials.flatMap(p => p.risks).filter(Boolean))]
  const partialOverviews = partials.map((p, i) => `[第${i + 1}段] ${p.overview}`).join('\n')

  // reduce:把各段概述合并成整体概述(输入很短,必不超时)
  let overview = partialOverviews
  try {
    const raw = await chat([
      { role: 'system', content: SUMMARY_SYS },
      {
        role: 'user',
        content: `以下是一场会议按时间顺序分段的概述,请合并成一段 250 字以内、连贯的整体会议概述,不要分段编号,不要编造:\n${partialOverviews}`
      }
    ])
    overview = unwrapText(raw)
  } catch {
    // reduce 失败则退回拼接版,不致空白
  }
  return {
    overview: overview.trim(),
    // 要点取各段前若干条,封顶避免长会议要点爆炸
    keyPoints: allKeyPoints.slice(0, 20),
    risks: allRisks.slice(0, 12)
  }
}

/* ───────── 章节 ───────── */

export interface ChapterResult {
  title: string
  startLineNo: number
  endLineNo: number
  summary: string
}

const CHAPTERS_SYS = '你按主题把会议切成连续章节。章节必须覆盖且不重叠,用行号界定。输出 JSON 数组。'

async function chaptersOnce(lines: TranscriptLine[], min: number, max: number): Promise<ChapterResult[]> {
  const transcript = renderTranscript(lines)
  const user = `转写:
${transcript}

输出严格 JSON 数组,每项:
{"title":"章节标题","startLineNo":起始行号,"endLineNo":结束行号,"summary":"本章一句话小结"}
章节数量 ${min}-${max} 个,按时间顺序。只输出 JSON 数组。`
  try {
    const r = await chatJson<ChapterResult[]>([
      { role: 'system', content: CHAPTERS_SYS },
      { role: 'user', content: user }
    ])
    if (!Array.isArray(r)) return []
    return r
      .map(c => ({
        title: String(c.title ?? '未命名章节'),
        startLineNo: Number(c.startLineNo ?? 1),
        endLineNo: Number(c.endLineNo ?? 1),
        summary: String(c.summary ?? '')
      }))
      .filter(c => Number.isFinite(c.startLineNo))
  } catch {
    return []
  }
}

export async function generateChapters(lines: TranscriptLine[]): Promise<ChapterResult[]> {
  if (lines.length <= MAPREDUCE_THRESHOLD) return chaptersOnce(lines, 3, 12)
  // 长会议:每窗口各切 1-4 章(窗口内真实行号),拼接后按起始行号排序
  const windows = chunkLines(lines, WINDOW_SIZE)
  const perWindow = await Promise.all(windows.map(w => chaptersOnce(w, 1, 4)))
  return perWindow.flat().sort((a, b) => a.startLineNo - b.startLineNo)
}

/* ───────── 待办 ───────── */

export interface TodoResult {
  text: string
  owner: string | null
  sourceLineNo: number | null
}

const TODOS_SYS = '你从会议转写中抽取明确的待办行动项。没有明确行动项就返回空数组。输出 JSON 数组。'

async function todosOnce(lines: TranscriptLine[]): Promise<TodoResult[]> {
  const transcript = renderTranscript(lines)
  const user = `转写:
${transcript}

输出严格 JSON 数组,每项:
{"text":"待办内容","owner":"责任人姓名或null","sourceLineNo":引用行号或null}
只抽取真实存在的行动项,不要编造。只输出 JSON 数组。`
  try {
    const r = await chatJson<TodoResult[]>([
      { role: 'system', content: TODOS_SYS },
      { role: 'user', content: user }
    ])
    if (!Array.isArray(r)) return []
    return r.map(t => ({
      text: String(t.text ?? ''),
      owner: t.owner ? String(t.owner) : null,
      sourceLineNo: numOrNull(t.sourceLineNo)
    }))
  } catch {
    return []
  }
}

export async function generateTodos(lines: TranscriptLine[]): Promise<TodoResult[]> {
  if (lines.length <= MAPREDUCE_THRESHOLD) return todosOnce(lines)
  // 长会议:逐窗口抽取后拼接,按引用行号排序(null 行号沉底)
  const windows = chunkLines(lines, WINDOW_SIZE)
  const perWindow = await Promise.all(windows.map(w => todosOnce(w)))
  return perWindow.flat().sort((a, b) => (a.sourceLineNo ?? Infinity) - (b.sourceLineNo ?? Infinity))
}

/* ───────── 翻译 ───────── */

export async function translateTexts(texts: string[], target: Lang): Promise<string[]> {
  if (texts.length === 0) return []
  const targetName = target === 'zh' ? '简体中文' : target === 'en' ? 'English' : '日本語'
  const sys = `You are a translator. Translate each numbered line into ${targetName}. Keep the SAME numbering. Output one line per input as "N. translation". No commentary.`
  const numbered = texts.map((t, i) => `${i + 1}. ${t}`).join('\n')
  const out = await chat([
    { role: 'system', content: sys },
    { role: 'user', content: numbered }
  ])
  // 解析回每行
  const map = new Map<number, string>()
  for (const line of out.split('\n')) {
    const m = line.match(/^\s*(\d+)[.)、]\s*(.*)$/)
    if (m) map.set(Number(m[1]), (m[2] ?? '').trim())
  }
  return texts.map((_, i) => map.get(i + 1) ?? '')
}

/* ───────── 与妙记对话 ───────── */

export interface AnswerResult {
  answer: string
  citationLineNos: number[]
}

export async function answerQuestion(
  lines: TranscriptLine[],
  history: { role: 'user' | 'assistant'; content: string }[],
  question: string
): Promise<AnswerResult> {
  const transcript = renderTranscript(clampLines(lines, 700))
  const sys = `你基于会议转写回答问题。只用转写中的信息,引用支持答案的行号。
输出严格 JSON: {"answer":"回答", "citationLineNos":[行号...]}。转写没提到就说不确定,citationLineNos 留空。`
  const user = `转写:
${transcript}

历史对话:
${history.map(h => `${h.role}: ${h.content}`).join('\n') || '(无)'}

问题: ${question}
只输出 JSON。`
  try {
    const r = await chatJson<AnswerResult>([
      { role: 'system', content: sys },
      { role: 'user', content: user }
    ])
    return {
      answer: String(r.answer ?? ''),
      citationLineNos: Array.isArray(r.citationLineNos)
        ? r.citationLineNos.map(Number).filter(Number.isFinite)
        : []
    }
  } catch {
    const text = await chat([
      { role: 'system', content: sys },
      { role: 'user', content: user }
    ])
    return { answer: text, citationLineNos: [] }
  }
}

/* ───────── 标题 ───────── */

export async function generateTitle(lines: TranscriptLine[]): Promise<string> {
  const transcript = renderTranscript(clampLines(lines, 80))
  const text = await chat(
    [
      { role: 'system', content: '给会议起一个不超过20字的简洁标题,只输出标题本身,不要引号。' },
      { role: 'user', content: transcript }
    ],
    { temperature: 0.4, maxTokens: 64 }
  )
  return (text.split('\n')[0] ?? '')
    .replace(/^["「『]|["」』]$/g, '')
    .slice(0, 40)
    .trim()
}

function numOrNull(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
