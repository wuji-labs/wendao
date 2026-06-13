import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { and, eq, inArray } from 'drizzle-orm'
import { router, authedProcedure, publicProcedure } from '../middleware.js'
import { segments, translations, minutes } from '../../db/schema.js'
import { requireMinuteRole, resolveMinuteRole } from '../../lib/permissions.js'
import { translateTexts } from '../../pipeline/ai-tasks.js'
import { Lang } from '@wuji/miaoji-contracts'

const BATCH = 40

export const translationRouter = router({
  /** 翻译整篇妙记到目标语言(缺失的句段才翻,已翻的跳过) */
  translateMinute: authedProcedure
    .input(z.object({ minuteId: z.string().uuid(), targetLang: Lang }))
    .mutation(async ({ ctx, input }) => {
      await requireMinuteRole(ctx.db, input.minuteId, ctx.userId, 'VIEWER')
      const segs = await ctx.db.query.segments.findMany({
        where: eq(segments.minuteId, input.minuteId),
        orderBy: (s, { asc }) => [asc(s.orderIndex)]
      })
      const existing = await ctx.db.query.translations.findMany({
        where: and(
          eq(translations.targetLang, input.targetLang),
          inArray(
            translations.segmentId,
            segs.map(s => s.id)
          )
        )
      })
      const have = new Set(existing.map(t => t.segmentId))
      const todo = segs.filter(s => !have.has(s.id) && s.text.trim())

      let translated = 0
      for (let i = 0; i < todo.length; i += BATCH) {
        const batch = todo.slice(i, i + BATCH)
        const out = await translateTexts(
          batch.map(s => s.text),
          input.targetLang
        )
        const values = batch
          .map((s, j) => ({ segmentId: s.id, targetLang: input.targetLang, text: out[j] ?? '' }))
          .filter(v => v.text)
        if (values.length > 0) {
          await ctx.db
            .insert(translations)
            .values(values)
            .onConflictDoNothing({ target: [translations.segmentId, translations.targetLang] })
          translated += values.length
        }
      }
      return { translated, total: segs.length }
    }),

  get: publicProcedure
    .input(z.object({ minuteId: z.string().uuid(), targetLang: Lang }))
    .query(async ({ ctx, input }) => {
      const role = await resolveMinuteRole(ctx.db, input.minuteId, ctx.userId)
      if (!role) throw new TRPCError({ code: 'FORBIDDEN' })
      const segs = await ctx.db.query.segments.findMany({
        where: eq(segments.minuteId, input.minuteId),
        columns: { id: true }
      })
      const trs = await ctx.db.query.translations.findMany({
        where: and(
          eq(translations.targetLang, input.targetLang),
          inArray(
            translations.segmentId,
            segs.map(s => s.id)
          )
        )
      })
      return trs
    })
})
