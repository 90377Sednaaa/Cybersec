import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate } from "react-router-dom"
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { ArrowRight, Crosshair, Radar, ShieldAlert, ShieldCheck } from "lucide-react"

import { EmptyState } from "@/components/empty-state"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useFindingCounts } from "@/hooks/use-finding-counts"
import { api, apiWithMeta } from "@/lib/api"
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
  to: string
}

function StatCard({ title, value, icon: Icon, hint, loading, to }: StatCardProps) {
  if (loading) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="size-8 rounded-lg" />
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-3.5 w-32" />
        </CardContent>
      </Card>
    )
  }
  return (
    <Link
      to={to}
      className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <Card className="h-full transition-all duration-200 group-hover:border-primary/40 group-hover:shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {title}
          </CardTitle>
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
            <Icon className="size-4" />
          </span>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5">
          <p className="text-3xl font-bold tracking-tight tabular-nums text-foreground">{value}</p>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">{hint}</p>
            <ArrowRight className="size-3.5 shrink-0 text-muted-foreground/60 transition-all group-hover:translate-x-0.5 group-hover:text-primary" />
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}

export function DashboardPage() {
  const navigate = useNavigate()
  const [scope, setScope] = useState<"verified" | "all">("all")

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

  const findings = useQuery({
    queryKey: ["findings", "all", "all", "all", "all"],
    queryFn: () => apiWithMeta<Finding[]>("/api/findings?limit=200"),
  })
  const findingRows = findings.data?.data

  const counts = useFindingCounts()
  const loadError = targets.error ?? assessments.error ?? findings.error ?? counts.error

  const runningCount = assessments.data?.filter((a) => a.status === "running").length ?? 0
  const candidateCount = counts.data?.ai_candidate ?? 0
  const needsEvidenceCount = counts.data?.needs_evidence ?? 0
  const falsePositiveCount = counts.data?.false_positive ?? 0
  const verifiedCount = counts.data?.verified ?? 0
  const openCount = counts.data?.needsReview ?? 0
  const totalFindings = counts.data?.total ?? 0
  const isTruncated = totalFindings > 200

  const counted =
    findingRows?.filter((f) => (scope === "verified" ? f.status === "verified" : f.status !== "false_positive")) ?? []
  const chartData = SEVERITIES.map((severity) => ({
    key: severity,
    severity: capitalize(severity),
    count: counted.filter((f) => f.severity === severity).length,
    fill: SEVERITY_FILL[severity],
  }))

  function findingsHrefForSeverity(severity: Severity): string {
    const params = new URLSearchParams({ severity })
    if (scope === "verified") {
      params.set("status", "verified")
    }
    return `/findings?${params.toString()}`
  }

  const targetNames = new Map(targets.data?.map((t) => [t.id, t.name]))
  const recent = [...(assessments.data ?? [])].sort((a, b) => b.id - a.id).slice(0, 5)

  const reviewedCount = verifiedCount + needsEvidenceCount + falsePositiveCount
  const reviewedPercent = totalFindings > 0 ? Math.round((reviewedCount / totalFindings) * 100) : 0

  // Mirrors --state-* tokens used by Findings status chips so hues match 1:1.
  const reviewBuckets = [
    { key: "verified", label: "Verified", count: verifiedCount, color: "var(--state-verified)" },
    { key: "needs_evidence", label: "Needs evidence", count: needsEvidenceCount, color: "var(--state-needs-evidence)" },
    { key: "ai_candidate", label: "AI candidate", count: candidateCount, color: "var(--state-candidate)" },
    { key: "false_positive", label: "False positive", count: falsePositiveCount, color: "var(--state-false-positive)" },
  ]

  const trendData = [...(assessments.data ?? [])]
    .sort((a, b) => a.id - b.id)
    .slice(-8)
    .map((assessment) => ({
      id: assessment.id,
      label: `#${assessment.id}`,
      count: findingRows?.filter((f) => f.assessment_id === assessment.id).length ?? 0,
    }))

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
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
          to="/targets"
        />
        <StatCard
          title="Assessments"
          value={String(assessments.data?.length ?? 0)}
          icon={Radar}
          hint={runningCount > 0 ? `${runningCount} running now` : "Runs of the scan pipeline"}
          loading={assessments.isLoading}
          to="/assessments"
        />
        <StatCard
          title="Open findings"
          value={String(openCount)}
          icon={ShieldAlert}
          hint="Candidates awaiting review"
          loading={counts.isLoading}
          to="/findings?status=needs_review"
        />
        <StatCard
          title="Verified findings"
          value={String(verifiedCount)}
          icon={ShieldCheck}
          hint="Confirmed by an assessor"
          loading={counts.isLoading}
          to="/findings?status=verified"
        />
      </div>

      {/* Row 2: Findings by severity (8 cols) + Verification progress (4 cols) */}
      <div className="grid gap-6 lg:grid-cols-12">
        <Card className="lg:col-span-8">
          <CardHeader>
            <CardTitle>Findings by severity</CardTitle>
            <CardDescription>
              {scope === "verified"
                ? "Confirmed findings only. AI candidates are excluded until verified."
                : "Includes unconfirmed AI candidates; false positives excluded."}
              {isTruncated ? " Showing the 200 most recent findings." : ""} Click a bar to filter.
            </CardDescription>
            <CardAction>
              <Tabs value={scope} onValueChange={(value) => setScope(value as "verified" | "all")}>
                <TabsList>
                  <TabsTrigger value="all">Incl. candidates</TabsTrigger>
                  <TabsTrigger value="verified">Verified</TabsTrigger>
                </TabsList>
              </Tabs>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="relative h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  margin={{ top: 8, right: 8, left: -20, bottom: 0 }}
                  style={{ cursor: "pointer" }}
                  onClick={(state) => {
                    const match = chartData.find((entry) => entry.severity === state?.activeLabel)
                    if (match) navigate(findingsHrefForSeverity(match.key))
                  }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="severity" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} />
                  <Tooltip
                    cursor={{ fill: "var(--muted)", opacity: 0.3 }}
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const item = payload[0]
                        return (
                          <div className="rounded-lg border bg-popover px-3 py-1.5 text-xs shadow-md">
                            <div className="flex items-center gap-2">
                              <span className="size-2 rounded-full" style={{ backgroundColor: item.payload.fill }} />
                              <span className="font-semibold text-popover-foreground">{item.payload.severity}</span>
                            </div>
                            <p className="mt-1 font-mono tabular-nums text-muted-foreground">
                              {item.value} {item.value === 1 ? "finding" : "findings"}
                            </p>
                            <p className="mt-0.5 text-muted-foreground/80">Click to filter</p>
                          </div>
                        )
                      }
                      return null
                    }}
                  />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={56} className="cursor-pointer">
                    {chartData.map((entry) => (
                      <Cell key={entry.severity} fill={entry.fill} className="cursor-pointer" />
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
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t pt-3">
              {chartData.map((entry) => (
                <Link
                  key={entry.key}
                  to={findingsHrefForSeverity(entry.key)}
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: entry.fill }}
                    aria-hidden="true"
                  />
                  <span>{entry.severity}</span>
                  <span className="font-mono font-semibold tabular-nums text-foreground">{entry.count}</span>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-4">
          <CardHeader>
            <CardTitle>Verification progress</CardTitle>
            <CardDescription>
              {totalFindings === 0
                ? "Nothing to review yet."
                : `${reviewedCount} of ${totalFindings} findings reviewed`}
            </CardDescription>
            {totalFindings > 0 && (
              <CardAction>
                <Badge variant="outline" className="font-mono text-xs tabular-nums">
                  {reviewedPercent}%
                </Badge>
              </CardAction>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted/80 p-0.5">
              {reviewBuckets.map((bucket) =>
                bucket.count > 0 ? (
                  <div
                    key={bucket.key}
                    className="transition-all duration-300 first:rounded-l-full last:rounded-r-full"
                    style={{
                      width: `${(bucket.count / Math.max(totalFindings, 1)) * 100}%`,
                      backgroundColor: bucket.color,
                    }}
                    title={`${bucket.label}: ${bucket.count}`}
                  />
                ) : null,
              )}
            </div>
            <ul className="flex flex-col gap-1">
              {reviewBuckets.map((bucket) => (
                <li key={bucket.key}>
                  <Link
                    to={`/findings?status=${bucket.key}`}
                    className="flex items-center justify-between rounded-md px-2.5 py-1.5 text-xs transition-colors hover:bg-muted/60"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: bucket.color }}
                        aria-hidden="true"
                      />
                      <span className="font-medium text-muted-foreground">{bucket.label}</span>
                    </div>
                    <span className="font-mono font-semibold tabular-nums text-foreground">{bucket.count}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <Separator />
            <p className="text-xs leading-relaxed text-muted-foreground">
              Only verified findings count as confirmed. AI candidates stay marked until an assessor decides.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Row 3: Balanced side-by-side Findings per run (5 cols) + Recent assessments (7 cols) */}
      <div className="grid gap-6 lg:grid-cols-12">
        <Card className="lg:col-span-5">
          <CardHeader>
            <CardTitle>Findings per run</CardTitle>
            <CardDescription>
              Newest eight runs. Click a bar to open the run.
              {isTruncated ? " Based on the 200 most recent findings." : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="relative h-56">
              {trendData.length === 0 ? (
                <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  No runs to chart yet.
                </p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={trendData}
                    margin={{ top: 8, right: 8, left: -20, bottom: 0 }}
                    style={{ cursor: "pointer" }}
                    onClick={(state) => {
                      const match = trendData.find((entry) => entry.label === state?.activeLabel)
                      if (match) navigate(`/assessments/${match.id}`)
                    }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} />
                    <Tooltip
                      cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                      contentStyle={{
                        background: "var(--popover)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        fontSize: 12,
                        color: "var(--popover-foreground)",
                      }}
                      labelFormatter={(label) => `Run ${label} (click to open)`}
                      formatter={(value) => [`${value} findings`, "Findings"]}
                    />
                    <Bar dataKey="count" fill="var(--primary)" radius={4} maxBarSize={44} className="cursor-pointer" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-7">
          <CardHeader>
            <CardTitle>Recent assessments</CardTitle>
            <CardDescription>The five newest runs across registered targets.</CardDescription>
            <CardAction>
              <Link to="/assessments" className="text-xs font-medium text-primary underline-offset-4 hover:underline">
                View all
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {assessments.isLoading &&
              [0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            {!assessments.isLoading && recent.length === 0 && (
              <EmptyState
                icon={Radar}
                title="No assessments yet"
                description="Runs of the scan pipeline appear here once you start one."
                className="py-6"
                action={
                  <Link to="/assessments" className="text-xs text-primary underline-offset-4 hover:underline">
                    Start one on the Assessments page
                  </Link>
                }
              />
            )}
            {recent.map((assessment) => {
              const runCount = findingRows?.filter((f) => f.assessment_id === assessment.id).length ?? 0
              return (
                <Link
                  key={assessment.id}
                  to={`/assessments/${assessment.id}`}
                  className="group flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3.5 text-sm transition-colors hover:border-primary/40 hover:bg-muted/40"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted font-mono text-xs font-semibold text-muted-foreground group-hover:text-foreground">
                      #{assessment.id}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">
                        {targetNames.get(assessment.target_id) ?? `Target #${assessment.target_id}`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {assessment.started_at ? new Date(assessment.started_at).toLocaleString() : "-"}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2.5">
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {runCount} {runCount === 1 ? "finding" : "findings"}
                    </span>
                    <Badge variant={STATUS_VARIANT[assessment.status]}>{assessment.status}</Badge>
                  </div>
                </Link>
              )
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
