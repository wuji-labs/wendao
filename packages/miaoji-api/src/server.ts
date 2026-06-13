import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify'
import { appRouter, createContext } from './trpc/index.js'
import { config } from './lib/config.js'
import { saveStream, ensureDir, pathForKey } from './lib/storage.js'

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  bodyLimit: 1024 * 1024 * 50,
  genReqId: req => (req.headers['x-request-id'] as string | undefined) ?? randomUUID()
})

async function main() {
  // Self-hosted LAN tool: always allow localhost + private network ranges
  // (192.168/10/172.16-31) so phones/other machines on the LAN can upload
  // without CORS errors. Non-LAN origins fall back to config.corsOrigin
  // (set CORS_ORIGIN when exposing the API publicly behind a reverse proxy).
  await app.register(cors, {
    origin: (origin, cb) => {
      if (
        !origin ||
        /^https?:\/\/(localhost|127\.0\.0\.1|(192\.168|10|172\.(1[6-9]|2\d|3[01]))\.)/.test(origin)
      ) {
        cb(null, true)
      } else {
        cb(null, config.corsOrigin)
      }
    },
    credentials: true
  })
  await app.register(multipart, { limits: { fileSize: 1024 * 1024 * 1024 * 4 } }) // 4GB

  // 媒体静态服务(支持 Range · 视频拖动) · 仅暴露 storageDir
  await ensureDir(pathForKey('uploads/.keep'))
  await app.register(fastifyStatic, { root: config.storageDir, prefix: '/media/', decorateReply: false })

  // 上传:multipart → 存储 → 返回 mediaKey(随后客户端调 trpc minute.create)
  app.post('/upload', async (req, reply) => {
    const data = await req.file()
    if (!data) return reply.code(400).send({ error: 'no file' })
    const id = randomUUID()
    const safeName = data.filename.replace(/[^\w.\-一-鿿]/g, '_')
    const key = `uploads/${id}/${safeName}`
    await saveStream(key, data.file)
    if (data.file.truncated) return reply.code(413).send({ error: 'file too large' })
    const mediaType = /\.(mp4|mov|avi|flv|wmv|mkv|webm)$/i.test(safeName) ? 'VIDEO' : 'AUDIO'
    return { mediaKey: key, filename: safeName, mediaType }
  })

  await app.register(fastifyTRPCPlugin, {
    prefix: '/trpc',
    trpcOptions: { router: appRouter, createContext }
  })

  app.get('/health', async () => ({
    status: 'ok',
    service: 'miaoji-api',
    version: '0.1.0',
    timestamp: new Date().toISOString()
  }))

  await app.listen({ port: config.port, host: config.host })
  app.log.info(`Wendao API listening on http://${config.host}:${config.port}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
