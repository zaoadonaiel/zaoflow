import { clsx } from 'clsx'

type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info' | 'purple'

interface BadgeProps {
  children: React.ReactNode
  variant?: BadgeVariant
  className?: string
}

const variantClasses: Record<BadgeVariant, string> = {
  default: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-600',
  success: 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800',
  warning: 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800',
  error: 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800',
  info: 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800',
  purple: 'bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-400 border-brand-200 dark:border-brand-800',
}

export default function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border',
        variantClasses[variant],
        className
      )}
    >
      {children}
    </span>
  )
}

export function statusToBadgeVariant(status: string): BadgeVariant {
  const map: Record<string, BadgeVariant> = {
    draft: 'default',
    scheduled: 'info',
    publishing: 'warning',
    published: 'success',
    failed: 'error',
    connected: 'success',
    disconnected: 'default',
    error: 'error',
    active: 'success',
    inactive: 'default',
    success: 'success',
    pending: 'warning',
  }
  return map[status] ?? 'default'
}
