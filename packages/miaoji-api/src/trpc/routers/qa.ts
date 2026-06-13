import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { eq } from 'drizzle-orm'
import { router, authedProcedure } from '../middleware.js'
import { qaThreads, qaMessages } from '../../db/schema.js'
import { requireMinuteRole } from '../../lib/permissions.js'
import { buildLines } from '../../lib/transcript-lines.js'
import { answerQuestion } from '../../pipeline/ai-tasks.js'
import { AskInput, type QaCitation } from '@wuji/miaoji-contracts'

export const qaRouter = router({
  /** 与妙记对话 */
  ask: authedProcedure.input(AskInput).mutation(async ({ ctx, input }) => {
    await requireMinuteRole(ctx.db, input.minuteId, ctx.userId, 'VIEWER')

    // 取/建会话
    let threadId = input.threadId
    if (!threadId) {
      const [t] = await ctx.db
        .insert(qaThreads)
        .values({ minuteId: input.minuteId, createdBy: ctx.userId })
        .returning()
      if (!t) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' })
      threadId = t.id
    } else {
      const t = await ctx.db.query.qaThreads.findFirst({ where: eq(qaThreads.id, threadId) })
      if (!t || t.minuteId !== input.minuteId) throw new TRPCError({ code: 'BAD_REQUEST' })
    }

    const history = await ctx.db.query.qaMessages.findMany({
      where: eq(qaMessages.threadId, threadId),
      orderBy: (m, { asc }) => [asc(m.createdAt)]
    })

    // 存用户消息
    await ctx.db.insert(qaMessages).values({ threadId, role: 'user', content: input.question, citations: [] })

    const { lines, lineToSegId, segIdToStartMs } = await buildLines(ctx.db, input.minuteId)
    const result = await answerQuestion(
      lines,
      history.map(h => ({ role: h.role, content: h.content })),
      input.question
    )

    // 行号 → 引用
    const citations: QaCitation[] = []
    for (const ln of result.citationLineNos) {
      const segId = lineToSegId.get(ln)
      const line = lines.find(l => l.lineNo === ln)
      if (segId && line) {
        citations.push({
          segmentId: segId,
          startMs: segIdToStartMs.get(segId) ?? line.startMs,
          snippet: line.text.slice(0, 120)
        })
      }
    }

    const [assistantMsg] = await ctx.db
      .insert(qaMessages)
      .values({ threadId, role: 'assistant', content: result.answer, citations })
      .returning()

    return { threadId, message: assistantMsg }
  }),

  listThreads: authedProcedure
    .input(z.object({ minuteId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireMinuteRole(ctx.db, input.minuteId, ctx.userId, 'VIEWER')
      return ctx.db.query.qaThreads.findMany({
        where: eq(qaThreads.minuteId, input.minuteId),
        orderBy: (t, { desc }) => [desc(t.createdAt)]
      })
    }),

  getThread: authedProcedure
    .input(z.object({ threadId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const t = await ctx.db.query.qaThreads.findFirst({ where: eq(qaThreads.id, input.threadId) })
      if (!t) throw new TRPCError({ code: 'NOT_FOUND' })
      await requireMinuteRole(ctx.db, t.minuteId, ctx.userId, 'VIEWER')
      const msgs = await ctx.db.query.qaMessages.findMany({
        where: eq(qaMessages.threadId, input.threadId),
        orderBy: (m, { asc }) => [asc(m.createdAt)]
      })
      return { thread: t, messages: msgs }
    })
})
