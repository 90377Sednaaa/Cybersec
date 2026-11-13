import type { ReactNode } from "react"
import { CircleHelp } from "lucide-react"

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "cn"

interface HelpHintProps {
  /** Short heading shown as the first line of the explanation. */
  label: string
  /** The explanation: what this is for and what to write. */
  children: ReactNode
  className?: string
}

/**
 * Small question-mark icon that reveals an explanation when clicked.
 *
 * Click, not hover: inside a dialog a hover tooltip fires the moment the pointer
 * crosses the form, covering the fields it is meant to explain. A popover is also
 * reachable on touch, stays open long enough to read, and dismisses on Escape or
 * an outside click.
 */
export function HelpHint({ label, children, className }: HelpHintProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Help: ${label}`}
          className={cn(
            "inline-flex cursor-pointer items-center rounded-full text-muted-foreground/60 outline-none transition-colors",
            "hover:text-foreground focus-visible:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
            className,
          )}
        >
          <CircleHelp className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-80 space-y-1 text-xs leading-relaxed">
        <p className="font-medium">{label}</p>
        <p className="text-muted-foreground">{children}</p>
      </PopoverContent>
    </Popover>
  )
}
