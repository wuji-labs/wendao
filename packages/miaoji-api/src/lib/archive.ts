// Optional archiving · once a minute is READY, copy its original recording +
// transcript into an external directory (local dir or mounted NAS/SMB share).
// Toggled by config.archiveDir (empty = disabled).
import { mkdir, copyFile, writeFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import type { DB } from '../db/index.js'
import { minutes, segments, speakers } from '../db/schema.js'
import { config } from './config.js'
import { pathForKey } from './storage.js'
import { renderExport, type ExportSegment } from './export-render.js'

function safeName(s: string): string {
  return (s || '未命名')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

function yyyymm(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Archive a READY minute to the external directory. Non-fatal on failure (logs only). */
export async function archiveMinute(db: DB, minuteId: string): Promise<{ archived: boolean; dir?: string }> {
  if (!config.archiveDir) return { archived: false }

  const minute = await db.query.minutes.findFirst({ where: eq(minutes.id, minuteId) })
  if (!minute) return { archived: false }

  const created = minute.createdAt instanceof Date ? minute.createdAt : new Date(minute.createdAt)
  const folder = `${safeName(minute.title)}-${minute.token}`
  const destDir = join(config.archiveDir, yyyymm(created), folder)
  await mkdir(destDir, { recursive: true })

  // 1) 原始录音(若仍在本地存储)
  const srcKey = minute.mediaKey ?? minute.playableKey
  if (srcKey) {
    const srcPath = pathForKey(srcKey)
    try {
      await stat(srcPath)
      const ext = srcKey.split('.').pop() || 'bin'
      await copyFile(srcPath, join(destDir, `录音.${ext}`))
    } catch {
      /* 源不在本地(可能已清理)→ 跳过媒体,仍归档转写 */
    }
  }

  // 2) 转写副本(txt + srt)
  const [segs, spk] = await Promise.all([
    db.query.segments.findMany({
      where: eq(segments.minuteId, minuteId),
      orderBy: (s, { asc }) => [asc(s.orderIndex)]
    }),
    db.query.speakers.findMany({ where: eq(speakers.minuteId, minuteId) })
  ])
  const name = new Map(spk.map(s => [s.id, s.displayName]))
  const rows: ExportSegment[] = segs.map(s => ({
    startMs: s.startMs,
    endMs: s.endMs,
    speaker: s.speakerId ? (name.get(s.speakerId) ?? null) : null,
    text: s.text
  }))
  const opts = { title: minute.title || '未命名妙记', includeSpeaker: true, includeTimestamp: true }
  const txt = renderExport('TXT', rows, opts)
  const srt = renderExport('SRT', rows, opts)
  await writeFile(join(destDir, '转写.txt'), txt.content, 'utf-8')
  await writeFile(join(destDir, '字幕.srt'), srt.content, 'utf-8')

  // 3) manifest
  const manifest = {
    token: minute.token,
    title: minute.title,
    source: minute.source,
    language: minute.language,
    durationMs: minute.durationMs,
    createdAt: created.toISOString(),
    archivedAt: new Date().toISOString(),
    speakers: spk.map(s => ({ name: s.displayName, speakingMs: s.totalSpeakingMs, ratio: s.speakingRatio })),
    segmentCount: segs.length
  }
  await writeFile(join(destDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8')

  return { archived: true, dir: destDir }
}
