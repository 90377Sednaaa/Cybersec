import { useState } from "react"
import { useQuery } from "@tanstack/react-query"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
import type { Finding } from "@/lib/types"
import { FindingDetailSheet } from "@/pages/finding-detail"

const ALL = "all"

function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-52">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function FindingsPage() {
  const [status, setStatus] = useState(ALL)
  const [severity, setSeverity] = useState(ALL)
  const [category, setCategory] = useState(ALL)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const params = new URLSearchParams()
  if (status !== ALL) params.set("status", status)
  if (severity !== ALL) params.set("severity", severity)
  if (category !== ALL) params.set("category", category)
  const query = params.toString()

  const { data, isLoading, error } = useQuery({
    queryKey: ["findings", status, severity, category],
    queryFn: () => api<Finding[]>(`/api/findings${query ? `?${query}` : ""}`),
  })

  const filtersActive = status !== ALL || severity !== ALL || category !== ALL
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
          Identified weaknesses with severity, evidence and recommended remediation (features 05 and 06).
        </p>
      </div>

      <Alert>
        <AlertDescription>
          AI-generated findings are candidates, not confirmed vulnerabilities, until an assessor verifies them.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Findings</CardTitle>
          <CardDescription>
            {data ? `${data.length} shown, ${verifiedCount} verified` : "Loading findings…"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4">
            <FilterSelect
              id="filter-status"
              label="Status"
              value={status}
              onChange={setStatus}
              options={STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
            />
            <FilterSelect
              id="filter-severity"
              label="Severity"
              value={severity}
              onChange={setSeverity}
              options={SEVERITIES.map((s) => ({ value: s, label: capitalize(s) }))}
            />
            <FilterSelect
              id="filter-category"
              label="Category"
              value={category}
              onChange={setCategory}
              options={ASSESSMENT_CATEGORIES.map((c) => ({ value: c, label: c }))}
            />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
          )}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Confidence</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && data?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center">
                    <div className="flex flex-col items-center gap-1.5">
                      <p className="text-sm font-medium">
                        {filtersActive ? "No findings match these filters" : "No findings yet"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {filtersActive
                          ? "Clear a filter to see more."
                          : "Findings appear here after an assessment completes and the AI interprets its results."}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {data?.map((finding) => (
                <TableRow
                  key={finding.id}
                  className="cursor-pointer"
                  tabIndex={0}
                  onClick={() => setSelectedId(finding.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") setSelectedId(finding.id)
                  }}
                >
                  <TableCell className="font-mono text-xs">#{finding.id}</TableCell>
                  <TableCell>
                    <Badge className={SEVERITY_CLASS[finding.severity]}>{capitalize(finding.severity)}</Badge>
                  </TableCell>
                  <TableCell className="max-w-xs whitespace-normal font-medium">{finding.title}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{finding.category}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[finding.status]} className={STATUS_CLASS[finding.status]}>
                      {STATUS_LABEL[finding.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs font-mono">{displayScore(finding.score, finding.severity)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {Math.round(finding.ai_confidence * 100)}%
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <FindingDetailSheet findingId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  )
}