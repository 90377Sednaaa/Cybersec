import { NavLink, Outlet, useNavigate } from "react-router-dom"
import { Crosshair, LayoutDashboard, Radar, Settings, ShieldAlert, ShieldCheck, LogOut } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { useAuth } from "@/lib/auth"
import type { Role } from "@/lib/types"

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/targets", label: "Targets", icon: Crosshair },
  { to: "/assessments", label: "Assessments", icon: Radar },
  { to: "/findings", label: "Findings", icon: ShieldAlert },
  { to: "/settings", label: "Settings", icon: Settings },
] as const

const ROLE_BADGE_VARIANT: Record<Role, "default" | "secondary" | "outline"> = {
  admin: "default",
  assessor: "secondary",
  viewer: "outline",
}

export function AppShell() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 flex-col border-r bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex items-center gap-2 px-4 py-5">
          <ShieldCheck className="size-6 text-sidebar-primary" />
          <div>
            <p className="text-sm font-semibold leading-tight">SecAssess</p>
            <p className="text-xs text-muted-foreground">AI-assisted assessment platform</p>
          </div>
        </div>
        <Separator />
        <nav className="flex flex-1 flex-col gap-1 p-2">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
                }`
              }
            >
              <Icon className="size-4" />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b px-6">
          <p className="text-sm text-muted-foreground">Security Assessment &amp; Vulnerability Analysis</p>
          {user && (
            <div className="flex items-center gap-3">
              <span className="text-sm">{user.full_name || user.email}</span>
              <Badge variant={ROLE_BADGE_VARIANT[user.role]}>{user.role}</Badge>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  logout()
                  navigate("/login")
                }}
              >
                <LogOut className="size-4" />
                Sign out
              </Button>
            </div>
          )}
        </header>
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
