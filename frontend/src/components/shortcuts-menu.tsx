import type { ReactNode } from "react"
import { Keyboard } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { NAV_SHORTCUTS, useShowShortcutHints } from "@/lib/shortcuts"

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border bg-muted px-1 font-mono text-[11px] leading-none text-foreground/80">
      {children}
    </kbd>
  )
}

function ShortcutRow({ label, keys }: { label: string; keys: string[] }) {
  return (
    <li className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex shrink-0 items-center gap-1">
        {keys.map((key) => (
          <Kbd key={key}>{key}</Kbd>
        ))}
      </span>
    </li>
  )
}

/**
 * Keyboard reference, opened from the header (or with `?`).
 *
 * A popover rather than a modal on purpose: the "show hints in navigation"
 * switch lives here and edits the sidebar, which sits right behind the panel —
 * you can flip it and watch the nav change without closing anything.
 */
export function ShortcutsMenu({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [showHints, setShowHints] = useShowShortcutHints()

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Keyboard shortcuts">
          <Keyboard className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 gap-0 p-0">
        <div className="px-3 py-2.5">
          <p className="text-sm font-medium">Keyboard shortcuts</p>
          <p className="text-xs text-muted-foreground">Press g, then a key, to jump.</p>
        </div>
        <Separator />
        <ul className="space-y-1 px-3 py-2">
          {NAV_SHORTCUTS.map((item) => (
            <ShortcutRow key={item.key} label={item.label} keys={["g", item.key]} />
          ))}
        </ul>
        <Separator />
        <ul className="space-y-1 px-3 py-2">
          <ShortcutRow label="This panel" keys={["?"]} />
          <ShortcutRow label="Close panel" keys={["Esc"]} />
        </ul>
        <Separator />
        <div className="flex items-start justify-between gap-3 px-3 py-2.5">
          <label htmlFor="shortcut-hints" className="cursor-pointer select-none">
            <span className="block text-sm">Show hints in navigation</span>
            <span className="block text-xs text-muted-foreground">
              Adds g d, g t, … beside each item.
            </span>
          </label>
          <Switch
            id="shortcut-hints"
            checked={showHints}
            onCheckedChange={setShowHints}
            aria-label="Show shortcut hints in navigation"
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}
