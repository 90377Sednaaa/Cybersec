import type { ReactNode } from "react"
import { Radar, Settings, ShieldAlert } from "lucide-react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

function StubPage({ icon: Icon, title, milestone, children }: {
  icon: typeof Radar
  title: string
  milestone: string
  children: ReactNode
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">Scaffolded — implementation scheduled for {milestone}.</p>
      </div>
      <Card>
        <CardHeader>
          <Icon className="size-8 text-muted-foreground" />
          <CardTitle>Coming in {milestone}</CardTitle>
          <CardDescription>The backend models and routes for this feature already exist.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">{children}</CardContent>
      </Card>
    </div>
  )
}

export function AssessmentsPage() {
  return (
    <StubPage icon={Radar} title="Assessments" milestone="milestone 4 (security integration, M1)">
      The assessment wizard will orchestrate: recon (Nmap + DNS) → discovery (ZAP spider) → scanning (ZAP active /
      prober) → AI interpretation, with live SSE progress. The <code>assessments</code> and <code>jobs</code> tables
      already exist in the database.
    </StubPage>
  )
}

export function FindingsPage() {
  return (
    <StubPage icon={ShieldAlert} title="Findings" milestone="milestone 6 (verification & risk, M4)">
      The verification workflow (<code>ai_candidate → verified / false_positive / needs_evidence</code>), severity
      editing, evidence attachments and assessor notes are built here. The <code>findings</code> and{" "}
      <code>evidence</code> tables already exist.
    </StubPage>
  )
}

export function SettingsPage() {
  return (
    <StubPage icon={Settings} title="Settings" milestone="milestone 5 (AI integration, M2)">
      LLM provider management (OpenRouter / DeepSeek / GLM / Ollama): base URL, API key (encrypted at rest),
      per-task model selection and a test-connection button. The <code>llm_providers</code> and{" "}
      <code>llm_task_configs</code> tables already exist.
    </StubPage>
  )
}
