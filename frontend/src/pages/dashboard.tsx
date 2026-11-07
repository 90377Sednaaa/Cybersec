import { useQuery } from "@tanstack/react-query"
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts"
import { Crosshair, Radar, ShieldAlert, ShieldCheck } from "lucide-react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/lib/api"
import type { Target } from "@/lib/types"

interface StatCardProps {
  title: string
  value: string
  icon: typeof Crosshair
  hint: string
}

function StatCard({ title, value, icon: Icon, hint }: StatCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <span className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="size-4" />
        </span>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  )
}

function StatCardSkeleton() {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="size-8 rounded-md" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-7 w-12" />
        <Skeleton className="mt-2 h-3 w-32" />
      </CardContent>
    </Card>
  )
}

const SEVERITY_DATA = [
  { severity: "Critical", count: 0, fill: "var(--severity-critical)" },
  { severity: "High", count: 0, fill: "var(--severity-high)" },
  { severity: "Medium", count: 0, fill: "var(--severity-medium)" },
  { severity: "Low", count: 0, fill: "var(--severity-low)" },
  { severity: "Info", count: 0, fill: "var(--severity-info)" },
]

export function DashboardPage() {
  const targets = useQuery({
    queryKey: ["targets"],
    queryFn: () => api<Target[]>("/api/targets"),
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Assessment results and vulnerability summaries. Findings appear here once the scan pipeline lands in
          milestone 4; only assessor-verified data counts as confirmed.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {targets.isLoading ? (
          <StatCardSkeleton />
        ) : (
          <StatCard
            title="Registered targets"
            value={String(targets.data?.length ?? 0)}
            icon={Crosshair}
            hint="Authorized web applications"
          />
        )}
        <StatCard title="Assessments" value="0" icon={Radar} hint="Runs of the scan pipeline" />
        <StatCard title="Open findings" value="0" icon={ShieldAlert} hint="Candidates awaiting review" />
        <StatCard title="Verified findings" value="0" icon={ShieldCheck} hint="Confirmed by an assessor" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Findings by severity</CardTitle>
          <CardDescription>
            Populated as assessments complete. Verified and candidate findings are shown separately in the findings
            workflow.
          </CardDescription>
        </CardHeader>
        <CardContent className="h-72">
          <BarChart width={800} height={260} data={SEVERITY_DATA} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="severity" tickLine={false} axisLine={false} fontSize={12} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} />
            <Bar dataKey="count" radius={4}>
              {SEVERITY_DATA.map((entry) => (
                <Cell key={entry.severity} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </CardContent>
      </Card>
    </div>
  )
}
