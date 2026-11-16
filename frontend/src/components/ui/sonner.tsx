import { Toaster as SonnerToaster } from "sonner"

import { useTheme } from "@/lib/theme"

/**
 * App-wide toast host. Follows the same `dark` class the rest of the UI uses,
 * so toasts never appear in the wrong theme after a toggle.
 */
export function Toaster() {
  const { theme } = useTheme()
  return (
    <SonnerToaster
      theme={theme}
      position="bottom-right"
      closeButton
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-card group-[.toaster]:text-card-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg group-[.toaster]:rounded-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground font-medium",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          success:
            "group-[.toaster]:bg-card group-[.toaster]:text-card-foreground group-[.toaster]:border-border [&>[data-icon]]:text-emerald-500",
          error:
            "group-[.toaster]:bg-card group-[.toaster]:text-card-foreground group-[.toaster]:border-destructive/40 [&>[data-icon]]:text-destructive",
          info:
            "group-[.toaster]:bg-card group-[.toaster]:text-card-foreground group-[.toaster]:border-border [&>[data-icon]]:text-primary",
        },
      }}
    />
  )
}
