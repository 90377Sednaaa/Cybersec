import { useState } from "react"
import type { FormEvent } from "react"
import { useLocation, useNavigate } from "react-router-dom"

import logo from "@/assets/aletheia-logo.png"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import GradientASCII from "@/components/GradientASCII"
import { useAuth } from "@/lib/auth"
import { useTheme } from "@/lib/theme"

export function LoginPage() {
  const { login } = useAuth()
  const { theme } = useTheme()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // GradientASCII backdrop ramp, dimmest to brightest, held to the locked
  // brand blue (oklch 0.55 0.2 262) from index.css in both themes.
  const asciiColors =
    theme === "dark"
      ? ["oklch(0.3 0.1 262)", "oklch(0.45 0.17 262)", "oklch(0.55 0.2 262)", "oklch(0.75 0.12 250)"]
      : ["oklch(0.9 0.045 255)", "oklch(0.8 0.09 258)", "oklch(0.66 0.15 260)", "oklch(0.52 0.2 262)"]

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(email, password)
      // Restore a deep link lost to the api.ts session-expiry hard navigation,
      // falling back to ProtectedRoute's router state for normal redirects.
      const stored = sessionStorage.getItem("aletheia-return-to")
      sessionStorage.removeItem("aletheia-return-to")
      const from =
        (location.state as { from?: string } | null)?.from ??
        (stored && stored !== "/login" ? stored : "/")
      navigate(from, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background p-4">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,--theme(--color-primary/10%),transparent_70%)]"
      />
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <GradientASCII
          colors={asciiColors}
          lightMode={theme !== "dark"}
          shape="horizon"
          cellSize={18}
          density={0.8}
          gradientOpacity={0.75}
          glow={0.25}
          speed={0.9}
          scale={1.2}
        />
      </div>
      <Card className="relative w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <img src={logo} alt="Aletheia logo" className="mx-auto size-16 object-contain" />
          <CardTitle className="text-2xl font-semibold tracking-tight">Aletheia</CardTitle>
          <CardDescription>AI-assisted security assessment. Sign in to continue.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="assessor@example.com"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" className="w-full active:scale-[0.99]" disabled={submitting}>
              {submitting ? "Signing in" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
