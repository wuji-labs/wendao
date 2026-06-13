// Python ASR/diarization 微服务客户端 · 契约见 @wuji/miaoji-contracts AsrTranscribe*
// 用 undici 自带 fetch + Agent(同一实例),避免把外装 Agent 传给 Node 内置 fetch 致 "fetch failed"。
import { fetch as undiciFetch, Agent } from 'undici'
import { AsrTranscribeResponse, type AsrTranscribeRequest } from '@wuji/miaoji-contracts'
import { config } from './config.js'

// 长音频转写可能跑十几分钟 · 关掉默认 5 分钟 headers/body 超时(否则中途断连致 ASR 失败)
const longAgent = new Agent({ headersTimeout: 0, bodyTimeout: 0, connectTimeout: 10_000 })

export async function transcribe(
  reqBody: AsrTranscribeRequest,
  onProgress?: (pct: number) => void
): Promise<AsrTranscribeResponse> {
  // 转写期间并发轮询 /progress/{jobId} 取真实进度(转写在 FastAPI 线程池跑,/progress 可并发)
  let polling = !!(reqBody.jobId && onProgress)
  const pollLoop = async () => {
    while (polling) {
      await new Promise(r => setTimeout(r, 1500))
      if (!polling) break
      try {
        const pr = await undiciFetch(`${config.asrBaseUrl}/progress/${reqBody.jobId}`, {
          signal: AbortSignal.timeout(4000)
        })
        if (pr.ok) {
          const { progress } = (await pr.json()) as { progress: number }
          if (typeof progress === 'number') onProgress!(progress)
        }
      } catch {
        /* 轮询失败不影响转写 */
      }
    }
  }
  const poller = polling ? pollLoop() : null

  try {
    const res = await undiciFetch(`${config.asrBaseUrl}/transcribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(reqBody),
      dispatcher: longAgent
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error(`ASR service ${res.status}: ${txt.slice(0, 500)}`)
    }
    const json = await res.json()
    return AsrTranscribeResponse.parse(json)
  } finally {
    polling = false
    if (poller) await poller.catch(() => {})
  }
}

export async function asrHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${config.asrBaseUrl}/health`, { signal: AbortSignal.timeout(3000) })
    return res.ok
  } catch {
    return false
  }
}

export interface EmbedClipResult {
  embedding: number[]
  model: string
  speechSec: number
  totalSec: number
  snrDb: number
}

/** 单段录音 → CAM++ 声纹向量 + 质量度量(speechSec 供调用方质量门控)。声纹录入 v2 用。 */
export async function embedClip(wavPath: string): Promise<EmbedClipResult> {
  const res = await undiciFetch(`${config.asrBaseUrl}/embed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ audioPath: wavPath }),
    dispatcher: longAgent
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`ASR /embed ${res.status}: ${txt.slice(0, 300)}`)
  }
  return (await res.json()) as EmbedClipResult
}
