/** @type {import('next').NextConfig} */
const API_URL = process.env.MIAOJI_API_URL ?? 'http://127.0.0.1:3100'

// Allow LAN dev access (phones / other machines). Next 16 blocks cross-origin dev
// assets by default, which breaks hydration ("page won't respond"). Set
// NEXT_PUBLIC_DEV_ORIGINS to a comma-separated list of LAN hosts/IPs to allow them.
const DEV_ORIGINS = (process.env.NEXT_PUBLIC_DEV_ORIGINS ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

const nextConfig = {
  reactStrictMode: true,
  ...(DEV_ORIGINS.length ? { allowedDevOrigins: DEV_ORIGINS } : {}),
  // Shared UI + contracts (runtime); miaoji-api only contributes the AppRouter type (import type, erased).
  transpilePackages: ['@wuji/miaoji-contracts', '@wuji/miaoji-web-ui'],
  typescript: { ignoreBuildErrors: false },
  async rewrites() {
    // Same-origin proxy from the frontend to the backend · avoids CORS + simplifies fetch.
    return [
      { source: '/trpc/:path*', destination: `${API_URL}/trpc/:path*` },
      { source: '/upload', destination: `${API_URL}/upload` },
      { source: '/media/:path*', destination: `${API_URL}/media/:path*` }
    ]
  }
}

export default nextConfig
