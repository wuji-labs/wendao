'use client'
import * as React from 'react'
import clsx from 'clsx'

/* 详情页自用微型基元 · 自包含 · 不与 components/ui 冲突 */

type BtnVariant = 'primary' | 'ghost' | 'outline' | 'danger' | 'soft'
type BtnSize = 'sm' | 'md'

const BTN_VARIANT: Record<BtnVariant, string> = {
  primary: 'bg-mj-primary text-white hover:opacity-90 disabled:opacity-50',
  ghost: 'text-mj-ink-soft hover:bg-mj-surface-2 disabled:opacity-50',
  outline: 'border border-mj-border-strong text-mj-ink hover:bg-mj-surface-2 disabled:opacity-50',
  danger: 'bg-mj-accent text-white hover:opacity-90 disabled:opacity-50',
  soft: 'bg-mj-primary-soft text-mj-primary hover:opacity-90 disabled:opacity-50'
}
const BTN_SIZE: Record<BtnSize, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2'
}

export interface DBtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant
  size?: BtnSize
}

export const Btn = React.forwardRef<HTMLButtonElement, DBtnProps>(function Btn(
  { variant = 'outline', size = 'md', className, type = 'button', ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={clsx(
        'inline-flex items-center justify-center rounded-[var(--mj-radius)] font-medium transition select-none disabled:cursor-not-allowed',
        BTN_VARIANT[variant],
        BTN_SIZE[size],
        className
      )}
      {...rest}
    />
  )
})

export interface IconBtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
  label?: string
}

export const IconBtn = React.forwardRef<HTMLButtonElement, IconBtnProps>(function IconBtn(
  { active, label, className, type = 'button', children, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      title={label}
      aria-label={label}
      className={clsx(
        'inline-flex h-9 w-9 items-center justify-center rounded-[var(--mj-radius)] transition disabled:opacity-40',
        active ? 'bg-mj-primary-soft text-mj-primary' : 'text-mj-ink-soft hover:bg-mj-surface-2',
        className
      )}
      {...rest}
    >
      {children}
    </button>
  )
})

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const TextInput = React.forwardRef<HTMLInputElement, InputProps>(function TextInput(
  { className, ...rest },
  ref
) {
  return (
    <input
      ref={ref}
      className={clsx(
        'h-9 w-full rounded-[var(--mj-radius)] border border-mj-border bg-mj-surface px-3 text-sm text-mj-ink outline-none placeholder:text-mj-ink-faint focus:border-mj-primary',
        className
      )}
      {...rest}
    />
  )
})

/** 轻量 popover · 点击外部关闭 · 锚定在子节点之下 */
export function Popover({
  trigger,
  children,
  align = 'right',
  className
}: {
  trigger: (open: boolean, toggle: () => void) => React.ReactNode
  children: (close: () => void) => React.ReactNode
  align?: 'left' | 'right'
  className?: string
}): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)
  const toggle = React.useCallback(() => setOpen(v => !v), [])
  const close = React.useCallback(() => setOpen(false), [])

  React.useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onEsc(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  return (
    <div ref={ref} className="relative inline-flex">
      {trigger(open, toggle)}
      {open && (
        <div
          className={clsx(
            'absolute top-full z-30 mt-2 min-w-[14rem] rounded-[var(--mj-radius)] border border-mj-border bg-mj-surface p-2 shadow-lg',
            align === 'right' ? 'right-0' : 'left-0',
            className
          )}
        >
          {children(close)}
        </div>
      )}
    </div>
  )
}

export function MenuItem({
  children,
  onClick,
  active,
  className
}: {
  children: React.ReactNode
  onClick?: () => void
  active?: boolean
  className?: string
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition',
        active ? 'bg-mj-primary-soft text-mj-primary' : 'text-mj-ink hover:bg-mj-surface-2',
        className
      )}
    >
      {children}
    </button>
  )
}

export function Toggle({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: string
}): React.ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition',
        checked ? 'bg-mj-primary' : 'bg-mj-border-strong'
      )}
    >
      <span
        className={clsx(
          'inline-block h-4 w-4 transform rounded-full bg-white transition',
          checked ? 'translate-x-4' : 'translate-x-0.5'
        )}
      />
    </button>
  )
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer
}: {
  open: boolean
  onClose: () => void
  title?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
}): React.ReactElement | null {
  React.useEffect(() => {
    if (!open) return
    function onEsc(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onEsc)
    return () => document.removeEventListener('keydown', onEsc)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-mj-ink/30" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-[var(--mj-radius)] border border-mj-border bg-mj-surface p-5 shadow-xl">
        {title && <div className="mb-3 text-base font-semibold text-mj-ink">{title}</div>}
        <div>{children}</div>
        {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  )
}

export interface TabItem {
  key: string
  label: React.ReactNode
}

export function Tabs({
  items,
  value,
  onChange,
  className
}: {
  items: TabItem[]
  value: string
  onChange: (k: string) => void
  className?: string
}): React.ReactElement {
  return (
    <div className={clsx('flex items-center gap-1 border-b border-mj-border', className)} role="tablist">
      {items.map(it => (
        <button
          key={it.key}
          type="button"
          role="tab"
          aria-selected={value === it.key}
          onClick={() => onChange(it.key)}
          className={clsx(
            '-mb-px border-b-2 px-3 py-2.5 text-sm font-medium transition',
            value === it.key
              ? 'border-mj-primary text-mj-primary'
              : 'border-transparent text-mj-ink-soft hover:text-mj-ink'
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}

export function Spinner({ className }: { className?: string }): React.ReactElement {
  return (
    <span
      className={clsx(
        'inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent',
        className
      )}
    />
  )
}

export function EmptyState({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div className="py-12 text-center text-sm text-mj-ink-faint">{children}</div>
}
