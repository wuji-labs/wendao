// Wendao frontend · runtime config singleton (injected by MiaojiProviders).
// The standalone app and any embedding host each pass their own proxy prefix + session identity.
export interface MiaojiConfig {
  /** tRPC 端点(同源代理) */
  trpcUrl: string
  /** 上传端点 */
  uploadUrl: string
  /** 媒体静态前缀 */
  mediaBase: string
  /** 上传直连的 API 源(绕开 dev 代理 · 大文件流式上传必需);空 = 走 uploadUrl 同源代理 */
  apiBase: string
  /** Route prefix: standalone app = '' (/m/, /clip/); embedded host = e.g. '/miaoji' */
  routeBase: string
  /** 当前用户 id(作 x-user-id) */
  userId: string
}

export const miaojiConfig: MiaojiConfig = {
  trpcUrl: '/trpc',
  uploadUrl: '/upload',
  mediaBase: '/media',
  apiBase: '',
  routeBase: '',
  userId: ''
}

export function setMiaojiConfig(patch: Partial<MiaojiConfig>): void {
  Object.assign(miaojiConfig, patch)
}
