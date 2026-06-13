// 妙记处理流水线编排 · 单条妙记走完六阶段。
// upload → TRANSCODE(ffmpeg) → ASR/DIARIZE(python 服务) → SEGMENT(句段化) → SUMMARIZE(Ollama) → INDEX → READY
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { eq, sql } from 'drizzle-orm'
import type { DB } from '../db/index.js'
import {
  minutes,
  speakers as speakersTbl,
  segments as segmentsTbl,
  summaries,
  chapters as chaptersTbl,
  todos as todosTbl,
  voiceprints,
  jobs
} from '../db/schema.js'
import { pathForKey, ensureDir } from '../lib/storage.js'
import * as ff from '../lib/ffmpeg.js'
import { transcribe } from '../lib/asr-client.js'
import { assembleTranscript } from './assemble.js'
import { archiveMinute } from '../lib/archive.js'
import { matchVoiceprint } from '../lib/voiceprint.js'
import {
  generateSummary,
  generateChapters,
  generateTodos,
  generateTitle,
  type TranscriptLine
} from './ai-tasks.js'
import type { JobStage } from '@wuji/miaoji-contracts'

async function startJob(db: DB, minuteId: string, stage: JobStage): Promise<string> {
  const existing = await db.query.jobs.findFirst({
    where: (j, { and, eq: e }) => and(e(j.minuteId, minuteId), e(j.stage, stage))
  })
  if (existing) {
    await db
      .update(jobs)
      .set({ status: 'RUNNING', progress: 0, startedAt: new Date(), errorMessage: null })
      .where(eq(jobs.id, existing.id))
    return existing.id
  }
  const [j] = await db
    .insert(jobs)
    .values({ minuteId, stage, status: 'RUNNING', startedAt: new Date() })
    .returning()
  if (!j) throw new Error('job 创建失败')
  return j.id
}

async function finishJob(
  db: DB,
  jobId: string,
  status: 'DONE' | 'FAILED',
  errorMessage?: string
): Promise<void> {
  await db
    .update(jobs)
    .set({
      status,
      progress: status === 'DONE' ? 1 : 0,
      finishedAt: new Date(),
      errorMessage: errorMessage ?? null
    })
    .where(eq(jobs.id, jobId))
}

/**
 * 运行整条流水线。任一阶段失败 → 该 job + minute 标 FAILED 并抛出。
 */
export async function runPipeline(db: DB, minuteId: string): Promise<void> {
  const minute = await db.query.minutes.findFirst({ where: eq(minutes.id, minuteId) })
  if (!minute) throw new Error(`minute ${minuteId} not found`)
  if (!minute.mediaKey) throw new Error(`minute ${minuteId} has no mediaKey`)

  const workDir = join('derived', minute.id)
  const inputPath = pathForKey(minute.mediaKey)
  const wavKey = `${workDir}/audio.wav`
  const wavPath = pathForKey(wavKey)
  await ensureDir(wavPath)

  try {
    /* ── 1. TRANSCODE(缓存跳过:重跑时 wav+playable 已存在则不重跑)── */
    await db
      .update(minutes)
      .set({ status: 'TRANSCODING', updatedAt: new Date() })
      .where(eq(minutes.id, minuteId))
    const tcJob = await startJob(db, minuteId, 'TRANSCODE')
    try {
      const wavOk = existsSync(wavPath)
      const playableKey = (await ff.probe(inputPath)).hasVideo
        ? `${workDir}/playable.mp4`
        : `${workDir}/playable.m4a`
      const playablePath = pathForKey(playableKey)
      const playableOk = existsSync(playablePath)
      let meta: Awaited<ReturnType<typeof ff.probe>> = null as unknown as Awaited<ReturnType<typeof ff.probe>>
      let mediaType: 'AUDIO' | 'VIDEO' = 'AUDIO'
      if (wavOk && playableOk) {
        try {
          meta = await ff.probe(playablePath)
          mediaType = meta.hasVideo ? 'VIDEO' : 'AUDIO'
        } catch {
          // 缓存损坏,回退全长转码
          meta = await ff.probe(inputPath)
          mediaType = meta.hasVideo ? 'VIDEO' : 'AUDIO'
          await ensureDir(playablePath)
          await ff.extractAudioWav(inputPath, wavPath)
          await ff.toPlayable(inputPath, playablePath, meta.hasVideo)
        }
      } else {
        meta = await ff.probe(inputPath)
        mediaType = meta.hasVideo ? 'VIDEO' : 'AUDIO'
        await ensureDir(playablePath)
        await ff.extractAudioWav(inputPath, wavPath)
        await ff.toPlayable(inputPath, playablePath, meta.hasVideo)
      }
      let coverKey: string | null = null
      if (meta.hasVideo) {
        coverKey = `${workDir}/cover.jpg`
        await ff.grabCover(inputPath, pathForKey(coverKey), Math.min(1, meta.durationMs / 2000))
      }
      await db
        .update(minutes)
        .set({
          mediaType,
          playableKey,
          cover: coverKey,
          durationMs: meta.durationMs,
          quotaMinutes: Math.ceil(meta.durationMs / 60000),
          updatedAt: new Date()
        })
        .where(eq(minutes.id, minuteId))
      await finishJob(db, tcJob, 'DONE')
    } catch (e) {
      await finishJob(db, tcJob, 'FAILED', (e as Error).message)
      throw e
    }

    /* ── 2. ASR + DIARIZE ── */
    await db
      .update(minutes)
      .set({ status: 'TRANSCRIBING', updatedAt: new Date() })
      .where(eq(minutes.id, minuteId))
    const asrJob = await startJob(db, minuteId, 'ASR')
    let asr
    try {
      let lastPct = -1
      asr = await transcribe(
        {
          audioPath: wavPath,
          language: minute.language,
          diarize: true,
          numSpeakers: minute.numSpeakers ?? null,
          jobId: asrJob
        },
        pct => {
          // 真实进度写入 ASR job(变化≥1% 才写库,避免过频)
          const p = Math.round(pct * 100)
          if (p !== lastPct) {
            lastPct = p
            void db.update(jobs).set({ progress: pct }).where(eq(jobs.id, asrJob))
          }
        }
      )
      await finishJob(db, asrJob, 'DONE')
    } catch (e) {
      await finishJob(db, asrJob, 'FAILED', (e as Error).message)
      throw e
    }
    // diarize 阶段并入 ASR 服务,这里登记其结果
    const diarJob = await startJob(db, minuteId, 'DIARIZE')
    await finishJob(
      db,
      diarJob,
      'DONE',
      asr.engine.diarized ? undefined : '未启用说话人分离(无 HF token 或 pyannote 不可用)'
    )

    /* ── 3. SEGMENT ── */
    await db
      .update(minutes)
      .set({ status: 'SEGMENTING', updatedAt: new Date() })
      .where(eq(minutes.id, minuteId))
    const segJob = await startJob(db, minuteId, 'SEGMENT')
    try {
      const assembled = assembleTranscript(asr)
      // 清旧(重跑场景)
      await db.delete(segmentsTbl).where(eq(segmentsTbl.minuteId, minuteId))
      await db.delete(speakersTbl).where(eq(speakersTbl.minuteId, minuteId))

      // 声纹库比对:命中即自动命名(跨会议复用)· 只比同模型(跨模型向量不可比)
      const lib = await db.query.voiceprints.findMany({ where: eq(voiceprints.ownerId, minute.ownerId) })
      const embByKey = asr.speakerEmbeddings ?? {}
      const embModel = asr.embeddingModel ?? ''

      const keyToSpeakerId = new Map<string | null, string>()
      const vpToSpeakerId = new Map<string, string>() // 同一声纹命中多个簇 → 并为一人(串联漏接的兜底)
      for (const sp of assembled.speakers) {
        const emb = (sp.voiceprintKey && embByKey[sp.voiceprintKey]) || null
        const hit = matchVoiceprint(emb, lib, embModel)
        const dupOf = hit ? vpToSpeakerId.get(hit.vp.id) : undefined
        if (dupOf) {
          // 声纹证明同一人 → 不另立说话人,段并入已有行并累计统计
          await db
            .update(speakersTbl)
            .set({
              totalSpeakingMs: sql`${speakersTbl.totalSpeakingMs} + ${sp.totalSpeakingMs}`,
              segmentCount: sql`${speakersTbl.segmentCount} + ${sp.segmentCount}`,
              wordCount: sql`${speakersTbl.wordCount} + ${sp.wordCount}`,
              speakingRatio: sql`${speakersTbl.speakingRatio} + ${sp.speakingRatio}`
            })
            .where(eq(speakersTbl.id, dupOf))
          keyToSpeakerId.set(sp.voiceprintKey, dupOf)
          continue
        }
        const [row] = await db
          .insert(speakersTbl)
          .values({
            minuteId,
            displayName: hit ? hit.vp.name : sp.displayName,
            voiceprintKey: sp.voiceprintKey,
            embedding: emb ?? null,
            embeddingModel: emb ? embModel : null,
            voiceprintId: hit ? hit.vp.id : null,
            isRenamed: !!hit,
            totalSpeakingMs: sp.totalSpeakingMs,
            segmentCount: sp.segmentCount,
            wordCount: sp.wordCount,
            speakingRatio: sp.speakingRatio,
            orderIndex: sp.orderIndex,
            colorHex: sp.colorHex
          })
          .returning({ id: speakersTbl.id })
        if (!row) throw new Error('speaker 创建失败')
        keyToSpeakerId.set(sp.voiceprintKey, row.id)
        if (hit) vpToSpeakerId.set(hit.vp.id, row.id)
      }

      if (assembled.segments.length > 0) {
        await db.insert(segmentsTbl).values(
          assembled.segments.map(s => ({
            minuteId,
            speakerId: keyToSpeakerId.get(s.speakerVoiceprintKey) ?? null,
            startMs: s.startMs,
            endMs: s.endMs,
            text: s.text,
            words: s.words,
            orderIndex: s.orderIndex,
            paragraphId: s.paragraphId
          }))
        )
      }
      await finishJob(db, segJob, 'DONE')
    } catch (e) {
      await finishJob(db, segJob, 'FAILED', (e as Error).message)
      throw e
    }

    /* ── 4. 智能纪要:改为「按需生成」──
       不在流水线自动跑(避免长会议把本机 Ollama 堵死、也让转写全文立即可见);
       用户在详情页点「生成」时,由 ai.regenerateSummary/Chapters/Todos 按需生成。 */

    /* ── 5. INDEX ── */
    const idxJob = await startJob(db, minuteId, 'INDEX')
    await finishJob(db, idxJob, 'DONE')

    /* ── done ── */
    await db.update(minutes).set({ status: 'READY', updatedAt: new Date() }).where(eq(minutes.id, minuteId))

    /* ── archive to the external directory (best-effort · never blocks READY) ── */
    try {
      const r = await archiveMinute(db, minuteId)
      if (r.archived) console.log(`[pipeline] archived minute ${minuteId} → ${r.dir}`)
    } catch (e) {
      console.warn(`[pipeline] archive failed for ${minuteId}:`, (e as Error).message)
    }
  } catch (e) {
    await db
      .update(minutes)
      .set({ status: 'FAILED', errorMessage: (e as Error).message, updatedAt: new Date() })
      .where(eq(minutes.id, minuteId))
    throw e
  }
}
