import { useQuery } from "@tanstack/react-query"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { Crosshair, Radar, ShieldAlert, ShieldCheck } from "lucide-react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold">{value}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  )
}

const SEVERITY_PLACEHOLDER = [
  { severity: "Critical", count: 0 },
  { severity: "High", count: 0 },
  { severity: "Medium", count: 0 },
  { severity: "Low", count: 0 },
  { severity: "Info", count: 0 },
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
          Assessment results and vulnerability summaries. Findings appear here once the scan pipeline lands
          (milestone 4) — verified data only counts after assessor confirmation.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Registered targets"
          value={targets.isLoading ? "…" : String(targets.data?.length ?? 0)}
          icon={Crosshair}
          hint="Authorized web applications"
        />
        <StatCard title="Assessments" value="0" icon={Radar} hint="Runs of the scan pipeline" />
        <StatCard title="Open findings" value="0" icon={ShieldAlert} hint="Candidates awaiting review" />
        <StatCard title="Verified findings" value="0" icon={ShieldCheck} hint="Confirmed by an assessor" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Findings by severity</CardTitle>
          <CardDescription>Populated from verified + candidate findings as assessments complete.</CardDescription>
        </CardHeader>
        <CardContent className="h-72">
          <BarChart width={800} height={260} data={SEVERITY_PLACEHOLDER} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="severity" tickLine={false} axisLine={false} fontSize={12} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} />
            <Bar dataKey="count" fill="var(--chart-1)" radius={4} />
          </BarChart>
        </CardContent>
      </Card>
    </div>
  )
}
