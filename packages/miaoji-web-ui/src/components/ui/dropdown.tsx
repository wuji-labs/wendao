'use client'
import * as React from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'

export interface DropdownProps {
  trigger: React.ReactNode
  children: React.ReactNode
  align?: 'left' | 'right'
  menuClassName?: string
}

/** 点击展开的菜单 · 菜单经 portal 渲染到 body(fixed 定位),不被卡片 overflow/圆角裁切、永远在最上层 */
export function Dropdown({ trigger, children, align = 'right', menuClassName }: DropdownProps) {
  const [open, setOpen] = React.useState(false)
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null)
  const btnRef = React.useRef<HTMLButtonElement>(null)
  const menuRef = React.useRef<HTMLDivElement>(null)

  const place = React.useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    const menuW = 176 // min-w-44
    const left = align === 'right' ? Math.max(8, r.right - menuW) : r.left
    setPos({ top: r.bottom + 4, left })
  }, [align])

  React.useEffect(() => {
    if (!open) return
    place()
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const onScroll = () => setOpen(false)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open, place])

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={e => {
          e.stopPropagation()
          e.preventDefault()
          setOpen(o => !o)
        }}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {trigger}
      </button>
      {open &&
        pos &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            onClick={e => {
              e.stopPropagation()
              setOpen(false)
            }}
            style={{ position: 'fixed', top: pos.top, left: pos.left }}
            className={clsx(
              'z-[1000] min-w-44 overflow-hidden rounded-[var(--mj-radius)] border border-mj-border bg-mj-surface py-1 shadow-[var(--mj-shadow-pop)]',
              menuClassName
            )}
          >
            {children}
          </div>,
          document.body
        )}
    </>
  )
}

export interface DropdownItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  danger?: boolean
}

export function DropdownItem({ danger, className, children, ...rest }: DropdownItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      className={clsx(
        'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition',
        danger ? 'text-mj-accent hover:bg-mj-accent-soft' : 'text-mj-ink hover:bg-mj-surface-2',
        className
      )}
      {...rest}
    >
      {children}
    </button>
  )
}
