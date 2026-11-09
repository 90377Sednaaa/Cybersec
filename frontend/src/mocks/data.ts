import type {
  AssessmentDetail,
  FindingDetail,
  LLMSettings,
  Report,
  ScanEvent,
  Target,
} from "@/lib/types"

// Fake data shaped like the real API responses (see src/lib/types.ts).
// Used while building pages before the live backend is wired in.

export const mockTargets: Target[] = [
  {
    id: 1,
    name: "OWASP Juice Shop (lab)",
    base_url: "http://localhost:3000",
    authorization_ref: "Instructor-approved lab target",
    allowed_intensity: "full_intrusive",
    in_scope_assets: ["localhost:3000"],
    out_of_scope_assets: [],
    created_at: "2026-11-09T01:00:00Z",
  },
]

export const mockAssessments: AssessmentDetail[] = [
  {
    id: 1,
    target_id: 1,
    intensity: "full_intrusive",
    categories: [
      "Security configuration & HTTPS",
      "Information disclosure",
      "Exposed files & directories",
    ],
    status: "completed",
    started_at: "2026-11-09T02:00:00Z",
    finished_at: "2026-11-09T02:12:00Z",
    notes: "",
    jobs: [
      {
        id: 1,
        assessment_id: 1,
        tool: "nmap",
        command: "nmap -sV --top-ports 100 localhost",
        status: "completed",
        progress: 1,
        started_at: "2026-11-09T02:00:00Z",
        finished_at: "2026-11-09T02:03:00Z",
      },
      {
        id: 2,
        assessment_id: 1,
        tool: "http_prober",
        command: "probe http://localhost:3000",
        status: "completed",
        progress: 1,
        started_at: "2026-11-09T02:03:00Z",
        finished_at: "2026-11-09T02:05:00Z",
      },
    ],
  },
  {
    id: 2,
    target_id: 1,
    intensity: "passive_safe",
    categories: ["Security configuration & HTTPS"],
    status: "running",
    started_at: "2026-11-09T03:00:00Z",
    finished_at: null,
    notes: "",
    jobs: [
      {
        id: 3,
        assessment_id: 2,
        tool: "nmap",
        command: "nmap -sV --top-ports 100 localhost",
        status: "running",
        progress: 0.4,
        started_at: "2026-11-09T03:00:00Z",
        finished_at: null,
      },
      {
        id: 4,
        assessment_id: 2,
        tool: "http_prober",
        command: "probe http://localhost:3000",
        status: "pending",
        progress: 0,
        started_at: null,
        finished_at: null,
      },
    ],
  },
]

export const mockScanEvents: ScanEvent[] = [
  { type: "snapshot", assessment: mockAssessments[1] },
  { type: "log", job_id: 3, line: "Starting Nmap scan of localhost" },
  { type: "job", job_id: 3, status: "running", progress: 0.6 },
  { type: "log", job_id: 3, line: "Discovered open port 3000/tcp" },
  { type: "job", job_id: 3, status: "completed", progress: 1 },
  { type: "assessment", status: "completed" },
]

export const mockFindings: FindingDetail[] = [
  {
    id: 1,
    assessment_id: 1,
    category: "Security configuration & HTTPS",
    title: "Missing Content-Security-Policy header",
    description:
      "The application does not send a Content-Security-Policy header, which weakens protection against script injection.",
    severity: "medium",
    score: 5.3,
    status: "verified",
    ai_confidence: 0.92,
    remediation: "Add a restrictive Content-Security-Policy response header.",
    assessor_notes: "Confirmed with curl -I.",
    verified_by_id: 1,
    verified_at: "2026-11-09T02:30:00Z",
    verified_by: "admin@example.com",
    evidence: [
      {
        id: 1,
        finding_id: 1,
        kind: "http_transcript",
        label: "Response headers",
        content: "HTTP/1.1 200 OK\nX-Content-Type-Options: nosniff\n(no Content-Security-Policy)",
        tool: "http_prober",
        captured_at: "2026-11-09T02:04:00Z",
      },
    ],
  },
  {
    id: 2,
    assessment_id: 1,
    category: "Information disclosure",
    title: "Server version exposed in response headers",
    description: "The response headers reveal server technology details useful to an attacker.",
    severity: "low",
    score: 3.1,
    status: "ai_candidate",
    ai_confidence: 0.71,
    remediation: "Remove or generalize version information in server headers.",
    assessor_notes: "",
    verified_by_id: null,
    verified_at: null,
    verified_by: null,
    evidence: [],
  },
  {
    id: 3,
    assessment_id: 1,
    category: "Exposed files & directories",
    title: "Possible exposed /ftp directory",
    description: "A directory listing may be reachable without authentication.",
    severity: "high",
    score: 7.5,
    status: "needs_evidence",
    ai_confidence: 0.64,
    remediation: "Restrict access to the directory or remove it from the web root.",
    assessor_notes: "Need a screenshot of the listing.",
    verified_by_id: null,
    verified_at: null,
    verified_by: null,
    evidence: [],
  },
]

export const mockLLMSettings: LLMSettings = {
  providers: [
    {
      id: 1,
      name: "OpenRouter",
      base_url: "https://openrouter.ai/api/v1",
      enabled: true,
      has_api_key: true,
      acknowledged_external_at: "2026-11-09T01:30:00Z",
    },
    {
      id: 2,
      name: "Ollama (local)",
      base_url: "http://localhost:11434/v1",
      enabled: false,
      has_api_key: false,
      acknowledged_external_at: null,
    },
  ],
  task_configs: [
    { task: "interpret", provider_id: 1, model: "example-model", temperature: 0.2 },
    { task: "summarize", provider_id: 1, model: "example-model", temperature: 0.2 },
  ],
}

export const mockReports: Report[] = [
  {
    id: 1,
    assessment_id: 1,
    status: "ready",
    error: "",
    created_at: "2026-11-09T02:40:00Z",
    finished_at: "2026-11-09T02:41:00Z",
  },
]