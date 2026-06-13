import clsx from 'clsx'
import { CheckCircle2, AlertCircle } from 'lucide-react'
import { STATUS_LABEL } from '../lib/format'
import { Spinner } from './ui/spinner'

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const label = STATUS_LABEL[status] ?? status
  const isReady = status === 'READY'
  const isFailed = status === 'FAILED'
  const isProcessing = !isReady && !isFailed

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        isReady && 'bg-[color-mix(in_srgb,var(--color-mj-positive)_12%,transparent)] text-mj-positive',
        isFailed && 'bg-[color-mix(in_srgb,var(--color-mj-accent)_12%,transparent)] text-mj-accent',
        isProcessing && 'bg-mj-primary-soft text-mj-primary',
        className
      )}
    >
      {isReady && <CheckCircle2 className="h-3 w-3" />}
      {isFailed && <AlertCircle className="h-3 w-3" />}
      {isProcessing && <Spinner className="h-3 w-3" />}
      {label}
    </span>
  )
}
