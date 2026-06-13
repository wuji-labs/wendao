import { TRPCError } from '@trpc/server'
import { eq } from 'drizzle-orm'
import { router, publicProcedure } from '../middleware.js'
import { minutes, segments, speakers, translations } from '../../db/schema.js'
import { resolveMinuteRole } from '../../lib/permissions.js'
import { renderExport, type ExportSegment } from '../../lib/export-render.js'
import { ExportInput } from '@wuji/miaoji-contracts'

export const exportRouter = router({
  /** 导出妙记 · 返回内容字符串 + mime + 文件名(前端触发下载) */
  minute: publicProcedure.input(ExportInput).query(async ({ ctx, input }) => {
    const role = await resolveMinuteRole(ctx.db, input.minuteId, ctx.userId)
    if (!role) throw new TRPCError({ code: 'FORBIDDEN' })
    const m = await ctx.db.query.minutes.findFirst({ where: eq(minutes.id, input.minuteId) })
    if (!m) throw new TRPCError({ code: 'NOT_FOUND' })

    const [segs, spk] = await Promise.all([
      ctx.db.query.segments.findMany({
        where: eq(segments.minuteId, input.minuteId),
        orderBy: (s, { asc }) => [asc(s.orderIndex)]
      }),
      ctx.db.query.speakers.findMany({ where: eq(speakers.minuteId, input.minuteId) })
    ])
    const name = new Map(spk.map(s => [s.id, s.displayName]))

    // 翻译导出
    let textBySeg = new Map<string, string>()
    if (input.lang && input.lang !== m.language) {
      const trs = await ctx.db.query.translations.findMany({
        where: (t, { and, eq: e, inArray }) =>
          and(
            e(t.targetLang, input.lang!),
            inArray(
              t.segmentId,
              segs.map(s => s.id)
            )
          )
      })
      textBySeg = new Map(trs.map(t => [t.segmentId, t.text]))
    }

    const rows: ExportSegment[] = segs.map(s => ({
      startMs: s.startMs,
      endMs: s.endMs,
      speaker: s.speakerId ? (name.get(s.speakerId) ?? null) : null,
      text: textBySeg.get(s.id) ?? s.text
    }))

    const rendered = renderExport(input.format, rows, {
      title: m.title || '未命名妙记',
      includeSpeaker: input.includeSpeaker,
      includeTimestamp: input.includeTimestamp
    })
    return { ...rendered, filename: `${m.title || 'minute'}.${rendered.ext}` }
  })
})
