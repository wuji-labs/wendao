import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { and, eq, sql } from 'drizzle-orm'
import { router, authedProcedure } from '../middleware.js'
import { folders, minutes } from '../../db/schema.js'

export const folderRouter = router({
  create: authedProcedure
    .input(z.object({ name: z.string().min(1).max(128), parentId: z.string().uuid().nullable().optional() }))
    .mutation(async ({ ctx, input }) => {
      const [f] = await ctx.db
        .insert(folders)
        .values({ name: input.name, ownerId: ctx.userId, parentId: input.parentId ?? null })
        .returning()
      return f
    }),

  list: authedProcedure
    .input(z.object({ parentId: z.string().uuid().nullable().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const conds = [eq(folders.ownerId, ctx.userId)]
      const parentId = input?.parentId
      if (parentId !== undefined) {
        conds.push(parentId === null ? sql`${folders.parentId} is null` : eq(folders.parentId, parentId))
      }
      return ctx.db.query.folders.findMany({ where: and(...conds), orderBy: (f, { asc }) => [asc(f.name)] })
    }),

  rename: authedProcedure
    .input(z.object({ id: z.string().uuid(), name: z.string().min(1).max(128) }))
    .mutation(async ({ ctx, input }) => {
      const f = await ctx.db.query.folders.findFirst({ where: eq(folders.id, input.id) })
      if (!f || f.ownerId !== ctx.userId) throw new TRPCError({ code: 'NOT_FOUND' })
      await ctx.db
        .update(folders)
        .set({ name: input.name, updatedAt: new Date() })
        .where(eq(folders.id, input.id))
      return { ok: true }
    }),

  remove: authedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const f = await ctx.db.query.folders.findFirst({ where: eq(folders.id, input.id) })
    if (!f || f.ownerId !== ctx.userId) throw new TRPCError({ code: 'NOT_FOUND' })
    // 内含妙记移回根目录(不级联删妙记)
    await ctx.db.update(minutes).set({ folderId: null }).where(eq(minutes.folderId, input.id))
    await ctx.db.delete(folders).where(eq(folders.id, input.id))
    return { ok: true }
  })
})
