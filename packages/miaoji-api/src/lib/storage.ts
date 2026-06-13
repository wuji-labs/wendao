// 本地对象存储抽象 · key → 磁盘路径。生产可换 S3/OSS,接口保持 key 语义。
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { Readable } from 'node:stream'
import { config } from './config.js'

function keyToPath(key: string): string {
  // 防目录穿越
  const safe = key.replace(/\.\.(\/|\\|$)/g, '').replace(/^[/\\]+/, '')
  return resolve(join(config.storageDir, safe))
}

export async function ensureDir(p: string): Promise<void> {
  await mkdir(dirname(p), { recursive: true })
}

export function pathForKey(key: string): string {
  return keyToPath(key)
}

export async function saveBuffer(key: string, data: Buffer | Uint8Array): Promise<string> {
  const p = keyToPath(key)
  await ensureDir(p)
  await writeFile(p, data)
  return key
}

export async function saveStream(key: string, stream: Readable): Promise<string> {
  const p = keyToPath(key)
  await ensureDir(p)
  await pipeline(stream, createWriteStream(p))
  return key
}

export async function readKey(key: string): Promise<Buffer> {
  return readFile(keyToPath(key))
}

export async function keyExists(key: string): Promise<boolean> {
  try {
    await stat(keyToPath(key))
    return true
  } catch {
    return false
  }
}
