// 开发种子 · 建一个固定 dev 用户(与前端 DEV_USER_ID 对齐),方便本地直接用。
import { db, sql } from '../db/index.js'
import { users } from '../db/schema.js'

const DEV_USER_ID = '00000000-0000-0000-0000-000000000001'

async function main() {
  await db
    .insert(users)
    .values({ id: DEV_USER_ID, name: '开发者', email: null, avatarUrl: null })
    .onConflictDoNothing({ target: users.id })
  console.log(`seed done · dev user ${DEV_USER_ID}`)
  await sql.end()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
