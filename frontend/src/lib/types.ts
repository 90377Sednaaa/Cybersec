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
