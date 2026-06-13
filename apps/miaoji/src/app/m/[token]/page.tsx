'use client'
import { use } from 'react'
import { MiaojiDetail } from '@wuji/miaoji-web-ui'

export default function MinutePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  return <MiaojiDetail token={token} />
}
