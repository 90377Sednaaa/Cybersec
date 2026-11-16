import { useState, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { ShieldAlert, Search, RotateCcw, Server, ArrowUpDown } from "lucide-react"
import { cn } from "cn"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/empty-state"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { HelpHint } from "@/components/help-hint"
import { api } from "@/lib/api"
import {
  SEVERITIES,
  SEVERITY_CLASS,
  STATUSES,
  STATUS_CLASS,
  STATUS_LABEL,
  STATUS_VARIANT,
  capitalize,
  displayScore,
} from "@/lib/finding-style"
import { ASSESSMENT_CATEGORIES } from "@/lib/types"
import type { Assessment, Finding, Severity, Target } from "@/lib/types"

const ALL = "all"

const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
}

type SortOption =
  | "id-desc"
  | "id-asc"
  | "severity-desc"
  | "severity-asc"
  | "score-desc"
  | "score-asc"
  | "confidence-desc"

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
      <Label htmlFor={id} className="text-xs text-muted-foreground font-medium">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className={className || "w-44 text-xs h-9"}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL} className="text-xs">All</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} className="text-xs">
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function FindingsPage() {
  const navigate = useNavigate()
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState(ALL)
  const [severity, setSeverity] = useState(ALL)
  const [category, setCategory] = useState(ALL)
  const [targetId, setTargetId] = useState(ALL)
  const [sortBy, setSortBy] = useState<SortOption>("id-desc")

  const params = new URLSearchParams()
  if (status !== ALL) params.set("status", status)
  if (severity !== ALL) params.set("severity", severity)
  if (category !== ALL) params.set("category", category)
  const query = params.toString()

  // Primary findings query
  const { data, isLoading, error } = useQuery({
    queryKey: ["findings", status, severity, category],
    queryFn: () => api<Finding[]>(`/api/findings${query ? `?${query}` : ""}`),
  })

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

  // Filter and sort findings
  const filteredFindings = useMemo(() => {
    const term = search.trim().toLowerCase()
    let list = (data ?? []).filter((f) => {
      if (!term) return true
      const idStr = String(f.id)
      if (term === idStr || term === `#${idStr}`) return true
      if (f.title.toLowerCase().includes(term)) return true
      if (f.category.toLowerCase().includes(term)) return true
      if (f.description.toLowerCase().includes(term)) return true
      return false
    })

    if (targetId !== ALL) {
      const tId = Number(targetId)
      list = list.filter((f) => {
        if (!f.assessment_id) return false
        const a = assessmentsMap.get(f.assessment_id)
        return a && a.target_id === tId
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
  }, [data, search, targetId, sortBy, assessmentsMap])

  const filtersActive =
    search.trim() !== "" ||
    status !== ALL ||
    severity !== ALL ||
    category !== ALL ||
    targetId !== ALL

  const handleResetFilters = () => {
    setSearch("")
    setStatus(ALL)
    setSeverity(ALL)
    setCategory(ALL)
    setTargetId(ALL)
    setSortBy("id-desc")
  }

  const verifiedCount = data?.filter((f) => f.status === "verified").length ?? 0

  return (
    <div className="space-y-6">
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
          <CardTitle>Findings Repository</CardTitle>
          <CardDescription className="mt-1">
            {isLoading ? (
              "Loading findings…"
            ) : (
              <span>
                Showing <strong className="text-foreground">{filteredFindings.length}</strong> of {data?.length ?? 0} findings
                {" · "}
                <span className="text-emerald-600 dark:text-emerald-400 font-medium">{verifiedCount} verified</span>
                {filtersActive && " (filters applied)"}
              </span>
            )}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Top Filter and Search Bar */}
          <div className="flex flex-wrap items-end gap-3 p-3 rounded-lg bg-muted/40 border">
            {/* Search Input */}
            <div className="grid gap-1.5 flex-1 min-w-[200px]">
              <Label htmlFor="search-findings" className="text-xs text-muted-foreground font-medium">
                Keyword Search
              </Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                <Input
                  id="search-findings"
                  placeholder="Search title, category, ID, CVE..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 text-xs h-9 bg-background"
                />
              </div>
            </div>

            {/* Target Filter */}
            <FilterSelect
              id="filter-target"
              label="Target"
              value={targetId}
              onChange={setTargetId}
              options={(targetsQuery.data ?? []).map((t) => ({
                value: String(t.id),
                label: t.name,
              }))}
              className="w-40 text-xs h-9 bg-background"
            />

            {/* Status Filter */}
            <FilterSelect
              id="filter-status"
              label="Status"
              value={status}
              onChange={setStatus}
              options={STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
              className="w-40 text-xs h-9 bg-background"
            />

            {/* Severity Filter */}
            <FilterSelect
              id="filter-severity"
              label="Severity"
              value={severity}
              onChange={setSeverity}
              options={SEVERITIES.map((s) => ({ value: s, label: capitalize(s) }))}
              className="w-32 text-xs h-9 bg-background"
            />

            {/* Category Filter */}
            <FilterSelect
              id="filter-category"
              label="Category"
              value={category}
              onChange={setCategory}
              options={ASSESSMENT_CATEGORIES.map((c) => ({ value: c, label: c }))}
              className="w-44 text-xs h-9 bg-background"
            />

            {/* Sort Selector */}
            <div className="grid gap-1.5">
              <Label htmlFor="sort-findings" className="text-xs text-muted-foreground font-medium">
                Sort By
              </Label>
              <Select value={sortBy} onValueChange={(val) => setSortBy(val as SortOption)}>
                <SelectTrigger id="sort-findings" className="w-40 text-xs h-9 bg-background">
                  <ArrowUpDown className="size-3 mr-1.5 text-muted-foreground" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="id-desc" className="text-xs">Newest ID (#)</SelectItem>
                  <SelectItem value="id-asc" className="text-xs">Oldest ID (#)</SelectItem>
                  <SelectItem value="severity-desc" className="text-xs">Severity (High to Low)</SelectItem>
                  <SelectItem value="severity-asc" className="text-xs">Severity (Low to High)</SelectItem>
                  <SelectItem value="score-desc" className="text-xs">Score (High to Low)</SelectItem>
                  <SelectItem value="score-asc" className="text-xs">Score (Low to High)</SelectItem>
                  <SelectItem value="confidence-desc" className="text-xs">AI Confidence</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Reset Filters Action (Stable layout slot) */}
            <div className="grid gap-1.5">
              <span className="text-xs text-transparent select-none font-medium h-4">Reset</span>
              <Button
                variant="outline"
                size="sm"
                disabled={!filtersActive}
                onClick={handleResetFilters}
                className={cn(
                  "h-9 text-xs transition-colors",
                  filtersActive
                    ? "cursor-pointer text-foreground hover:bg-muted"
                    : "opacity-40 cursor-not-allowed text-muted-foreground"
                )}
                title={filtersActive ? "Reset all active filters" : "No filters active"}
              >
                <RotateCcw className="size-3 mr-1.5" />
                Reset
              </Button>
            </div>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
          )}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">ID</TableHead>
                <TableHead className="w-24">Severity</TableHead>
                <TableHead>Title</TableHead>
                <TableHead className="w-44">Target</TableHead>
                <TableHead className="w-44">Category</TableHead>
                <TableHead className="w-44">Status</TableHead>
                <TableHead className="w-20">Score</TableHead>
                <TableHead className="w-24">Confidence</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    Loading findings…
                  </TableCell>
                </TableRow>
              )}

              {!isLoading && filteredFindings.length === 0 && (
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
                const assessment = finding.assessment_id ? assessmentsMap.get(finding.assessment_id) : null
                const target = assessment ? targetsMap.get(assessment.target_id) : null

                return (
                  <TableRow
                    key={finding.id}
                    className="cursor-pointer transition-colors hover:bg-muted/50"
                    tabIndex={0}
                    onClick={() => navigate(`/findings/${finding.id}`)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") navigate(`/findings/${finding.id}`)
                    }}
                  >
                    <TableCell className="font-mono text-xs font-semibold text-foreground">
                      #{finding.id}
                    </TableCell>
                    <TableCell>
                      <Badge className={SEVERITY_CLASS[finding.severity]}>
                        {capitalize(finding.severity)}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-xs font-medium text-foreground">
                      <div className="line-clamp-2">{finding.title}</div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {target ? (
                        <div className="flex items-center gap-1.5 truncate" title={target.base_url}>
                          <Server className="size-3 text-primary shrink-0" />
                          <span className="truncate">{target.name}</span>
                        </div>
                      ) : (
                        <span className="font-mono text-[11px] text-muted-foreground/60">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <div className="truncate max-w-[170px]" title={finding.category}>
                        {finding.category}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[finding.status]} className={STATUS_CLASS[finding.status]}>
                        {STATUS_LABEL[finding.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs font-mono font-medium">
                      {displayScore(finding.score, finding.severity)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {Math.round(finding.ai_confidence * 100)}%
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
