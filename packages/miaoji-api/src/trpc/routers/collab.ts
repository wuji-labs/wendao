import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { and, eq, sql } from 'drizzle-orm'
import { router, authedProcedure, publicProcedure } from '../middleware.js'
import { highlights, comments, clips, minutes, segments } from '../../db/schema.js'
import { requireMinuteRole, resolveMinuteRole } from '../../lib/permissions.js'
import { AddHighlightInput, AddCommentInput, CreateClipInput } from '@wuji/miaoji-contracts'
import { newToken } from '../../lib/token.js'

export const collabRouter = router({
  /* ── 高亮 ── */
  addHighlight: authedProcedure.input(AddHighlightInput).mutation(async ({ ctx, input }) => {
    await requireMinuteRole(ctx.db, input.minuteId, ctx.userId, 'COMMENTER')
    const [h] = await ctx.db
      .insert(highlights)
      .values({
        minuteId: input.minuteId,
        segmentId: input.segmentId,
        charStart: input.charStart,
        charEnd: input.charEnd,
        createdBy: ctx.userId
      })
      .returning()
    return h
  }),

  removeHighlight: authedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const h = await ctx.db.query.highlights.findFirst({ where: eq(highlights.id, input.id) })
      if (!h) throw new TRPCError({ code: 'NOT_FOUND' })
      await requireMinuteRole(ctx.db, h.minuteId, ctx.userId, 'COMMENTER')
      await ctx.db.delete(highlights).where(eq(highlights.id, input.id))
      return { ok: true }
    }),

  /* ── 评论 ── */
  addComment: authedProcedure.input(AddCommentInput).mutation(async ({ ctx, input }) => {
    await requireMinuteRole(ctx.db, input.minuteId, ctx.userId, 'COMMENTER')
    const [c] = await ctx.db
      .insert(comments)
      .values({
        minuteId: input.minuteId,
        segmentId: input.segmentId ?? null,
        charStart: input.charStart ?? null,
        charEnd: input.charEnd ?? null,
        authorId: ctx.userId,
        body: input.body,
        parentId: input.parentId ?? null
      })
      .returning()
    await ctx.db
      .update(minutes)
      .set({ commentCount: sql`${minutes.commentCount} + 1` })
      .where(eq(minutes.id, input.minuteId))
    return c
  }),

  listComments: publicProcedure
    .input(z.object({ minuteId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const role = await resolveMinuteRole(ctx.db, input.minuteId, ctx.userId)
      if (!role) throw new TRPCError({ code: 'FORBIDDEN' })
      return ctx.db.query.comments.findMany({
        where: eq(comments.minuteId, input.minuteId),
        orderBy: (c, { asc }) => [asc(c.createdAt)]
      })
    }),

  resolveComment: authedProcedure
    .input(z.object({ id: z.string().uuid(), resolved: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const c = await ctx.db.query.comments.findFirst({ where: eq(comments.id, input.id) })
      if (!c) throw new TRPCError({ code: 'NOT_FOUND' })
      await requireMinuteRole(ctx.db, c.minuteId, ctx.userId, 'COMMENTER')
      await ctx.db.update(comments).set({ resolved: input.resolved }).where(eq(comments.id, input.id))
      return { ok: true }
    }),

  /* ── 片段 ── */
  createClip: authedProcedure.input(CreateClipInput).mutation(async ({ ctx, input }) => {
    await requireMinuteRole(ctx.db, input.minuteId, ctx.userId, 'COMMENTER')
    if (input.endMs <= input.startMs)
      throw new TRPCError({ code: 'BAD_REQUEST', message: '片段结束须晚于开始' })
    const [c] = await ctx.db
      .insert(clips)
      .values({
        minuteId: input.minuteId,
        startMs: input.startMs,
        endMs: input.endMs,
        title: input.title,
        createdBy: ctx.userId,
        shareToken: newToken()
      })
      .returning()
    return c
  }),

  listClips: publicProcedure
    .input(z.object({ minuteId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const role = await resolveMinuteRole(ctx.db, input.minuteId, ctx.userId)
      if (!role) throw new TRPCError({ code: 'FORBIDDEN' })
      return ctx.db.query.clips.findMany({
        where: eq(clips.minuteId, input.minuteId),
        orderBy: (c, { desc }) => [desc(c.createdAt)]
      })
    }),

  removeClip: authedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const c = await ctx.db.query.clips.findFirst({ where: eq(clips.id, input.id) })
    if (!c) throw new TRPCError({ code: 'NOT_FOUND' })
    await requireMinuteRole(ctx.db, c.minuteId, ctx.userId, 'EDITOR')
    await ctx.db.delete(clips).where(eq(clips.id, input.id))
    return { ok: true }
  }),

  /** 片段公开访问(by shareToken) · 返回片段 + 时间窗内句段 */
  getClipByToken: publicProcedure.input(z.object({ token: z.string() })).query(async ({ ctx, input }) => {
    const clip = await ctx.db.query.clips.findFirst({ where: eq(clips.shareToken, input.token) })
    if (!clip) throw new TRPCError({ code: 'NOT_FOUND' })
    const minute = await ctx.db.query.minutes.findFirst({ where: eq(minutes.id, clip.minuteId) })
    const segs = await ctx.db.query.segments.findMany({
      where: and(eq(segments.minuteId, clip.minuteId)),
      orderBy: (s, { asc }) => [asc(s.orderIndex)]
    })
    const within = segs.filter(s => s.endMs >= clip.startMs && s.startMs <= clip.endMs)
    return { clip, minute, segments: within }
  })
})
