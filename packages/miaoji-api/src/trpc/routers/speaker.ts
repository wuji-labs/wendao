import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { eq } from 'drizzle-orm'
import { router, authedProcedure } from '../middleware.js'
import { speakers, segments } from '../../db/schema.js'
import { requireMinuteRole } from '../../lib/permissions.js'
import { RenameSpeakerInput } from '@wuji/miaoji-contracts'

export const speakerRouter = router({
  /** 重命名说话人(说话人1 → 真名) */
  rename: authedProcedure.input(RenameSpeakerInput).mutation(async ({ ctx, input }) => {
    const sp = await ctx.db.query.speakers.findFirst({ where: eq(speakers.id, input.speakerId) })
    if (!sp) throw new TRPCError({ code: 'NOT_FOUND' })
    await requireMinuteRole(ctx.db, sp.minuteId, ctx.userId, 'EDITOR')
    await ctx.db
      .update(speakers)
      .set({ displayName: input.displayName, isRenamed: true })
      .where(eq(speakers.id, input.speakerId))
    return { ok: true }
  }),

  /** 把某句段重新归属到另一个说话人(对齐飞书「重新识别」的人工纠正) */
  reassignSegment: authedProcedure
    .input(z.object({ segmentId: z.string().uuid(), speakerId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const seg = await ctx.db.query.segments.findFirst({ where: eq(segments.id, input.segmentId) })
      if (!seg) throw new TRPCError({ code: 'NOT_FOUND' })
      await requireMinuteRole(ctx.db, seg.minuteId, ctx.userId, 'EDITOR')
      const target = await ctx.db.query.speakers.findFirst({ where: eq(speakers.id, input.speakerId) })
      if (!target || target.minuteId !== seg.minuteId)
        throw new TRPCError({ code: 'BAD_REQUEST', message: '说话人不属于此妙记' })
      await ctx.db
        .update(segments)
        .set({ speakerId: input.speakerId })
        .where(eq(segments.id, input.segmentId))
      return { ok: true }
    })
})
