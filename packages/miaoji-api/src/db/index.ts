import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.js'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://miaoji:miaoji@localhost:5432/miaoji'

export const sql = postgres(DATABASE_URL, {
  max: Number(process.env.DB_POOL_MAX ?? 10)
})

export const db = drizzle(sql, { schema })

export type DB = typeof db
