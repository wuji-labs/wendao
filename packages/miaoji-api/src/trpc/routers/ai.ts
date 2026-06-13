import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { eq } from 'drizzle-orm'
import { router, authedProcedure } from '../middleware.js'
import { summaries, chapters, todos, minutes } from '../../db/schema.js'
import { requireMinuteRole } from '../../lib/permissions.js'
import { buildLines } from '../../lib/transcript-lines.js'
import { generateSummary, generateChapters, generateTodos } from '../../pipeline/ai-tasks.js'

export const aiRouter = router({
  /** 重新生成智能纪要(总结/要点/风险) */
  regenerateSummary: authedProcedure
    .input(z.object({ minuteId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireMinuteRole(ctx.db, input.minuteId, ctx.userId, 'EDITOR')
      const { lines, lineToSegId } = await buildLines(ctx.db, input.minuteId)
      if (lines.length === 0) throw new TRPCError({ code: 'BAD_REQUEST', message: '尚无转写内容' })
      const sum = await generateSummary(lines)
      await ctx.db.delete(summaries).where(eq(summaries.minuteId, input.minuteId))
      await ctx.db.insert(summaries).values({
        minuteId: input.minuteId,
        overview: sum.overview,
        keyPoints: sum.keyPoints.map(k => ({
          text: k.text,
          sourceSegmentId: k.sourceLineNo ? (lineToSegId.get(k.sourceLineNo) ?? null) : null
        })),
        risks: sum.risks,
        status: 'DONE'
      })
      return ctx.db.query.summaries.findFirst({ where: eq(summaries.minuteId, input.minuteId) })
    }),

  regenerateChapters: authedProcedure
    .input(z.object({ minuteId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireMinuteRole(ctx.db, input.minuteId, ctx.userId, 'EDITOR')
      const m = await ctx.db.query.minutes.findFirst({ where: eq(minutes.id, input.minuteId) })
      const { lines, lineToStartMs } = await buildLines(ctx.db, input.minuteId)
      if (lines.length === 0) throw new TRPCError({ code: 'BAD_REQUEST', message: '尚无转写内容' })
      const chaps = await generateChapters(lines)
      await ctx.db.delete(chapters).where(eq(chapters.minuteId, input.minuteId))
      if (chaps.length > 0) {
        await ctx.db.insert(chapters).values(
          chaps.map((c, i) => ({
            minuteId: input.minuteId,
            title: c.title,
            startMs: Number(lineToStartMs.get(c.startLineNo) ?? 0),
            endMs: Number(lineToStartMs.get(c.endLineNo) ?? m?.durationMs ?? 0),
            summary: c.summary,
            orderIndex: i
          }))
        )
      }
      return ctx.db.query.chapters.findMany({
        where: eq(chapters.minuteId, input.minuteId),
        orderBy: (c, { asc }) => [asc(c.orderIndex)]
      })
    }),

  regenerateTodos: authedProcedure
    .input(z.object({ minuteId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireMinuteRole(ctx.db, input.minuteId, ctx.userId, 'EDITOR')
      const { lines, lineToSegId } = await buildLines(ctx.db, input.minuteId)
      if (lines.length === 0) throw new TRPCError({ code: 'BAD_REQUEST', message: '尚无转写内容' })
      const tds = await generateTodos(lines)
      await ctx.db.delete(todos).where(eq(todos.minuteId, input.minuteId))
      if (tds.length > 0) {
        await ctx.db.insert(todos).values(
          tds.map((t, i) => ({
            minuteId: input.minuteId,
            text: t.text,
            owner: t.owner,
            sourceSegmentId: t.sourceLineNo ? (lineToSegId.get(t.sourceLineNo) ?? null) : null,
            orderIndex: i
          }))
        )
      }
      return ctx.db.query.todos.findMany({
        where: eq(todos.minuteId, input.minuteId),
        orderBy: (t, { asc }) => [asc(t.orderIndex)]
      })
    }),

  /** 勾选/取消待办 */
  setTodoStatus: authedProcedure
    .input(z.object({ id: z.string().uuid(), status: z.enum(['OPEN', 'DONE', 'CANCELLED']) }))
    .mutation(async ({ ctx, input }) => {
      const t = await ctx.db.query.todos.findFirst({ where: eq(todos.id, input.id) })
      if (!t) throw new TRPCError({ code: 'NOT_FOUND' })
      await requireMinuteRole(ctx.db, t.minuteId, ctx.userId, 'COMMENTER')
      await ctx.db.update(todos).set({ status: input.status }).where(eq(todos.id, input.id))
      return { ok: true }
    })
})
