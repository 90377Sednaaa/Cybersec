import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom"
import { ArrowUpDown, ExternalLink, Radar, RotateCcw, Search, Server, ShieldAlert, X } from "lucide-react"
import { cn } from "cn"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/empty-state"
import { FindingTriageSheet } from "@/components/finding-triage-sheet"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { HelpHint } from "@/components/help-hint"
import { useFindingCounts } from "@/hooks/use-finding-counts"
import { api, apiWithMeta } from "@/lib/api"
import {
  SEVERITIES,
  SEVERITY_CLASS,
  SEVERITY_WEIGHT,
  STATUSES,
  STATUS_CLASS,
  STATUS_LABEL,
  STATUS_SHORT_LABEL,
  STATUS_VARIANT,
  capitalize,
  displayScore,
} from "@/lib/finding-style"
import { ASSESSMENT_CATEGORIES } from "@/lib/types"
import type { Assessment, Finding, FindingStatus, Severity, Target } from "@/lib/types"

const ALL = "all"
const NEEDS_REVIEW = "needs_review"

const SORT_VALUES = [
  "id-desc",
  "id-asc",
  "severity-desc",
  "severity-asc",
  "score-desc",
  "score-asc",
  "confidence-desc",
] as const
type SortOption = (typeof SORT_VALUES)[number]

// "needs_review" is a synthetic queue, not a stored status: it matches both
// unconfirmed AI candidates and findings an assessor sent back for evidence.
type StatusFilter = FindingStatus | typeof NEEDS_REVIEW | typeof ALL

function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
  className,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  className?: string
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className={className || "h-9 w-44 text-sm"}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value={ALL}>All</SelectItem>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  )
}

function CountChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count: number | undefined
  active: boolean
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "default" : "outline"}
      aria-pressed={active}
      onClick={onClick}
      className="h-8 gap-2 text-xs"
    >
      {label}
      <span
        className={cn(
          "min-w-5 rounded px-1 text-center font-mono text-[11px] tabular-nums",
          active ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-muted-foreground",
        )}
      >
        {count ?? "-"}
      </span>
    </Button>
  )
}

export function FindingsPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [selectedFindingId, setSelectedFindingId] = useState<number | null>(null)

  // Filters live in the URL so they survive opening a finding, the browser Back
  // button, and dashboard/run deep links.
  const search = searchParams.get("q") ?? ""

  const statusParam = searchParams.get("status")
  const status: StatusFilter =
    statusParam === NEEDS_REVIEW ||
    (statusParam !== null && (STATUSES as readonly string[]).includes(statusParam))
      ? (statusParam as StatusFilter)
      : ALL

  const severityParam = searchParams.get("severity")
  const severity: Severity | typeof ALL =
    severityParam !== null && (SEVERITIES as readonly string[]).includes(severityParam)
      ? (severityParam as Severity)
      : ALL

  const categoryParam = searchParams.get("category")
  const category =
    categoryParam !== null && (ASSESSMENT_CATEGORIES as readonly string[]).includes(categoryParam)
      ? categoryParam
      : ALL

  const targetParam = searchParams.get("target")
  const targetId = targetParam !== null && /^\d+$/.test(targetParam) ? targetParam : ALL

  const assessmentParam = searchParams.get("assessment")
  const assessment = assessmentParam !== null && /^\d+$/.test(assessmentParam) ? assessmentParam : ALL

  const sortParam = searchParams.get("sort")
  const sortBy: SortOption =
    sortParam !== null && (SORT_VALUES as readonly string[]).includes(sortParam)
      ? (sortParam as SortOption)
      : "id-desc"

  function updateParams(patch: Record<string, string | null>) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "" || value === ALL) next.delete(key)
        else next.set(key, value)
      }
      return next
    }, { replace: true })
  }

  // Only server-supported filters go into the request. Search, target and the
  // synthetic review queue are applied to the loaded page below.
  const serverParams = new URLSearchParams({ limit: "200" })
  if (status !== ALL && status !== NEEDS_REVIEW) serverParams.set("status", status)
  if (severity !== ALL) serverParams.set("severity", severity)
  if (category !== ALL) serverParams.set("category", category)
  if (assessment !== ALL) serverParams.set("assessment_id", assessment)

  // Primary findings query. The key shape is shared with the dashboard and the
  // finding detail stepper so all three reuse one cached 200-row page.
  const findingsQuery = useQuery({
    queryKey: ["findings", status, severity, category, assessment],
    queryFn: () => apiWithMeta<Finding[]>(`/api/findings?${serverParams.toString()}`),
  })
  const loadedFindings = findingsQuery.data?.data
  const totalCount = findingsQuery.data?.totalCount ?? loadedFindings?.length ?? 0
  const loadedCount = loadedFindings?.length ?? 0

  const counts = useFindingCounts()

  // Targets and assessments queries for context enrichment
  const targetsQuery = useQuery({
    queryKey: ["targets"],
    queryFn: () => api<Target[]>("/api/targets"),
  })

  const assessmentsQuery = useQuery({
    queryKey: ["assessments"],
    queryFn: () => api<Assessment[]>("/api/assessments"),
  })

  // Fast lookup maps
  const targetsMap = useMemo(() => {
    const map = new Map<number, Target>()
    for (const t of targetsQuery.data ?? []) map.set(t.id, t)
    return map
  }, [targetsQuery.data])

  const assessmentsMap = useMemo(() => {
    const map = new Map<number, Assessment>()
    for (const a of assessmentsQuery.data ?? []) map.set(a.id, a)
    return map
  }, [assessmentsQuery.data])

  // Client-side narrowing and ordering over the loaded page.
  const filteredFindings = useMemo(() => {
    const term = search.trim().toLowerCase()
    let list = (loadedFindings ?? []).filter((f) => {
      if (!term) return true
      const idStr = String(f.id)
      if (term === idStr || term === `#${idStr}`) return true
      if (f.title.toLowerCase().includes(term)) return true
      if (f.category.toLowerCase().includes(term)) return true
      if (f.description.toLowerCase().includes(term)) return true
      return false
    })

    if (status === NEEDS_REVIEW) {
      list = list.filter((f) => f.status === "ai_candidate" || f.status === "needs_evidence")
    }

    if (targetId !== ALL) {
      const tId = Number(targetId)
      list = list.filter((f) => {
        if (!f.assessment_id) return false
        return assessmentsMap.get(f.assessment_id)?.target_id === tId
      })
    }

    return list.sort((a, b) => {
      switch (sortBy) {
        case "severity-desc":
          return SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity] || b.score - a.score
        case "severity-asc":
          return SEVERITY_WEIGHT[a.severity] - SEVERITY_WEIGHT[b.severity] || a.score - b.score
        case "score-desc":
          return b.score - a.score || SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity]
        case "score-asc":
          return a.score - b.score || SEVERITY_WEIGHT[a.severity] - SEVERITY_WEIGHT[b.severity]
        case "confidence-desc":
          return b.ai_confidence - a.ai_confidence
        case "id-asc":
          return a.id - b.id
        case "id-desc":
        default:
          return b.id - a.id
      }
    })
  }, [loadedFindings, search, status, targetId, sortBy, assessmentsMap])

  const filtersActive =
    search.trim() !== "" ||
    status !== ALL ||
    severity !== ALL ||
    category !== ALL ||
    targetId !== ALL ||
    assessment !== ALL

  function handleResetFilters() {
    setSearchParams(new URLSearchParams(), { replace: true })
  }

  const queueIds = useMemo(() => filteredFindings.map((f) => f.id), [filteredFindings])
  const fromHref = `/findings${location.search}`
  const listState = { from: fromHref, queueIds }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex items-center gap-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Findings</h1>
          <HelpHint label="Findings workflow" className="mt-1.5">
            Findings produced by the AI start as unconfirmed candidates. Only an assessor can verify a finding
            or mark it as a false positive.
          </HelpHint>
        </div>
        <p className="text-sm text-muted-foreground">
          Identified weaknesses with severity, evidence and recommended remediation.
        </p>
      </div>

      <Alert>
        <AlertDescription>
          AI-generated findings are candidates, not confirmed vulnerabilities, until an assessor verifies them.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle>Findings repository</CardTitle>
              <CardDescription>
                {findingsQuery.isLoading ? (
                  "Loading findings…"
                ) : totalCount > loadedCount ? (
                  <>
                    <strong className="text-foreground">{filteredFindings.length}</strong> shown · newest{" "}
                    {loadedCount} of {totalCount} findings
                  </>
                ) : (
                  <>
                    <strong className="text-foreground">{filteredFindings.length}</strong> shown
                    {filteredFindings.length !== loadedCount && ` of ${loadedCount}`}
                  </>
                )}
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <CountChip
                label="Needs review"
                count={counts.data?.needsReview}
                active={status === NEEDS_REVIEW}
                onClick={() => updateParams({ status: NEEDS_REVIEW })}
              />
              <CountChip
                label="Verified"
                count={counts.data?.verified}
                active={status === "verified"}
                onClick={() => updateParams({ status: "verified" })}
              />
              <CountChip
                label="All findings"
                count={counts.data?.total}
                active={status === ALL}
                onClick={() => updateParams({ status: null })}
              />
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {assessment !== ALL && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
              <Radar className="size-4 shrink-0 text-primary" />
              <span className="text-muted-foreground">Showing findings from</span>
              <Link
                to={`/assessments/${assessment}`}
                className="font-medium text-foreground underline-offset-4 hover:text-primary hover:underline"
              >
                Assessment #{assessment}
              </Link>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-7 text-xs"
                onClick={() => updateParams({ assessment: null })}
              >
                <X className="size-3.5" />
                Clear
              </Button>
            </div>
          )}

          {/* Top Filter and Search Bar */}
          <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/40 p-3">
            {/* Search Input */}
            <div className="grid min-w-[200px] flex-1 gap-1.5">
              <Label htmlFor="search-findings" className="text-xs font-medium text-muted-foreground">
                Keyword search
              </Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                <Input
                  id="search-findings"
                  placeholder="Search title, category, or ID"
                  value={search}
                  onChange={(event) => updateParams({ q: event.target.value })}
                  className="h-9 bg-background pl-8 text-sm"
                />
              </div>
            </div>

            {/* Target Filter */}
            <FilterSelect
              id="filter-target"
              label="Target"
              value={targetId}
              onChange={(value) => updateParams({ target: value })}
              options={(targetsQuery.data ?? []).map((t) => ({
                value: String(t.id),
                label: t.name,
              }))}
              className="h-9 w-40 bg-background text-sm"
            />

            {/* Status Filter */}
            <FilterSelect
              id="filter-status"
              label="Status"
              value={status}
              onChange={(value) => updateParams({ status: value })}
              options={[
                { value: NEEDS_REVIEW, label: "Needs review" },
                ...STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
              ]}
              className="h-9 w-44 bg-background text-sm"
            />

            {/* Severity Filter */}
            <FilterSelect
              id="filter-severity"
              label="Severity"
              value={severity}
              onChange={(value) => updateParams({ severity: value })}
              options={SEVERITIES.map((s) => ({ value: s, label: capitalize(s) }))}
              className="h-9 w-32 bg-background text-sm"
            />

            {/* Category Filter */}
            <FilterSelect
              id="filter-category"
              label="Category"
              value={category}
              onChange={(value) => updateParams({ category: value })}
              options={ASSESSMENT_CATEGORIES.map((c) => ({ value: c, label: c }))}
              className="h-9 w-52 bg-background text-sm"
            />

            {/* Sort Selector */}
            <div className="grid gap-1.5">
              <Label htmlFor="sort-findings" className="text-xs font-medium text-muted-foreground">
                Sort by
              </Label>
              <Select
                value={sortBy}
                onValueChange={(value) => updateParams({ sort: value === "id-desc" ? null : value })}
              >
                <SelectTrigger id="sort-findings" className="h-9 w-44 bg-background text-sm">
                  <ArrowUpDown className="mr-1.5 size-3 text-muted-foreground" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="id-desc">Newest ID (#)</SelectItem>
                  <SelectItem value="id-asc">Oldest ID (#)</SelectItem>
                  <SelectItem value="severity-desc">Severity (high to low)</SelectItem>
                  <SelectItem value="severity-asc">Severity (low to high)</SelectItem>
                  <SelectItem value="score-desc">Score (high to low)</SelectItem>
                  <SelectItem value="score-asc">Score (low to high)</SelectItem>
                  <SelectItem value="confidence-desc">AI confidence</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Reset Filters Action (Stable layout slot) */}
            <div className="grid gap-1.5">
              <span className="h-4 select-none text-xs font-medium text-transparent">Reset</span>
              <Button
                variant="outline"
                size="sm"
                disabled={!filtersActive}
                onClick={handleResetFilters}
                className={cn(
                  "h-9 text-xs transition-colors",
                  filtersActive
                    ? "cursor-pointer text-foreground hover:bg-muted"
                    : "cursor-not-allowed text-muted-foreground opacity-40",
                )}
                title={filtersActive ? "Reset all active filters" : "No filters active"}
              >
                <RotateCcw className="mr-1.5 size-3" />
                Reset
              </Button>
            </div>
          </div>

          {findingsQuery.error && (
            <Alert variant="destructive">
              <AlertDescription>{findingsQuery.error.message}</AlertDescription>
            </Alert>
          )}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14">ID</TableHead>
                <TableHead className="w-24">Severity</TableHead>
                <TableHead>Title</TableHead>
                <TableHead className="hidden w-36 xl:table-cell">Target</TableHead>
                <TableHead className="hidden w-40 xl:table-cell">Category</TableHead>
                <TableHead className="w-32">Status</TableHead>
                <TableHead className="w-16 text-right">Score</TableHead>
                <TableHead className="w-10" aria-label="Full view" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {findingsQuery.isLoading &&
                [0, 1, 2, 3, 4].map((index) => (
                  <TableRow key={index}>
                    <TableCell colSpan={8}>
                      <Skeleton className="h-9 w-full" />
                    </TableCell>
                  </TableRow>
                ))}

              {!findingsQuery.isLoading && filteredFindings.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="h-32 text-center">
                    <EmptyState
                      icon={ShieldAlert}
                      title={filtersActive ? "No findings match your active filters" : "No findings recorded yet"}
                      description={
                        filtersActive
                          ? "Try clearing your search query or broadening the filter options."
                          : "Findings appear here automatically after an assessment scan completes and AI interpretation concludes."
                      }
                      className="py-4"
                    />
                  </TableCell>
                </TableRow>
              )}

              {filteredFindings.map((finding) => {
                const linkedAssessment = finding.assessment_id
                  ? assessmentsMap.get(finding.assessment_id)
                  : null
                const target = linkedAssessment ? targetsMap.get(linkedAssessment.target_id) : null

                return (
                  <TableRow
                    key={finding.id}
                    className="cursor-pointer transition-colors hover:bg-muted/50"
                    tabIndex={0}
                    onClick={() => setSelectedFindingId(finding.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        setSelectedFindingId(finding.id)
                      }
                    }}
                  >
                    <TableCell className="py-3 font-mono text-xs font-semibold text-foreground">
                      #{finding.id}
                    </TableCell>
                    <TableCell>
                      <Badge className={SEVERITY_CLASS[finding.severity]}>
                        {capitalize(finding.severity)}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-normal font-medium text-foreground">
                      <div className="line-clamp-2 max-w-[40rem]" title={finding.title}>
                        {finding.title}
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground xl:table-cell">
                      {target ? (
                        <div className="flex items-center gap-1.5" title={target.base_url}>
                          <Server className="size-3 shrink-0 text-primary" />
                          <span className="truncate">{target.name}</span>
                        </div>
                      ) : (
                        <span className="font-mono text-muted-foreground/60">-</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground xl:table-cell">
                      <span className="block truncate" title={finding.category}>
                        {finding.category}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[finding.status]} className={STATUS_CLASS[finding.status]}>
                        {STATUS_SHORT_LABEL[finding.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-medium tabular-nums">
                      {displayScore(finding.score, finding.severity)}
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Open Finding #${finding.id} full page`}
                        title="Open full page"
                        onClick={() => navigate(`/findings/${finding.id}`, { state: listState })}
                      >
                        <ExternalLink />
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <FindingTriageSheet
        findingId={selectedFindingId}
        queueIds={queueIds}
        fromHref={fromHref}
        onSelectFinding={setSelectedFindingId}
      />
    </div>
  )
}
