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
      richColors
      toastOptions={{
        classNames: {
          toast: "rounded-md border text-sm",
        },
      }}
    />
  )
}
