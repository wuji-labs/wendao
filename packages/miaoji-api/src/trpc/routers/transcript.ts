import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { and, asc, eq, ilike } from 'drizzle-orm'
import { router, publicProcedure, authedProcedure } from '../middleware.js'
import { segments, minutes } from '../../db/schema.js'
import { requireMinuteRole, resolveMinuteRole } from '../../lib/permissions.js'

export const transcriptRouter = router({
  /** 编辑句段文本 · 标记 isEdited */
  editSegment: authedProcedure
    .input(z.object({ segmentId: z.string().uuid(), text: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const seg = await ctx.db.query.segments.findFirst({ where: eq(segments.id, input.segmentId) })
      if (!seg) throw new TRPCError({ code: 'NOT_FOUND' })
      await requireMinuteRole(ctx.db, seg.minuteId, ctx.userId, 'EDITOR')
      await ctx.db
        .update(segments)
        .set({ text: input.text, isEdited: true })
        .where(eq(segments.id, input.segmentId))
      return { ok: true }
    }),

  /** 转写内搜索 · 返回命中句段(含起始时间,用于定位) */
  search: publicProcedure
    .input(z.object({ minuteId: z.string().uuid(), query: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const role = await resolveMinuteRole(ctx.db, input.minuteId, ctx.userId)
      if (!role) throw new TRPCError({ code: 'FORBIDDEN' })
      const rows = await ctx.db.query.segments.findMany({
        where: and(eq(segments.minuteId, input.minuteId), ilike(segments.text, `%${input.query}%`)),
        orderBy: [asc(segments.orderIndex)],
        limit: 200
      })
      return rows.map(r => ({
        id: r.id,
        startMs: r.startMs,
        endMs: r.endMs,
        text: r.text,
        speakerId: r.speakerId
      }))
    })
})
