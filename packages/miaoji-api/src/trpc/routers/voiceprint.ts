import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { TRPCError } from '@trpc/server'
import { and, eq } from 'drizzle-orm'
import { router, authedProcedure } from '../middleware.js'
import { speakers, voiceprints, minutes } from '../../db/schema.js'
import { addSample, l2norm, type VpSample } from '../../lib/voiceprint.js'
import { embedClip } from '../../lib/asr-client.js'
import { pathForKey, ensureDir, keyExists } from '../../lib/storage.js'
import * as ff from '../../lib/ffmpeg.js'

// 声纹录入质量门控:专用录音至少要有这么多「有效语音」秒,否则拒收(根治「随便一句话定声纹」)。
const MIN_ENROLL_SPEECH_SEC = Number(process.env.MIAOJI_ENROLL_MIN_SPEECH_SEC ?? 8)
// 会议片段作样本入库的最低发言时长(label-and-propagate:外部/不便录音的人靠在会议里说够这么久即可)。
const MIN_MEETING_SAMPLE_SEC = Number(process.env.MIAOJI_MEETING_SAMPLE_MIN_SEC ?? 5)

interface SampleMeta {
  model: string
  speechSec: number
  snrDb: number
  source: 'recording' | 'meeting'
}

/** 把一条新声纹样本按名并入库(多样本抗噪:addSample 入列+淘汰+重算中心)。返回 voiceprintId。
 *  v1 旧数据(只有中心、无 samples)→ 把旧中心当作一条历史样本播种,不丢失既有累积。
 *  换模型:跨模型向量不可比,addSample 自动丢弃异模型旧样本(旧声纹失配需重录)。 */
async function upsertVoiceprintByName(
  db: typeof import('../../db/index.js').db,
  ownerId: string,
  name: string,
  emb: number[],
  meta: SampleMeta,
  fromMinuteId: string | null
): Promise<string> {
  if (!meta.model)
    throw new TRPCError({ code: 'BAD_REQUEST', message: '声纹模型缺失(ASR 未回传 embeddingModel)' })
  const now = new Date().toISOString()
  const fresh = {
    emb,
    model: meta.model,
    speechSec: meta.speechSec,
    snrDb: meta.snrDb,
    source: meta.source,
    at: now
  }
  const existing = await db.query.voiceprints.findFirst({
    where: and(eq(voiceprints.ownerId, ownerId), eq(voiceprints.name, name))
  })
  if (existing) {
    let base: VpSample[] = existing.samples ?? []
    // v1 迁移:无 samples 但有中心、且中心同模型 → 把旧中心作一条历史样本(质量按既往累积次数估)
    if (
      base.length === 0 &&
      existing.embedding?.length === emb.length &&
      existing.embeddingModel === meta.model
    ) {
      base = [
        {
          emb: l2norm(existing.embedding),
          model: existing.embeddingModel,
          speechSec: Math.min(30, Math.max(10, existing.sampleCount * 10)),
          snrDb: 25,
          source: 'meeting',
          at: existing.createdAt?.toISOString?.() ?? now
        }
      ]
    }
    const { samples, centroid } = addSample(base, fresh)
    await db
      .update(voiceprints)
      .set({
        embedding: centroid,
        embeddingModel: meta.model,
        samples,
        sampleCount: existing.sampleCount + 1,
        updatedAt: new Date()
      })
      .where(eq(voiceprints.id, existing.id))
    return existing.id
  }
  const { samples, centroid } = addSample([], fresh)
  const [created] = await db
    .insert(voiceprints)
    .values({
      ownerId,
      name,
      embedding: centroid,
      embeddingModel: meta.model,
      samples,
      sampleCount: 1,
      enrolledFromMinuteId: fromMinuteId
    })
    .returning()
  if (!created) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: '声纹创建失败' })
  return created.id
}

/** 声纹库 · 命中即自动命名说话人(跨会议复用)· 注册=给某次会议的说话人贴真名并存其声纹 */
export const voiceprintRouter = router({
  // 声纹库列表(不回传向量本身)
  list: authedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.query.voiceprints.findMany({
      where: eq(voiceprints.ownerId, ctx.userId),
      orderBy: (v, { desc }) => [desc(v.updatedAt)]
    })
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      sampleCount: r.sampleCount,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt
    }))
  }),

  // 注册(方案二·label-and-propagate):给某次会议的说话人贴真名 → 把这段会议声纹作样本并入库。
  // 外部/不便专门录音的人(合作公司、朋友)只要在会议里说够时长,贴次名就能积累声纹、下次自动认。
  enroll: authedProcedure
    .input(z.object({ speakerId: z.string().uuid(), name: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const sp = await ctx.db.query.speakers.findFirst({ where: eq(speakers.id, input.speakerId) })
      if (!sp) throw new TRPCError({ code: 'NOT_FOUND' })
      const m = await ctx.db.query.minutes.findFirst({ where: eq(minutes.id, sp.minuteId) })
      if (!m || m.ownerId !== ctx.userId) throw new TRPCError({ code: 'FORBIDDEN' })
      const emb = sp.embedding ?? null
      if (!emb?.length || !sp.embeddingModel) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '该说话人无声纹向量(旧数据,请重新处理后再注册)' })
      }
      // 会议片段作样本:发言时长当 speechSec(质量分)。太短(<5s)的质量分压低,后续好样本会顶掉,但仍贴名
      const speechSec = (sp.totalSpeakingMs ?? 0) / 1000
      const enough = speechSec >= MIN_MEETING_SAMPLE_SEC
      const vpId = await upsertVoiceprintByName(
        ctx.db,
        ctx.userId,
        input.name,
        emb,
        {
          model: sp.embeddingModel,
          speechSec: enough ? speechSec : Math.max(1, speechSec),
          snrDb: enough ? 22 : 12,
          source: 'meeting'
        },
        sp.minuteId
      )
      await ctx.db
        .update(speakers)
        .set({ displayName: input.name, voiceprintId: vpId, isRenamed: true })
        .where(eq(speakers.id, input.speakerId))
      return { ok: true, voiceprintId: vpId }
    }),

  // 录入 v2:专用录音建声纹(质量门控 · 比从会议抠一句强得多)。
  // 前端录一段(读话术 20-30s)→ /upload 得 mediaKey → 此处转码抽声纹 + 有效语音门控。
  enrollRecording: authedProcedure
    .input(z.object({ name: z.string().min(1).max(64), mediaKey: z.string().min(1).max(512) }))
    .mutation(async ({ ctx, input }) => {
      if (!(await keyExists(input.mediaKey))) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '录音文件不存在,请重新录制' })
      }
      const wavKey = `voiceprint-enroll/${randomUUID()}.wav`
      const wavPath = pathForKey(wavKey)
      await ensureDir(wavPath)
      try {
        await ff.extractAudioWav(pathForKey(input.mediaKey), wavPath)
        const r = await embedClip(wavPath)
        if (r.speechSec < MIN_ENROLL_SPEECH_SEC) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `有效语音只有 ${r.speechSec.toFixed(1)} 秒(需 ≥ ${MIN_ENROLL_SPEECH_SEC} 秒)。请连续多说一会儿再录入。`
          })
        }
        if (!r.embedding?.length) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '未能从录音提取声纹,请换个安静环境重录' })
        }
        const vpId = await upsertVoiceprintByName(
          ctx.db,
          ctx.userId,
          input.name,
          r.embedding,
          { model: r.model, speechSec: r.speechSec, snrDb: r.snrDb, source: 'recording' },
          null
        )
        return { ok: true, voiceprintId: vpId, speechSec: r.speechSec, snrDb: r.snrDb }
      } finally {
        await import('node:fs/promises').then(fs => fs.rm(wavPath, { force: true })).catch(() => {})
      }
    }),

  // 用已有声纹认领(只贴名,不改声纹向量)
  assign: authedProcedure
    .input(z.object({ speakerId: z.string().uuid(), voiceprintId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const vp = await ctx.db.query.voiceprints.findFirst({ where: eq(voiceprints.id, input.voiceprintId) })
      if (!vp || vp.ownerId !== ctx.userId) throw new TRPCError({ code: 'NOT_FOUND' })
      const sp = await ctx.db.query.speakers.findFirst({ where: eq(speakers.id, input.speakerId) })
      if (!sp) throw new TRPCError({ code: 'NOT_FOUND' })
      await ctx.db
        .update(speakers)
        .set({ displayName: vp.name, voiceprintId: vp.id, isRenamed: true })
        .where(eq(speakers.id, input.speakerId))
      return { ok: true }
    }),

  rename: authedProcedure
    .input(z.object({ id: z.string().uuid(), name: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const vp = await ctx.db.query.voiceprints.findFirst({ where: eq(voiceprints.id, input.id) })
      if (!vp || vp.ownerId !== ctx.userId) throw new TRPCError({ code: 'NOT_FOUND' })
      await ctx.db
        .update(voiceprints)
        .set({ name: input.name, updatedAt: new Date() })
        .where(eq(voiceprints.id, input.id))
      return { ok: true }
    }),

  remove: authedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const vp = await ctx.db.query.voiceprints.findFirst({ where: eq(voiceprints.id, input.id) })
    if (!vp || vp.ownerId !== ctx.userId) throw new TRPCError({ code: 'NOT_FOUND' })
    await ctx.db.update(speakers).set({ voiceprintId: null }).where(eq(speakers.voiceprintId, input.id))
    await ctx.db.delete(voiceprints).where(eq(voiceprints.id, input.id))
    return { ok: true }
  })
})
