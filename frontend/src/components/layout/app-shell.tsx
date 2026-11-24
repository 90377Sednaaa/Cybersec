import { useCallback, useState } from "react"
import { Link, NavLink, Outlet, useLocation } from "react-router-dom"
import {
  BookOpen,
  Crosshair,
  LayoutDashboard,
  LogOut,
  Moon,
  Plus,
  Radar,
  Settings,
  ShieldAlert,
  Sun,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

import logo from "@/assets/aletheia-logo.png"
import { QuickAssessmentDialog } from "@/components/quick-assessment-dialog"
import { ShortcutsMenu } from "@/components/shortcuts-menu"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import { NAV_SHORTCUTS, useAppShortcuts, useShowShortcutHints } from "@/lib/shortcuts"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { useAuth } from "@/lib/auth"
import { useTheme } from "@/lib/theme"

/** Icons live here; the route, label and chord key all come from NAV_SHORTCUTS. */
const NAV_ICONS: Record<string, LucideIcon> = {
  "/": LayoutDashboard,
  "/targets": Crosshair,
  "/assessments": Radar,
  "/findings": ShieldAlert,
  "/settings": Settings,
}

function HeaderBreadcrumb() {
  const { pathname } = useLocation()
  const segments = pathname.split("/").filter(Boolean)

  if (segments.length === 0) {
    return (
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbPage className="font-medium">Dashboard</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    )
  }

  const rootLabels: Record<string, string> = {
    targets: "Targets",
    assessments: "Assessments",
    findings: "Findings",
    settings: "AI Settings",
  }
  const root = segments[0]
  const rootLabel = rootLabels[root] ?? root
  const detailId = segments[1]

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem className="hidden sm:inline-flex">
          <BreadcrumbLink asChild>
            <Link to="/">Aletheia</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator className="hidden sm:inline-flex" />
        {detailId ? (
          <>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to={`/${root}`}>{rootLabel}</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage className="font-mono text-xs font-medium">
                {root === "assessments" ? `Run #${detailId}` : `#${detailId}`}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </>
        ) : (
          <BreadcrumbItem>
            <BreadcrumbPage className="font-medium">{rootLabel}</BreadcrumbPage>
          </BreadcrumbItem>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  )
}

function BrandHeader() {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size="lg" className="pointer-events-none" tabIndex={-1}>
          <img src={logo} alt="Aletheia logo" className="size-8 shrink-0 object-contain" />
          <div className="grid flex-1 text-left leading-tight">
            <span className="truncate font-semibold">Aletheia</span>
            <span className="truncate text-xs text-muted-foreground">Security assessment platform</span>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

function NavMenu() {
  const [showHints] = useShowShortcutHints()

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Platform</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {NAV_SHORTCUTS.map(({ to, label, key }) => {
            const Icon = NAV_ICONS[to] ?? LayoutDashboard
            return (
              <SidebarMenuItem key={to}>
                <NavLink to={to} end={to === "/"}>
                  {({ isActive }) => (
                    <SidebarMenuButton isActive={isActive} tooltip={`${label} (g then ${key})`}>
                      <Icon className="size-4" />
                      <span>{label}</span>
                      {showHints ? (
                        <kbd className="ml-auto shrink-0 rounded border bg-muted px-1.5 font-mono text-[10px] font-normal text-muted-foreground/70 group-data-[collapsible=icon]:hidden">
                          g {key}
                        </kbd>
                      ) : null}
                    </SidebarMenuButton>
                  )}
                </NavLink>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

function initials(name: string, email: string) {
  const source = name.trim() || email
  return source.slice(0, 2).toUpperCase()
}

function UserFooter() {
  const { user, logout } = useAuth()
  if (!user) return null

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" tooltip={user.full_name || user.email}>
              <Avatar className="size-8">
                <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
                  {initials(user.full_name, user.email)}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate text-sm font-medium">{user.full_name || user.email}</span>
                <span className="truncate text-xs capitalize text-muted-foreground">{user.role}</span>
              </div>
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-(--radix-dropdown-menu-trigger-width)">
            <DropdownMenuLabel className="font-normal">
              <p className="text-sm font-medium">{user.full_name || user.email}</p>
              <p className="text-xs text-muted-foreground">{user.email}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={logout} variant="destructive">
                <LogOut className="size-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

function ThemeToggle() {
  const { theme, toggle } = useTheme()
  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle color theme">
      {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  )
}

export function AppShell() {
  const { hasRole } = useAuth()
  const canScan = hasRole("admin", "assessor")
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [quickScanOpen, setQuickScanOpen] = useState(false)
  const toggleShortcuts = useCallback(() => setShortcutsOpen((prev) => !prev), [])
  const openQuickScan = useCallback(() => {
    if (canScan) setQuickScanOpen(true)
  }, [canScan])

  useAppShortcuts({ onToggleHelp: toggleShortcuts, onNewScan: openQuickScan })

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <BrandHeader />
        </SidebarHeader>
        <SidebarContent>
          <NavMenu />
        </SidebarContent>
        <SidebarFooter>
          <UserFooter />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset className="min-w-0">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60 sm:px-6">
          <SidebarTrigger aria-label="Toggle sidebar" />
          <Separator orientation="vertical" className="mr-2 !h-4" />
          <div className="min-w-0 flex-1">
            <HeaderBreadcrumb />
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            {canScan && (
              <Button size="sm" onClick={() => setQuickScanOpen(true)} className="mr-1">
                <Plus data-icon="inline-start" />
                <span className="hidden sm:inline">New scan</span>
              </Button>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="User Guide" asChild>
                  <Link to="/guide">
                    <BookOpen className="size-4" />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>User Guide</TooltipContent>
            </Tooltip>
            <ShortcutsMenu open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
            <ThemeToggle />
          </div>
        </header>
        <main className="flex-1 overflow-auto p-6 lg:p-8">
          <div className="mx-auto w-full max-w-7xl">
            <Outlet />
          </div>
        </main>
        <QuickAssessmentDialog open={quickScanOpen} onOpenChange={setQuickScanOpen} />
      </SidebarInset>
    </SidebarProvider>
  )
}
