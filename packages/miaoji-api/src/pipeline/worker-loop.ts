// 后台 worker · 轮询待处理妙记并跑流水线。可独立进程运行(pnpm dev:worker)。
// 简单串行 + 单飞锁;生产可换 pg-boss / 队列。
import { and, inArray } from 'drizzle-orm'
import { db } from '../db/index.js'
import { minutes } from '../db/schema.js'
import { runPipeline } from './run.js'

const POLL_MS = Number(process.env.MIAOJI_WORKER_POLL_MS ?? 3000)
const inFlight = new Set<string>()

/** 找一条「需要处理」的妙记:刚上传或中途态(非 READY/FAILED) */
async function pickNext(): Promise<string | null> {
  const candidate = await db.query.minutes.findFirst({
    where: and(
      inArray(minutes.status, [
        'UPLOADING',
        'TRANSCODING',
        'TRANSCRIBING',
        'DIARIZING',
        'SEGMENTING',
        'SUMMARIZING'
      ])
      // mediaKey 必须就绪
    ),
    orderBy: (m, { asc }) => [asc(m.createdAt)]
  })
  if (!candidate || !candidate.mediaKey) return null
  if (inFlight.has(candidate.id)) return null
  return candidate.id
}

export async function tick(): Promise<void> {
  const id = await pickNext()
  if (!id) return
  inFlight.add(id)
  try {
    console.log(`[worker] processing minute ${id}`)
    await runPipeline(db, id)
    console.log(`[worker] done minute ${id}`)
  } catch (e) {
    console.error(`[worker] failed minute ${id}:`, (e as Error).message)
  } finally {
    inFlight.delete(id)
  }
}

/** 显式触发一条(上传完成后由 API 调用,免等轮询) */
export async function enqueue(minuteId: string): Promise<void> {
  if (inFlight.has(minuteId)) return
  inFlight.add(minuteId)
  runPipeline(db, minuteId)
    .catch(e => console.error(`[worker] enqueue ${minuteId} failed:`, (e as Error).message))
    .finally(() => inFlight.delete(minuteId))
}

async function loop(): Promise<void> {
  console.log(`[worker] miaoji pipeline worker started · poll=${POLL_MS}ms`)
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await tick().catch(e => console.error('[worker] tick error:', e))
    await new Promise(r => setTimeout(r, POLL_MS))
  }
}

// 作为独立进程启动时进入循环
if (process.argv[1] && process.argv[1].endsWith('worker-loop.ts')) {
  loop().catch(err => {
    console.error(err)
    process.exit(1)
  })
}
