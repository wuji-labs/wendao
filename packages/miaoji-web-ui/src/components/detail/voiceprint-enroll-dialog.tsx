'use client'
import * as React from 'react'
import { Mic, Square, RotateCcw, Check } from 'lucide-react'
import { Modal, Btn, TextInput, Spinner } from './ui'
import { trpc } from '../../lib/trpc'
import { uploadMedia } from '../../lib/upload'
import { toast } from 'sonner'

// 读这段话录入声纹:覆盖足够音素 + 时长足够,比从会议里抠一句强得多。
const ENROLL_PASSAGE =
  '大家好,我来录一段声音用于识别。今天天气不错,我说几句话:从前山里有座小庙,庙里住着老和尚和小和尚。' +
  '我们一二三四五六七八九十,春夏秋冬,东南西北。请把这段话用平常说话的语速念完。'

const MIN_SEC = 10 // 建议时长(后端按「有效语音 ≥8s」门控)

export function VoiceprintEnrollDialog({
  open,
  onClose,
  defaultName = '',
  onEnrolled
}: {
  open: boolean
  onClose: () => void
  defaultName?: string
  onEnrolled?: (voiceprintId: string) => void
}): React.ReactElement {
  const [name, setName] = React.useState(defaultName)
  const [phase, setPhase] = React.useState<'idle' | 'recording' | 'recorded'>('idle')
  const [seconds, setSeconds] = React.useState(0)
  const [blob, setBlob] = React.useState<Blob | null>(null)
  const [busy, setBusy] = React.useState(false)

  const mediaRef = React.useRef<MediaRecorder | null>(null)
  const chunksRef = React.useRef<Blob[]>([])
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null)
  const streamRef = React.useRef<MediaStream | null>(null)
  const audioUrl = React.useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob])

  React.useEffect(() => {
    setName(defaultName)
  }, [defaultName])

  const cleanup = React.useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    mediaRef.current = null
  }, [])

  React.useEffect(() => () => cleanup(), [cleanup])

  const reset = () => {
    cleanup()
    setPhase('idle')
    setSeconds(0)
    setBlob(null)
    setBusy(false)
  }

  const close = () => {
    if (busy) return
    reset()
    onClose()
  }

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }
      })
      streamRef.current = stream
      chunksRef.current = []
      const mr = new MediaRecorder(stream)
      mr.ondataavailable = e => e.data.size > 0 && chunksRef.current.push(e.data)
      mr.onstop = () => {
        setBlob(new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' }))
        setPhase('recorded')
      }
      mediaRef.current = mr
      mr.start()
      setPhase('recording')
      setSeconds(0)
      timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000)
    } catch {
      toast.error('无法访问麦克风,请检查浏览器权限')
    }
  }

  const stopRecording = () => {
    if (timerRef.current) clearInterval(timerRef.current)
    mediaRef.current?.stop()
    streamRef.current?.getTracks().forEach(t => t.stop())
  }

  const enroll = trpc.voiceprint.enrollRecording.useMutation()
  const utils = trpc.useUtils()

  const submit = async () => {
    if (!blob || !name.trim()) return
    setBusy(true)
    try {
      const file = new File([blob], `voiceprint-${Date.now()}.webm`, { type: blob.type || 'audio/webm' })
      const up = await uploadMedia(file)
      const r = await enroll.mutateAsync({ name: name.trim(), mediaKey: up.mediaKey })
      toast.success(`已录入「${name.trim()}」声纹(有效语音 ${r.speechSec.toFixed(0)} 秒),以后会自动识别`)
      void utils.voiceprint.list.invalidate()
      onEnrolled?.(r.voiceprintId)
      reset()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '录入失败')
      setBusy(false)
    }
  }

  const tooShort = phase === 'recording' && seconds < MIN_SEC

  return (
    <Modal
      open={open}
      onClose={close}
      title="录音录入声纹"
      footer={
        phase === 'recorded' ? (
          <>
            <Btn variant="ghost" onClick={reset} disabled={busy}>
              <RotateCcw size={14} /> 重录
            </Btn>
            <Btn variant="primary" onClick={submit} disabled={busy || !name.trim()}>
              {busy ? <Spinner className="h-4 w-4" /> : <Check size={14} />} 录入
            </Btn>
          </>
        ) : (
          <Btn variant="ghost" onClick={close}>
            取消
          </Btn>
        )
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-mj-ink">姓名</span>
          <TextInput value={name} onChange={e => setName(e.target.value)} placeholder="这个人的名字" />
        </label>

        <div className="rounded-md border border-mj-border bg-mj-surface-2/40 p-3 text-sm leading-7 text-mj-ink-soft">
          <div className="mb-1 text-xs font-medium text-mj-ink-faint">
            请用平常语速,把下面这段话念完(约 20-30 秒):
          </div>
          {ENROLL_PASSAGE}
        </div>

        <div className="flex items-center justify-center gap-3 py-2">
          {phase === 'idle' && (
            <Btn variant="primary" onClick={startRecording}>
              <Mic size={16} /> 开始录音
            </Btn>
          )}
          {phase === 'recording' && (
            <>
              <span
                className={`font-mono text-lg tabular-nums ${tooShort ? 'text-mj-ink-faint' : 'text-mj-primary'}`}
              >
                {String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}
              </span>
              <Btn variant="primary" onClick={stopRecording} disabled={seconds < 1}>
                <Square size={14} /> 停止
              </Btn>
              <span className="text-xs text-mj-ink-faint">
                {tooShort ? `再说 ${MIN_SEC - seconds} 秒更稳` : '可以停止了'}
              </span>
            </>
          )}
          {phase === 'recorded' && audioUrl && (
            <audio controls src={audioUrl} className="w-full">
              <track kind="captions" />
            </audio>
          )}
        </div>
      </div>
    </Modal>
  )
}
