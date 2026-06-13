import type { FastifyRequest, FastifyReply } from 'fastify'
import { db, type DB } from '../db/index.js'

export interface Context {
  req: FastifyRequest
  res: FastifyReply
  db: DB
  /** 当前用户 id · null = 匿名 */
  userId: string | null
  requestId: string
}

export async function createContext({
  req,
  res
}: {
  req: FastifyRequest
  res: FastifyReply
}): Promise<Context> {
  const requestId = (req.headers['x-request-id'] as string) ?? req.id ?? crypto.randomUUID()
  // 内部工具 · 用 x-user-id header 传身份(后续可接 SSO/Better Auth)
  const userId = (req.headers['x-user-id'] as string | undefined) ?? null
  return { req, res, db, userId, requestId }
}
