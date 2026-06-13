import type { Metadata } from 'next'
import './globals.css'
import { MiaojiProviders } from '@wuji/miaoji-web-ui'

export const metadata: Metadata = {
  title: 'Wendao · Self-hosted Meeting Transcription',
  description: 'Self-hosted meeting & media transcription with speaker diarization and AI minutes.'
}

// Standalone app: a fixed dev user (matches the backend seed), empty route prefix → /m/, /clip/.
const DEV_USER_ID = process.env.NEXT_PUBLIC_MIAOJI_USER_ID ?? '00000000-0000-0000-0000-000000000001'
// Uploads connect directly to the API origin (avoids the Next dev proxy's ~30s limit on large
// files); GET media still goes through the same-origin rewrite.
const API_BASE = process.env.NEXT_PUBLIC_MIAOJI_API_BASE ?? 'http://127.0.0.1:3100'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <MiaojiProviders userId={DEV_USER_ID} routeBase="" apiBase={API_BASE}>
          {children}
        </MiaojiProviders>
      </body>
    </html>
  )
}
