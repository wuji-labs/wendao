// LLM 客户端 · Ollama OpenAI 兼容端点(本机 5090 · qwen3)
// qwen3 是 thinking 模型,会输出 <think>…</think>,需剥离后再解析 JSON。
import OpenAI from 'openai'
import { config } from './config.js'

const client = new OpenAI({
  baseURL: config.llm.baseUrl,
  apiKey: config.llm.apiKey,
  // 单次调用上限 · 防止 Ollama 拥堵时无限挂起(纪要超时则该步降级,转写全文照常 READY)
  timeout: Number(process.env.MIAOJI_LLM_TIMEOUT_MS ?? 240_000),
  maxRetries: 0
})

/** 去掉 qwen3 的 <think> 推理段 + 代码围栏,留纯正文 */
export function stripThinking(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/i, '') // 未闭合的 think
    .trim()
}

function extractJson(raw: string): string {
  const cleaned = stripThinking(raw)
  // 去围栏
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fence?.[1] ?? cleaned
  // 截取首个 { 或 [ 到对应结尾
  const startObj = body.indexOf('{')
  const startArr = body.indexOf('[')
  const start = startArr === -1 ? startObj : startObj === -1 ? startArr : Math.min(startObj, startArr)
  if (start === -1) return body.trim()
  const open = body[start]
  const close = open === '{' ? '}' : ']'
  const end = body.lastIndexOf(close)
  return end > start ? body.slice(start, end + 1) : body.slice(start)
}

type Msg = { role: 'system' | 'user' | 'assistant'; content: string }

/** qwen3 默认思考模式会先生成大段 <think> 推理 → 慢。纪要类任务不需要,追加 /no_think 关闭,提速数倍。 */
function noThink(messages: Msg[]): Msg[] {
  if (!/qwen3/i.test(config.llm.model)) return messages
  const out = messages.map(m => ({ ...m }))
  for (let i = out.length - 1; i >= 0; i--) {
    const m = out[i]
    if (m && m.role === 'user') {
      m.content = `${m.content}\n/no_think`
      return out
    }
  }
  return out
}

export async function chat(
  messages: Msg[],
  opts: { temperature?: number; maxTokens?: number } = {}
): Promise<string> {
  const res = await client.chat.completions.create({
    model: config.llm.model,
    messages: noThink(messages),
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.maxTokens ?? 2400,
    // Ollama 扩展:可靠关闭 qwen3 思考(/no_think 软开关时灵时不灵,thinking 会吃光 token 预算致空输出)
    // @ts-expect-error 非标准 OpenAI 字段,Ollama OpenAI 兼容端点透传给模板
    chat_template_kwargs: { enable_thinking: false }
  })
  return stripThinking(res.choices[0]?.message?.content ?? '')
}

/** 让模型产出 JSON 并解析为 T;解析失败抛错(由调用方决定降级)。
 * qwen3:30b 本地小模型有方差:偶尔把 token 预算耗在推理上致 content 空(finish=length),
 * 或返回无法解析的串。故内置重试:空/截断/解析失败 → 升温+加预算重试,最多 3 次。 */
export async function chatJson<T>(
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  opts: { temperature?: number; maxTokens?: number } = {}
): Promise<T> {
  const baseTokens = opts.maxTokens ?? 5000
  let lastErr: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await client.chat.completions.create({
      model: config.llm.model,
      messages: noThink(messages),
      temperature: (opts.temperature ?? 0.2) + attempt * 0.1, // 略升温打破确定性卡死
      max_tokens: baseTokens + attempt * 1500, // 截断则下轮加预算
      // Ollama 扩展:可靠关闭 qwen3 思考(否则 thinking 吃光 token 预算,JSON 任务返回空)
      // @ts-expect-error 非标准 OpenAI 字段,Ollama OpenAI 兼容端点透传给模板
      chat_template_kwargs: { enable_thinking: false }
    })
    const raw = res.choices[0]?.message?.content ?? ''
    if (raw.trim().length === 0) {
      lastErr = new Error(`空响应(finish=${res.choices[0]?.finish_reason})`)
      continue
    }
    try {
      return JSON.parse(extractJson(raw)) as T
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('chatJson 多次重试仍失败')
}

export async function llmHealthy(): Promise<boolean> {
  try {
    await client.models.list()
    return true
  } catch {
    return false
  }
}
