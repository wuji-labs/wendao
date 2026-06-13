# Wendao backend (@wuji/miaoji-api)

Fastify + tRPC v11 + drizzle(postgres-js)。承载 Wendao 的数据模型、API 与处理流水线编排。

## 结构

```
src/
  db/schema.ts          16 表数据模型(对齐 @wuji/miaoji-contracts)
  db/index.ts           drizzle 连接
  trpc/                 context · middleware(publicProcedure/authedProcedure)· routers/*
  lib/                  config · storage · ffmpeg · asr-client · llm(Ollama)· permissions · token · export-render
  pipeline/             assemble(纯函数·句段化)· ai-tasks(Ollama 生成)· run(编排)· worker-loop(轮询)
  server.ts             Fastify 入口(/trpc · /upload · /media 静态)
  seed/                 dev 用户种子
drizzle/                迁移(drizzle-kit generate)
```

## tRPC 路由表

| 路由          | 过程                                                                                                                               |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `minute`      | create · list · getByToken · status · rename · move · setLinkScope · remove · reprocess · stats                                    |
| `transcript`  | editSegment · search                                                                                                               |
| `speaker`     | rename · reassignSegment                                                                                                           |
| `collab`      | addHighlight · removeHighlight · addComment · listComments · resolveComment · createClip · listClips · removeClip · getClipByToken |
| `ai`          | regenerateSummary · regenerateChapters · regenerateTodos · setTodoStatus                                                           |
| `qa`          | ask · listThreads · getThread                                                                                                      |
| `folder`      | create · list · rename · remove                                                                                                    |
| `translation` | translateMinute · get                                                                                                              |
| `export`      | minute(TXT/SRT/MD/DOCX)                                                                                                            |

身份:`x-user-id` header 进 context(内部工具,后续可接 SSO/Better Auth)。

## 命令

```bash
pnpm -F @wuji/miaoji-api dev          # API
pnpm -F @wuji/miaoji-api dev:worker   # 处理 worker
pnpm -F @wuji/miaoji-api db:generate  # 改 schema 后生成迁移
pnpm -F @wuji/miaoji-api db:migrate
pnpm -F @wuji/miaoji-api db:seed
pnpm -F @wuji/miaoji-api test         # vitest(纯逻辑回归)
pnpm -F @wuji/miaoji-api type-check
```

环境变量见 `.env.example`。
