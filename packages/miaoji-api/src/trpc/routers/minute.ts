import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { and, desc, eq, ilike, sql } from 'drizzle-orm'
import { router, publicProcedure, authedProcedure } from '../middleware.js'
import {
  minutes,
  segments,
  speakers,
  summaries,
  chapters,
  todos,
  highlights,
  comments,
  clips,
  jobs
} from '../../db/schema.js'
import { CreateMinuteInput, ListMinutesInput } from '@wuji/miaoji-contracts'
import { newToken } from '../../lib/token.js'
import { titleFromMediaKey } from '../../lib/title.js'
import { requireMinuteRole, resolveMinuteRole } from '../../lib/permissions.js'
import { enqueue } from '../../pipeline/worker-loop.js'

export const minuteRouter = router({
  /** 上传完成后登记一条妙记并入队处理 */
  create: authedProcedure.input(CreateMinuteInput).mutation(async ({ ctx, input }) => {
    const [m] = await ctx.db
      .insert(minutes)
      .values({
        token: newToken(),
        ownerId: ctx.userId,
        folderId: input.folderId ?? null,
        // 标题兜底 = 录音文件名(去扩展名)·导出文件名取自 title,一处对齐两处生效
        title: (input.title ?? '').trim() || titleFromMediaKey(input.mediaKey),
        source: input.source,
        mediaType: input.mediaType,
        mediaKey: input.mediaKey,
        language: input.language,
        numSpeakers: input.numSpeakers ?? null,
        durationMs: input.durationMs ?? 0,
        status: 'UPLOADING'
      })
      .returning()
    if (!m) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: '创建失败' })
    // 异步触发流水线(不阻塞响应)
    void enqueue(m.id)
    return { id: m.id, token: m.token }
  }),

  list: authedProcedure.input(ListMinutesInput).query(async ({ ctx, input }) => {
    const conds = [eq(minutes.ownerId, ctx.userId)]
    if (input.folderId !== undefined) {
      conds.push(
        input.folderId === null ? sql`${minutes.folderId} is null` : eq(minutes.folderId, input.folderId)
      )
    }
    if (input.status) conds.push(eq(minutes.status, input.status))
    if (input.query) conds.push(ilike(minutes.title, `%${input.query}%`))

    const rows = await ctx.db.query.minutes.findMany({
      where: and(...conds),
      orderBy: [desc(minutes.createdAt)],
      limit: input.limit,
      offset: input.offset
    })
    return rows
  }),

  /** 通过 token 打开妙记 · 聚合详情视图。记一次访问。 */
  getByToken: publicProcedure.input(z.object({ token: z.string() })).query(async ({ ctx, input }) => {
    const minute = await ctx.db.query.minutes.findFirst({ where: eq(minutes.token, input.token) })
    if (!minute) throw new TRPCError({ code: 'NOT_FOUND' })
    const role = await resolveMinuteRole(ctx.db, minute.id, ctx.userId)
    if (!role) throw new TRPCError({ code: 'FORBIDDEN', message: '无权访问此妙记' })

    // 访问计数(粗粒度)
    await ctx.db
      .update(minutes)
      .set({ visitCount: minute.visitCount + 1 })
      .where(eq(minutes.id, minute.id))

    const [spk, segs, sum, chaps, tds, hls, cmts, clps, jbs] = await Promise.all([
      ctx.db.query.speakers.findMany({
        where: eq(speakers.minuteId, minute.id),
        orderBy: (s, { asc }) => [asc(s.orderIndex)]
      }),
      ctx.db.query.segments.findMany({
        where: eq(segments.minuteId, minute.id),
        orderBy: (s, { asc }) => [asc(s.orderIndex)]
      }),
      ctx.db.query.summaries.findFirst({ where: eq(summaries.minuteId, minute.id) }),
      ctx.db.query.chapters.findMany({
        where: eq(chapters.minuteId, minute.id),
        orderBy: (c, { asc }) => [asc(c.orderIndex)]
      }),
      ctx.db.query.todos.findMany({
        where: eq(todos.minuteId, minute.id),
        orderBy: (t, { asc }) => [asc(t.orderIndex)]
      }),
      ctx.db.query.highlights.findMany({ where: eq(highlights.minuteId, minute.id) }),
      ctx.db.query.comments.findMany({
        where: eq(comments.minuteId, minute.id),
        orderBy: (c, { asc }) => [asc(c.createdAt)]
      }),
      ctx.db.query.clips.findMany({
        where: eq(clips.minuteId, minute.id),
        orderBy: (c, { desc: d }) => [d(c.createdAt)]
      }),
      ctx.db.query.jobs.findMany({ where: eq(jobs.minuteId, minute.id) })
    ])

    return {
      minute,
      role,
      speakers: spk,
      segments: segs,
      summary: sum ?? null,
      chapters: chaps,
      todos: tds,
      highlights: hls,
      comments: cmts,
      clips: clps,
      jobs: jbs
    }
  }),

  /** 处理进度轮询(列表/详情页用) */
  status: publicProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const m = await ctx.db.query.minutes.findFirst({
      where: eq(minutes.id, input.id),
      columns: { id: true, status: true, errorMessage: true, durationMs: true, title: true }
    })
    if (!m) throw new TRPCError({ code: 'NOT_FOUND' })
    const jbs = await ctx.db.query.jobs.findMany({ where: eq(jobs.minuteId, input.id) })
    return { ...m, jobs: jbs }
  }),

  rename: authedProcedure
    .input(z.object({ id: z.string().uuid(), title: z.string().max(256) }))
    .mutation(async ({ ctx, input }) => {
      await requireMinuteRole(ctx.db, input.id, ctx.userId, 'EDITOR')
      await ctx.db
        .update(minutes)
        .set({ title: input.title, updatedAt: new Date() })
        .where(eq(minutes.id, input.id))
      return { ok: true }
    }),

  move: authedProcedure
    .input(z.object({ id: z.string().uuid(), folderId: z.string().uuid().nullable() }))
    .mutation(async ({ ctx, input }) => {
      await requireMinuteRole(ctx.db, input.id, ctx.userId, 'MANAGER')
      await ctx.db
        .update(minutes)
        .set({ folderId: input.folderId, updatedAt: new Date() })
        .where(eq(minutes.id, input.id))
      return { ok: true }
    }),

  setLinkScope: authedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        linkScope: z.enum(['CLOSED', 'TENANT_VIEW', 'TENANT_EDIT', 'ANYONE_VIEW'])
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireMinuteRole(ctx.db, input.id, ctx.userId, 'MANAGER')
      await ctx.db
        .update(minutes)
        .set({ linkScope: input.linkScope, updatedAt: new Date() })
        .where(eq(minutes.id, input.id))
      return { ok: true }
    }),

  remove: authedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    await requireMinuteRole(ctx.db, input.id, ctx.userId, 'MANAGER')
    // 级联清子表
    await Promise.all([
      ctx.db.delete(segments).where(eq(segments.minuteId, input.id)),
      ctx.db.delete(speakers).where(eq(speakers.minuteId, input.id)),
      ctx.db.delete(summaries).where(eq(summaries.minuteId, input.id)),
      ctx.db.delete(chapters).where(eq(chapters.minuteId, input.id)),
      ctx.db.delete(todos).where(eq(todos.minuteId, input.id)),
      ctx.db.delete(highlights).where(eq(highlights.minuteId, input.id)),
      ctx.db.delete(comments).where(eq(comments.minuteId, input.id)),
      ctx.db.delete(clips).where(eq(clips.minuteId, input.id)),
      ctx.db.delete(jobs).where(eq(jobs.minuteId, input.id))
    ])
    await ctx.db.delete(minutes).where(eq(minutes.id, input.id))
    return { ok: true }
  }),

  /** 重新处理(重跑流水线) */
  reprocess: authedProcedure
    .input(
      z.object({ id: z.string().uuid(), numSpeakers: z.number().int().min(1).max(20).nullable().optional() })
    )
    .mutation(async ({ ctx, input }) => {
      await requireMinuteRole(ctx.db, input.id, ctx.userId, 'MANAGER')
      // 可选改人数后重转:自动检测在多人会议常偏少(把几人并成一个),指定人数强制聚类更准。
      // undefined = 不动原值;null/数字 = 覆盖(null 回到自动检测)。
      const patch: { status: 'TRANSCODING'; errorMessage: null; numSpeakers?: number | null } = {
        status: 'TRANSCODING',
        errorMessage: null
      }
      if (input.numSpeakers !== undefined) patch.numSpeakers = input.numSpeakers
      await ctx.db.update(minutes).set(patch).where(eq(minutes.id, input.id))
      void enqueue(input.id)
      return { ok: true }
    }),

  /** 统计面板 */
  stats: publicProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const role = await resolveMinuteRole(ctx.db, input.id, ctx.userId)
    if (!role) throw new TRPCError({ code: 'FORBIDDEN' })
    const m = await ctx.db.query.minutes.findFirst({ where: eq(minutes.id, input.id) })
    if (!m) throw new TRPCError({ code: 'NOT_FOUND' })
    const spk = await ctx.db.query.speakers.findMany({
      where: eq(speakers.minuteId, input.id),
      orderBy: (s, { asc }) => [asc(s.orderIndex)]
    })
    const wordCount = spk.reduce((a, s) => a + s.wordCount, 0)
    return {
      owner: m.ownerId,
      createdAt: m.createdAt,
      durationMs: m.durationMs,
      visitorCount: m.visitorCount,
      visitCount: m.visitCount,
      commentCount: m.commentCount,
      wordCount,
      speakers: spk.map(s => ({
        speakerId: s.id,
        displayName: s.displayName,
        speakingMs: s.totalSpeakingMs,
        wordCount: s.wordCount,
        speakingRatio: s.speakingRatio
      }))
    }
  })
})
