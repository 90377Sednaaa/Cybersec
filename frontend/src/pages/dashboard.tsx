import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, XAxis, YAxis } from "recharts"
import { Crosshair, Radar, ShieldAlert, ShieldCheck } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { api } from "@/lib/api"
import { SEVERITIES, capitalize } from "@/lib/finding-style"
import type { Assessment, AssessmentStatus, Finding, Severity, Target } from "@/lib/types"

type BadgeVariant = "default" | "secondary" | "destructive" | "outline"

const STATUS_VARIANT: Record<AssessmentStatus, BadgeVariant> = {
  draft: "outline",
  running: "secondary",
  completed: "default",
  failed: "destructive",
  cancelled: "outline",
}

const SEVERITY_FILL: Record<Severity, string> = {
  critical: "var(--severity-critical)",
  high: "var(--severity-high)",
  medium: "var(--severity-medium)",
  low: "var(--severity-low)",
  info: "var(--severity-info)",
}

interface StatCardProps {
  title: string
  value: string
  icon: typeof Crosshair
  hint: string
  loading: boolean
}

function StatCard({ title, value, icon: Icon, hint, loading }: StatCardProps) {
  if (loading) {
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

export function DashboardPage() {
  const [scope, setScope] = useState<"verified" | "all">("verified")

  const targets = useQuery({
    queryKey: ["targets"],
    queryFn: () => api<Target[]>("/api/targets"),
  })

  const assessments = useQuery({
    queryKey: ["assessments"],
    queryFn: () => api<Assessment[]>("/api/assessments"),
    refetchInterval: (query) =>
      query.state.data?.some((a) => a.status === "running") ? 3000 : false,
  })

  // Same key as the unfiltered Findings page, so the cache is shared.
  // The API returns at most the 200 newest findings.
  const findings = useQuery({
    queryKey: ["findings", "all", "all", "all"],
    queryFn: () => api<Finding[]>("/api/findings"),
  })

  const loadError = targets.error ?? assessments.error ?? findings.error

  const runningCount = assessments.data?.filter((a) => a.status === "running").length ?? 0
  const openCount =
    findings.data?.filter((f) => f.status === "ai_candidate" || f.status === "needs_evidence").length ?? 0
  const verifiedCount = findings.data?.filter((f) => f.status === "verified").length ?? 0

  const counted =
    findings.data?.filter((f) => (scope === "verified" ? f.status === "verified" : f.status !== "false_positive")) ?? []
  const chartData = SEVERITIES.map((severity) => ({
    severity: capitalize(severity),
    count: counted.filter((f) => f.severity === severity).length,
    fill: SEVERITY_FILL[severity],
  }))

  const targetNames = new Map(targets.data?.map((t) => [t.id, t.name]))
  const recent = [...(assessments.data ?? [])].sort((a, b) => b.id - a.id).slice(0, 5)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Assessment results and vulnerability summaries. Only assessor-verified findings count as confirmed.
        </p>
      </div>

      {loadError && (
        <Alert variant="destructive">
          <AlertDescription>{loadError.message}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Registered targets"
          value={String(targets.data?.length ?? 0)}
          icon={Crosshair}
          hint="Authorized web applications"
          loading={targets.isLoading}
        />
        <StatCard
          title="Assessments"
          value={String(assessments.data?.length ?? 0)}
          icon={Radar}
          hint={runningCount > 0 ? `${runningCount} running now` : "Runs of the scan pipeline"}
          loading={assessments.isLoading}
        />
        <StatCard
          title="Open findings"
          value={String(openCount)}
          icon={ShieldAlert}
          hint="Candidates awaiting review"
          loading={findings.isLoading}
        />
        <StatCard
          title="Verified findings"
          value={String(verifiedCount)}
          icon={ShieldCheck}
          hint="Confirmed by an assessor"
          loading={findings.isLoading}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-1.5">
            <CardTitle>Findings by severity</CardTitle>
            <CardDescription>
              {scope === "verified"
                ? "Confirmed findings only. AI candidates are not included until an assessor verifies them."
                : "Includes unconfirmed AI candidates. False positives are excluded."}
            </CardDescription>
          </div>
          <Tabs value={scope} onValueChange={(value) => setScope(value as "verified" | "all")}>
            <TabsList>
              <TabsTrigger value="verified">Verified</TabsTrigger>
              <TabsTrigger value="all">Incl. candidates</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent>
          <div className="relative h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="severity" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} />
                <Bar dataKey="count" radius={4}>
                  {chartData.map((entry) => (
                    <Cell key={entry.severity} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            {!findings.isLoading && counted.length === 0 && (
              <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                {scope === "verified" ? "No verified findings yet." : "No findings yet."}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent assessments</CardTitle>
          <CardDescription>The five newest runs.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {assessments.isLoading && <Skeleton className="h-12 w-full" />}
          {!assessments.isLoading && recent.length === 0 && (
            <div className="flex flex-col items-center gap-1.5 py-6 text-center">
              <p className="text-sm font-medium">No assessments yet</p>
              <Link to="/assessments" className="text-xs text-primary underline-offset-4 hover:underline">
                Start one on the Assessments page
              </Link>
            </div>
          )}
          {recent.map((assessment) => (
            <Link
              key={assessment.id}
              to={`/assessments/${assessment.id}`}
              className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm hover:bg-muted/50"
            >
              <span className="font-medium">
                #{assessment.id} · {targetNames.get(assessment.target_id) ?? `Target #${assessment.target_id}`}
              </span>
              <span className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">
                  {assessment.started_at ? new Date(assessment.started_at).toLocaleString() : "-"}
                </span>
                <Badge variant={STATUS_VARIANT[assessment.status]}>{assessment.status}</Badge>
              </span>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}