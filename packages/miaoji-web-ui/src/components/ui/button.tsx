'use client'
import * as React from 'react'
import clsx from 'clsx'

type Variant = 'primary' | 'ghost' | 'outline' | 'danger'
type Size = 'sm' | 'md'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

const VARIANT: Record<Variant, string> = {
  primary: 'bg-mj-primary text-white hover:opacity-90 disabled:opacity-50',
  ghost: 'text-mj-ink-soft hover:bg-mj-surface-2 disabled:opacity-50',
  outline: 'border border-mj-border-strong text-mj-ink hover:bg-mj-surface-2 disabled:opacity-50',
  danger: 'bg-mj-accent text-white hover:opacity-90 disabled:opacity-50'
}

const SIZE: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2'
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'outline', size = 'md', className, type = 'button', ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={clsx(
        'inline-flex items-center justify-center rounded-[var(--mj-radius)] font-medium transition select-none disabled:cursor-not-allowed',
        VARIANT[variant],
        SIZE[size],
        className
      )}
      {...rest}
    />
  )
})
