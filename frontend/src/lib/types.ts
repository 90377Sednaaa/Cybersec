export type Role = "admin" | "assessor" | "viewer"

export interface User {
  id: number
  email: string
  full_name: string
  role: Role
}

export interface TokenResponse {
  access_token: string
  token_type: string
  role: Role
  full_name: string
}

export type ScanIntensity = "passive_safe" | "full_intrusive"

export interface Target {
  id: number
  name: string
  base_url: string
  authorization_ref: string
  allowed_intensity: ScanIntensity
  in_scope_assets: string[]
  out_of_scope_assets: string[]
  created_at: string
}

export interface TargetCreate {
  name: string
  base_url: string
  authorization_ref: string
  allowed_intensity: ScanIntensity
  in_scope_assets: string[]
  out_of_scope_assets: string[]
}

export const ASSESSMENT_CATEGORIES = [
  "Input validation & injection",
  "Security configuration & HTTPS",
  "Exposed files & directories",
  "Information disclosure",
  "Session management",
] as const

// ---- Assessments (mirrors backend/app/schemas/assessment.py) ----

export type AssessmentStatus =
  | "draft"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"

export type JobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"

export interface AssessmentCreate {
  target_id: number
  intensity?: ScanIntensity | null
  categories?: string[]
}

export interface Job {
  id: number
  assessment_id: number | null
  tool: string
  command: string
  status: JobStatus
  progress: number
  started_at: string | null
  finished_at: string | null
}

export interface Assessment {
  id: number
  target_id: number
  intensity: ScanIntensity
  categories: string[]
  status: AssessmentStatus
  started_at: string | null
  finished_at: string | null
  notes: string
}

export interface AssessmentDetail extends Assessment {
  jobs: Job[]
}

export type ScanEvent =
  | { type: "log"; job_id: number; line: string }
  | { type: "job"; job_id: number; status: JobStatus; progress: number }
  | { type: "assessment"; status: AssessmentStatus }
  | { type: "snapshot"; assessment: AssessmentDetail }


  // ---- Findings, evidence, reports (mirrors schemas/common.py + schemas/findings.py) ----

export type Severity = "info" | "low" | "medium" | "high" | "critical"

// ai_candidate is NOT confirmed. Only a human assessor can set "verified".
export type FindingStatus =
  | "ai_candidate"
  | "needs_evidence"
  | "verified"
  | "false_positive"

export type EvidenceKind = "http_transcript" | "tool_output" | "upload"

export type ReportStatus = "pending" | "ready" | "failed"

export interface Finding {
  id: number
  assessment_id: number | null
  category: string
  title: string
  description: string
  severity: Severity
  score: number
  status: FindingStatus
  ai_confidence: number
  remediation: string
  assessor_notes: string
}

// Body for PATCH /api/findings/{id}. At least one field is required.
export interface FindingUpdate {
  status?: FindingStatus
  severity?: Severity
  score?: number // 0 to 10
  assessor_notes?: string // max 4000 chars
}

export interface Evidence {
  id: number
  finding_id: number
  kind: EvidenceKind
  label: string
  content: string
  tool: string
  captured_at: string
}

// GET /api/findings/{id}
export interface FindingDetail extends Finding {
  verified_by_id: number | null
  verified_at: string | null
  verified_by: string | null // email of the verifying user
  evidence: Evidence[]
}

export interface Report {
  id: number
  assessment_id: number
  status: ReportStatus
  error: string
  created_at: string
  finished_at: string | null
}

// ---- LLM settings (mirrors schemas/common.py) ----

export interface LLMProvider {
  id: number
  name: string
  base_url: string
  enabled: boolean
  has_api_key: boolean // the key itself is never returned
  acknowledged_external_at: string | null
}

// Body for creating/updating a provider. api_key is write-only.
export interface LLMProviderInput {
  name: string
  base_url: string
  api_key?: string
  enabled?: boolean
  // Required when enabling a provider: admin acknowledges that redacted
  // scan data may be sent to an external AI service.
  acknowledged_external_processing?: boolean | null
  // Required before the server accepts a private/loopback base_url: the admin
  // confirms the endpoint is a local model server (Ollama, LM Studio, vLLM).
  local_endpoint?: boolean
}

export interface LLMTaskConfig {
  task: string
  provider_id: number | null
  model: string
  temperature: number
  effort: string // model-specific reasoning effort, empty when temperature is used
}

export interface LLMSettings {
  providers: LLMProvider[]
  task_configs: LLMTaskConfig[]
}

export interface LLMTestResult {
  ok: boolean
  model: string
  latency_ms: number | null
  error: string
}

// GET /api/settings/llm/providers/{id}/models (additive, read-only)
export interface LLMModel {
  id: string
  name: string
  free: boolean
  prompt_price: number | null // USD per 1M input tokens
  completion_price: number | null
  context_length: number | null
  reasoning: boolean
  structured_outputs: boolean
  zero_data_retention: boolean
  supported_efforts: string[]
  default_effort: string | null
  source: "live" | "preset"
}

export interface LLMModelsResponse {
  provider_id: number
  source: "live" | "unavailable"
  zdr_supported: boolean
  zdr_filter: boolean
  models: LLMModel[]
  notice: string
}