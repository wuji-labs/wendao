'use client'
import * as React from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import clsx from 'clsx'

export interface DialogProps {
  open: boolean
  onClose: () => void
  title?: React.ReactNode
  children: React.ReactNode
  className?: string
}

/** 轻量可访问 modal · 背景遮罩 + Esc 关闭 + 打开时聚焦面板(focus-trap-lite) */
export function Dialog({ open, onClose, title, children, className }: DialogProps) {
  const [mounted, setMounted] = React.useState(false)
  const panelRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => setMounted(true), [])

  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // 打开时把焦点移入面板
    const t = window.setTimeout(() => panelRef.current?.focus(), 0)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
      window.clearTimeout(t)
    }
  }, [open, onClose])

  if (!mounted || !open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
    >
      <div className="fixed inset-0 bg-black/30 backdrop-blur-[1px]" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={clsx(
          'relative z-10 mt-12 w-full max-w-lg rounded-[calc(var(--mj-radius)+4px)] border border-mj-border bg-mj-surface p-6 shadow-xl outline-none sm:mt-0',
          className
        )}
      >
        {title != null && (
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-mj-ink">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
              className="-mr-1 rounded-md p-1 text-mj-ink-faint transition hover:bg-mj-surface-2 hover:text-mj-ink"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body
  )
}
