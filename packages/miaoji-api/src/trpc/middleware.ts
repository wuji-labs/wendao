import { initTRPC, TRPCError } from '@trpc/server'
import type { Context } from './context.js'

const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        cause: error.cause instanceof Error ? error.cause.name : undefined
      }
    }
  }
})

export const router = t.router
export const middleware = t.middleware
export const publicProcedure = t.procedure

/** 强制登录 · 匿名 → UNAUTHORIZED */
export const authedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.userId) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: '需要先登录' })
  }
  return next({ ctx: { ...ctx, userId: ctx.userId } })
})
