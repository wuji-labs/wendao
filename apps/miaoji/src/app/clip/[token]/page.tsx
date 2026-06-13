'use client'
import { use } from 'react'
import { MiaojiClip } from '@wuji/miaoji-web-ui'

export default function ClipPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  return <MiaojiClip token={token} />
}
