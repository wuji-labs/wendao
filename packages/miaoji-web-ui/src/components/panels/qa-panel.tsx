'use client'
import * as React from 'react'
import clsx from 'clsx'
import { Send, Quote, Plus, MessageCircle } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { fmtClock } from '../../lib/format'
import { seek } from '../../lib/player-store'
import { Btn, IconBtn, TextInput, Spinner, Popover, MenuItem } from '../detail/ui'

interface Citation {
  segmentId: string
  startMs: number
  snippet: string
}
interface ChatMessage {
  role: string
  content: string
  citations: Citation[]
}

interface QaPanelProps {
  minuteId: string
}

export function QaPanel({ minuteId }: QaPanelProps): React.ReactElement {
  const [threadId, setThreadId] = React.useState<string | null>(null)
  const [input, setInput] = React.useState('')
  const [localMsgs, setLocalMsgs] = React.useState<ChatMessage[]>([])
  const listEndRef = React.useRef<HTMLDivElement>(null)

  const threads = trpc.qa.listThreads.useQuery({ minuteId })
  const thread = trpc.qa.getThread.useQuery({ threadId: threadId ?? '' }, { enabled: !!threadId })
  const ask = trpc.qa.ask.useMutation()

  // 已有线程的历史消息(来自服务端) · 新提问乐观追加到 localMsgs
  const serverMsgs: ChatMessage[] = thread.data?.messages ?? []

  React.useEffect(() => {
    // 切换线程时清空本地乐观队列
    setLocalMsgs([])
  }, [threadId])

  const msgs = threadId ? serverMsgs : localMsgs

  React.useEffect(() => {
    listEndRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [msgs.length, ask.isPending])

  function submit(): void {
    const q = input.trim()
    if (!q || ask.isPending) return
    setInput('')
    const userMsg: ChatMessage = { role: 'user', content: q, citations: [] }
    if (!threadId) setLocalMsgs(prev => [...prev, userMsg])
    ask.mutate(
      { minuteId, threadId: threadId ?? undefined, question: q },
      {
        onSuccess: res => {
          if (!threadId) {
            setThreadId(res.threadId)
            // 线程视图接管 · localMsgs 由 effect 清空, getThread 拉取全量
          }
          void thread.refetch()
          void threads.refetch()
        }
      }
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-mj-border px-4 py-2.5">
        <span className="text-sm font-medium text-mj-ink">与闻道对话</span>
        <div className="ml-auto flex items-center gap-1">
          <IconBtn
            label="新对话"
            className="h-8 w-8"
            onClick={() => {
              setThreadId(null)
              setLocalMsgs([])
            }}
          >
            <Plus size={16} />
          </IconBtn>
          {(threads.data?.length ?? 0) > 0 && (
            <Popover
              align="right"
              trigger={(open, toggle) => (
                <IconBtn label="历史对话" active={open} className="h-8 w-8" onClick={toggle}>
                  <MessageCircle size={16} />
                </IconBtn>
              )}
            >
              {close => (
                <div className="max-h-64 min-w-[14rem] overflow-auto">
                  {threads.data?.map(th => {
                    const t = th as { id?: string; threadId?: string; title?: string }
                    const tid = t.id ?? t.threadId ?? ''
                    return (
                      <MenuItem
                        key={tid}
                        active={tid === threadId}
                        onClick={() => {
                          setThreadId(tid)
                          close()
                        }}
                      >
                        <span className="truncate">{t.title ?? '历史对话'}</span>
                      </MenuItem>
                    )
                  })}
                </div>
              )}
            </Popover>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
        {msgs.length === 0 && !ask.isPending && (
          <div className="py-10 text-center text-sm text-mj-ink-faint">
            就这段内容向闻道提问，回答会附上原文出处。
          </div>
        )}
        {msgs.map((m, i) => (
          <MessageBubble key={i} msg={m} />
        ))}
        {ask.isPending && (
          <div className="flex items-center gap-2 text-sm text-mj-ink-faint">
            <Spinner className="h-4 w-4" /> 闻道正在思考…
          </div>
        )}
        <div ref={listEndRef} />
      </div>

      <div className="border-t border-mj-border p-3">
        <div className="flex items-center gap-2">
          <TextInput
            value={input}
            placeholder="输入问题…"
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault()
                submit()
              }
            }}
          />
          <Btn variant="primary" size="md" onClick={submit} disabled={!input.trim() || ask.isPending}>
            <Send size={15} />
          </Btn>
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ msg }: { msg: ChatMessage }): React.ReactElement {
  const isUser = msg.role === 'user'
  return (
    <div className={clsx('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div className={clsx('max-w-[85%] space-y-2')}>
        <div
          className={clsx(
            'rounded-[var(--mj-radius)] px-3 py-2 text-sm leading-7',
            isUser ? 'bg-mj-primary text-white' : 'bg-mj-surface-2 text-mj-ink'
          )}
        >
          {msg.content}
        </div>
        {!isUser && msg.citations.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {msg.citations.map((c, i) => (
              <button
                key={i}
                type="button"
                onClick={() => seek(c.startMs)}
                title={c.snippet}
                className="inline-flex max-w-[12rem] items-center gap-1 rounded-full border border-mj-border bg-mj-surface px-2 py-0.5 text-[11px] text-mj-ink-soft hover:border-mj-primary hover:text-mj-primary"
              >
                <Quote size={11} className="shrink-0" />
                <span className="font-mono tabular-nums">{fmtClock(c.startMs)}</span>
                <span className="truncate">{c.snippet}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default QaPanel
