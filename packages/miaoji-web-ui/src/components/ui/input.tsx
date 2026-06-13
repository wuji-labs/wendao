'use client'
import * as React from 'react'
import clsx from 'clsx'

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={clsx(
          'h-10 w-full rounded-[var(--mj-radius)] border border-mj-border bg-mj-surface px-3 text-sm text-mj-ink',
          'placeholder:text-mj-ink-faint outline-none transition',
          'focus:border-mj-primary focus:ring-2 focus:ring-[var(--color-mj-primary-soft)]',
          className
        )}
        {...rest}
      />
    )
  }
)

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <select
        ref={ref}
        className={clsx(
          'h-10 w-full rounded-[var(--mj-radius)] border border-mj-border bg-mj-surface px-3 text-sm text-mj-ink',
          'outline-none transition focus:border-mj-primary focus:ring-2 focus:ring-[var(--color-mj-primary-soft)]',
          className
        )}
        {...rest}
      >
        {children}
      </select>
    )
  }
)
