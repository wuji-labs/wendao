'use client'
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { httpBatchLink } from '@trpc/client'
import { trpc } from './lib/trpc'
import { miaojiConfig, setMiaojiConfig, type MiaojiConfig } from './lib/config'

/**
 * 闻道前端根 providers · 作用域仅限挂载子树,不触宿主全局 providers。
 * 宿主传 userId(= 会话身份)+ 可选的代理前缀 / routeBase 覆盖默认值。
 */
export function MiaojiProviders({
  userId,
  trpcUrl,
  uploadUrl,
  mediaBase,
  apiBase,
  routeBase,
  children
}: { userId: string; children: React.ReactNode } & Partial<Omit<MiaojiConfig, 'userId'>>) {
  // 同步注入(在任何 trpc 调用 / 渲染前生效)
  const patch: Partial<MiaojiConfig> = { userId }
  if (trpcUrl !== undefined) patch.trpcUrl = trpcUrl
  if (uploadUrl !== undefined) patch.uploadUrl = uploadUrl
  if (mediaBase !== undefined) patch.mediaBase = mediaBase
  if (apiBase !== undefined) patch.apiBase = apiBase
  if (routeBase !== undefined) patch.routeBase = routeBase
  setMiaojiConfig(patch)

  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 10_000, refetchOnWindowFocus: false, retry: 1 } }
      })
  )
  const [client] = React.useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: miaojiConfig.trpcUrl,
          headers: () => ({ 'x-user-id': miaojiConfig.userId })
        })
      ]
    })
  )

  return (
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  )
}
