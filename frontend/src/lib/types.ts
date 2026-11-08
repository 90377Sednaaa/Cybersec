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
