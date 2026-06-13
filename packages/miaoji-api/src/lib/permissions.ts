// 权限判定 · owner / 协作者角色 / 链接范围。内部工具,规则从严到松。
import { and, eq } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import type { DB } from '../db/index.js'
import { minutes, collaborators } from '../db/schema.js'
import type { CollaboratorRole } from '@wuji/miaoji-contracts'

const ROLE_ORDER: Record<CollaboratorRole, number> = {
  VIEWER: 1,
  COMMENTER: 2,
  EDITOR: 3,
  MANAGER: 4
}

/** 解析某用户对某妙记的有效角色 · owner = MANAGER · 链接公开 = 至少 VIEWER */
export async function resolveMinuteRole(
  db: DB,
  minuteId: string,
  userId: string | null
): Promise<CollaboratorRole | null> {
  const minute = await db.query.minutes.findFirst({ where: eq(minutes.id, minuteId) })
  if (!minute) return null
  if (userId && minute.ownerId === userId) return 'MANAGER'

  if (userId) {
    const collab = await db.query.collaborators.findFirst({
      where: and(
        eq(collaborators.subjectType, 'MINUTE'),
        eq(collaborators.subjectId, minuteId),
        eq(collaborators.principalId, userId)
      )
    })
    if (collab) return collab.role
  }

  // 链接范围兜底
  if (minute.linkScope === 'ANYONE_VIEW' || minute.linkScope === 'TENANT_VIEW') return 'VIEWER'
  if (minute.linkScope === 'TENANT_EDIT') return userId ? 'EDITOR' : 'VIEWER'
  return null
}

export function roleAtLeast(role: CollaboratorRole | null, min: CollaboratorRole): boolean {
  return role !== null && ROLE_ORDER[role] >= ROLE_ORDER[min]
}

/** 守卫:要求至少某角色,否则抛错 */
export async function requireMinuteRole(
  db: DB,
  minuteId: string,
  userId: string | null,
  min: CollaboratorRole
): Promise<CollaboratorRole> {
  const role = await resolveMinuteRole(db, minuteId, userId)
  if (!roleAtLeast(role, min)) {
    throw new TRPCError({
      code: role === null ? 'NOT_FOUND' : 'FORBIDDEN',
      message: role === null ? '妙记不存在或无权访问' : `需要至少 ${min} 权限`
    })
  }
  return role as CollaboratorRole
}
