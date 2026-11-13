import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { cn } from "cn"

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  action?: ReactNode
  className?: string
}

/**
 * One empty state for the whole app, so "nothing here yet" reads the same on
 * every page instead of four slightly different blocks.
 */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center gap-1.5 px-4 py-10 text-center", className)}>
      {Icon && (
        <span className="mb-1 flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="size-4" />
        </span>
      )}
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-sm text-xs text-muted-foreground">{description}</p>}
      {action}
    </div>
  )
}
