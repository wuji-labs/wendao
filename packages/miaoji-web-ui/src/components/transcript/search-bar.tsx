'use client'
import * as React from 'react'
import { Search, ChevronUp, ChevronDown, X } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { fmtClock } from '../../lib/format'
import { seek } from '../../lib/player-store'
import { TextInput, IconBtn, Spinner } from '../detail/ui'

interface SearchBarProps {
  minuteId: string
  onClose: () => void
  /** 命中后请求转写区滚动到该段 */
  onLocate: (segmentId: string) => void
}

export function SearchBar({ minuteId, onClose, onLocate }: SearchBarProps): React.ReactElement {
  const [raw, setRaw] = React.useState('')
  const [query, setQuery] = React.useState('')
  const [idx, setIdx] = React.useState(0)

  // 防抖
  React.useEffect(() => {
    const t = setTimeout(() => setQuery(raw.trim()), 250)
    return () => clearTimeout(t)
  }, [raw])

  const res = trpc.transcript.search.useQuery({ minuteId, query }, { enabled: query.length > 0 })
  const matches = res.data ?? []

  React.useEffect(() => {
    setIdx(0)
  }, [query])

  const go = React.useCallback(
    (next: number) => {
      if (matches.length === 0) return
      const n = ((next % matches.length) + matches.length) % matches.length
      setIdx(n)
      const m = matches[n]!
      seek(m.startMs)
      onLocate(m.id)
    },
    [matches, onLocate]
  )

  function onKey(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') {
      e.preventDefault()
      go(e.shiftKey ? idx - 1 : idx + 1)
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-[var(--mj-radius)] border border-mj-border bg-mj-surface px-3 py-2">
      <Search size={16} className="shrink-0 text-mj-ink-faint" />
      <TextInput
        autoFocus
        value={raw}
        placeholder="搜索转写内容"
        onChange={e => setRaw(e.target.value)}
        onKeyDown={onKey}
        className="h-7 border-0 px-0 focus:border-0"
      />
      <div className="flex shrink-0 items-center gap-1 text-xs tabular-nums text-mj-ink-faint">
        {res.isFetching && query ? (
          <Spinner className="h-3.5 w-3.5" />
        ) : query ? (
          <span>{matches.length > 0 ? `${idx + 1}/${matches.length}` : '0/0'}</span>
        ) : null}
      </div>
      <IconBtn label="上一个" onClick={() => go(idx - 1)} className="h-7 w-7" disabled={matches.length === 0}>
        <ChevronUp size={16} />
      </IconBtn>
      <IconBtn label="下一个" onClick={() => go(idx + 1)} className="h-7 w-7" disabled={matches.length === 0}>
        <ChevronDown size={16} />
      </IconBtn>
      {matches.length > 0 && (
        <span className="ml-1 max-w-[10rem] truncate font-mono text-[11px] text-mj-ink-faint">
          {fmtClock(matches[idx]?.startMs ?? 0)}
        </span>
      )}
      <IconBtn label="关闭" onClick={onClose} className="h-7 w-7">
        <X size={16} />
      </IconBtn>
    </div>
  )
}

export default SearchBar
