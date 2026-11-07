import type { ReactNode } from "react"
import { CircleHelp } from "lucide-react"

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "cn"

interface HelpHintProps {
  /** Short heading shown as the first line of the tooltip. */
  label: string
  /** The explanation: what this is for and what to write. */
  children: ReactNode
  className?: string
}

/**
 * Small question-mark icon that reveals an explanation on hover or keyboard
 * focus. Used next to form labels and headings where the purpose or expected
 * input is not self-evident.
 */
export function HelpHint({ label, children, className }: HelpHintProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`Help: ${label}`}
            className={cn(
              "inline-flex cursor-help items-center text-muted-foreground/60 outline-none transition-colors",
              "hover:text-foreground focus-visible:text-foreground",
              className,
            )}
          >
            <CircleHelp className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" align="start" className="max-w-80 text-start leading-relaxed">
          <p className="font-medium">{label}</p>
          <p className="opacity-80">{children}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
