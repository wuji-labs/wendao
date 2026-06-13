import { customAlphabet } from 'nanoid'

// 无歧义字符集 · 生成妙记/片段短 token
const alphabet = '0123456789abcdefghijkmnpqrstuvwxyz'
const gen = customAlphabet(alphabet, 16)

export function newToken(): string {
  return gen()
}
