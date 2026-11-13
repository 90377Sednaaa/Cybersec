import { NavLink, Outlet } from "react-router-dom"
import {
  Crosshair,
  LayoutDashboard,
  LogOut,
  Moon,
  Radar,
  Settings,
  ShieldAlert,
  Sun,
} from "lucide-react"

import logo from "@/assets/aletheia-logo.png"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import { useAppShortcuts } from "@/lib/shortcuts"
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

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, shortcut: "d" },
  { to: "/targets", label: "Targets", icon: Crosshair, shortcut: "t" },
  { to: "/assessments", label: "Assessments", icon: Radar, shortcut: "a" },
  { to: "/findings", label: "Findings", icon: ShieldAlert, shortcut: "f" },
  { to: "/settings", label: "Settings", icon: Settings, shortcut: "s" },
] as const

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
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Platform</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {NAV_ITEMS.map(({ to, label, icon: Icon, shortcut }) => (
            <SidebarMenuItem key={to}>
              <NavLink to={to} end={to === "/"}>
                {({ isActive }) => (
                  <SidebarMenuButton isActive={isActive} tooltip={`${label} (g then ${shortcut})`}>
                    <Icon className="size-4" />
                    <span>{label}</span>
                    <kbd className="ml-auto shrink-0 rounded border bg-muted px-1.5 font-mono text-[10px] font-normal text-muted-foreground/70">
                      g {shortcut}
                    </kbd>
                  </SidebarMenuButton>
                )}
              </NavLink>
            </SidebarMenuItem>
          ))}
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
                <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">
                  {initials(user.full_name, user.email)}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate text-sm font-medium">{user.full_name || user.email}</span>
                <span className="truncate text-xs text-muted-foreground capitalize">{user.role}</span>
              </div>
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-(--radix-dropdown-menu-trigger-width)">
            <DropdownMenuLabel className="font-normal">
              <p className="text-sm font-medium">{user.full_name || user.email}</p>
              <p className="text-xs text-muted-foreground">{user.email}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout} variant="destructive">
              <LogOut className="size-4" />
              Sign out
            </DropdownMenuItem>
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
  useAppShortcuts()
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
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4">
          <SidebarTrigger aria-label="Toggle sidebar" />
          <Separator orientation="vertical" className="mr-1 !h-5" />
          <p className="text-sm text-muted-foreground">Security Assessment &amp; Vulnerability Analysis</p>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </header>
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
