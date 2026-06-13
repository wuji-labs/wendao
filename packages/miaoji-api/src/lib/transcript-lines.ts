// 从 DB 重建带行号转写 + 行号↔segmentId 映射 · ai/qa 复用
import { eq } from 'drizzle-orm'
import type { DB } from '../db/index.js'
import { segments, speakers } from '../db/schema.js'
import type { TranscriptLine } from '../pipeline/ai-tasks.js'

export interface BuiltLines {
  lines: TranscriptLine[]
  lineToSegId: Map<number, string>
  lineToStartMs: Map<number, string | number>
  segIdToStartMs: Map<string, number>
}

export async function buildLines(db: DB, minuteId: string): Promise<BuiltLines> {
  const [segs, spk] = await Promise.all([
    db.query.segments.findMany({
      where: eq(segments.minuteId, minuteId),
      orderBy: (s, { asc }) => [asc(s.orderIndex)]
    }),
    db.query.speakers.findMany({ where: eq(speakers.minuteId, minuteId) })
  ])
  const name = new Map(spk.map(s => [s.id, s.displayName]))
  const lineToSegId = new Map<number, string>()
  const lineToStartMs = new Map<number, string | number>()
  const segIdToStartMs = new Map<string, number>()
  const lines: TranscriptLine[] = segs.map((s, i) => {
    const lineNo = i + 1
    lineToSegId.set(lineNo, s.id)
    lineToStartMs.set(lineNo, s.startMs)
    segIdToStartMs.set(s.id, s.startMs)
    return {
      lineNo,
      speaker: s.speakerId ? (name.get(s.speakerId) ?? '说话人') : '说话人',
      startMs: s.startMs,
      text: s.text
    }
  })
  return { lines, lineToSegId, lineToStartMs, segIdToStartMs }
}
