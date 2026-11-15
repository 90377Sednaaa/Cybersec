# Final Report - Aletheia (draft skeleton)

**M5 task T5.5 / course milestone 7.** Status: **structure only**, assembled 2026-11-15. This is the
assembly plan for the final report, not the finished document.

Per `TASK_PLAN.md` T5.5, the report is built from **M4's generated PDF** plus the methodology. That PDF cannot
be generated yet because Playwright Chromium is missing (M5 T5.1), and the AI summary needs a real provider
key. Sections marked `[TO FILL]` must be populated after integration wave **I4** passes. Nothing here claims
a result that has not been observed.

Before submission: add course code, team member names/IDs, submission date, and replace every `[TO FILL]`
marker. Paste the official rubric wording where the checklist references it.

---

## Front matter

- Title, team name, member names and student IDs: `[TO FILL]`
- Course, instructor, submission date: `[TO FILL]`
- Abstract (150-200 words): `[TO FILL from §1-§3 + demo result]`
- Keywords: security assessment, human-in-the-loop, LLM, OWASP, vulnerability verification

## 1. Introduction

- Problem: raw scanner output is voluminous; manual triage is slow; fully automated AI triage is unsafe
  because it can fabricate findings and leak confidential data. Source: `docs/proposal.md` §1-§2.
- Contribution: a platform where tools scan, AI interprets and summarizes, and a human assessor confirms
  every finding. The invariant `verified` is unreachable without a human.
- Report outline.

## 2. Objectives and scope

- Objectives O1-O6 from `docs/proposal.md` §3; restate the measurable acceptance signals.
- In scope / out of scope from `PLAN.md` §§2-7, §12.
- Authorized targets: local OWASP Juice Shop and the team's own site; no unregistered host is scannable.

## 3. Background and related work / frameworks

- OWASP Risk Rating Methodology (likelihood x impact -> severity, 0-10 bands): `docs/risk-methodology.md`.
- OWASP Top 10 for category language; OWASP Cheat Sheet Series for remediation text.
- The four integrated tools and what each contributes: Nmap, OWASP ZAP, custom HTTP prober, dnspython.
- Why an OpenAI-compatible, provider-agnostic LLM client: OpenRouter primary, Ollama offline fallback.
- `[TO FILL: any additional references the instructor expects]`

This section carries the "security methodology and framework references" grading line, so each framework
must be tied to a concrete place in the implementation, not just cited.

## 4. System design

- Architecture, ERD, workflow and finding state machine: reproduce the diagrams from
  `docs/system-design.md` (they were checked against the code).
- Module descriptions M1-M5 and the ownership matrix from `TASK_PLAN.md`.
- Data model: ten tables, and the honest delta that `raw_results` from `PLAN.md` §9 became
  `jobs.raw_output` in the shipped schema.
- Design decisions worth defending:
  1. In-process asyncio worker + SSE instead of Celery/Redis.
  2. Deterministic checks bypass the AI; the LLM handles only non-deterministic interpretation.
  3. `ai_candidate` is a workflow state, not a claim about origin.
  4. Intrusiveness is data (`allowed_intensity`), re-checked server-side at scheduling time.
  5. Redaction and encrypted keys as a precondition, not an add-on.

## 5. Implementation

| Module | What shipped | Where | Verification |
|---|---|---|---|
| M1 | Four runners, registry, orchestrator, SSE, cancel, intensity gate | `app/scanner/**`, `app/api/assessments.py` | `docs/member-logs/m1-scan-engine.md` |
| M2 | Client, encrypted settings, live model catalog, redaction, interpretation, summarization, `ai_outputs` audit | `app/ai/**`, `app/api/settings_llm.py` | `docs/member-logs/m2-ai-pipeline.md` |
| M3 | Wizard, live run page, findings workflow, settings, dashboard, report UI, both themes | `frontend/src/**` | `docs/member-logs/m3-frontend.md` |
| M4 | Verification state machine, evidence, risk mapping, PDF pipeline, auth hardening | `app/api/findings.py`, `app/api/reports.py`, `app/reporting.py` | `docs/member-logs/m4-findings-reports.md` |
| M5 | Proposal, system design, setup script, QA/evidence pack, integration log, this report | `docs/**`, `scripts/setup-dev.ps1` | `docs/member-logs/m5-docs-qa-deploy.md` |

- Test totals: `[TO FILL: pytest count from AGENTS.md after final run]`
- Build/lint results: `[TO FILL]`

## 6. AI integration and its limitations

This section is graded explicitly ("Understanding of AI integration and limitations"), so be blunt.

- **Where AI is used:** scan-result interpretation into JSON-schema-constrained candidate findings; executive
  summary and per-finding explanation/remediation for the report. Stretch features (prioritization, grounded
  Q&A) were not committed.
- **Where AI is deliberately not used:** deterministic checks (missing headers, exposed files) are inserted
  by the normalizer as `ai_candidate` with `ai_confidence = 1.0`. A regex is more reliable than a model here.
- **Guardrails:** redaction before every call, encrypted provider keys, per-task model/effort config,
  validate-and-retry for malformed output, an `AIOutput` audit row for every attempt (success or failure),
  and graceful `NoProviderConfigured` behaviour.
- **Limitations to state honestly:** hallucinated findings are possible, which is exactly why every output is
  a candidate; model quality depends on the provider and prompt; there is no prompt-evaluation harness; no
  real key is configured in the development environment, so live AI results are `[TO FILL after I3]`; context
  limits mean raw output is summarized, not passed verbatim.

## 7. Security, ethics and the hard rules

- Authorized targets only; `authorization_ref` required; intensity gate returns 409 and is re-checked in the
  orchestrator; SSRF host guard on every redirect hop.
- Human verification: state machine, 403 for viewers, 409 for illegal transitions and overlapping decisions,
  attributable `verified_by`/`verified_at`.
- Secrets: Fernet at rest, write-only over the API, never logged, redacted before external calls.
- Role model and session revocation on password change (`token_version` / `tv` claim).
- Known auth limitations from `docs/auth-checklist.md`: no rate limiting, no 2FA, no per-token revocation.

## 8. Evaluation and QA

- Static gate: build, lint, 268-test baseline (verify and update the number).
- Scripted demo run: the eight steps in `docs/qa-checklist.md` §2, with artifact IDs `E-01`..`E-16`.
- Integration waves I1-I4: `docs/INTEGRATION_LOG.md`. **Result: `[TO FILL after I4]`**.
- Rubric traceability: `docs/qa-checklist.md` §3. **Result: `[TO FILL after evidence capture]`**.
- Negative/security checks S1-S8: **Result: `[TO FILL]`**.
- Demo metrics: number of jobs, candidates generated, candidates verified, false positives, findings by
  severity, report page count. **`[TO FILL from the generated PDF]`**.

## 9. Results and discussion

- Insert the generated PDF as Appendix A and quote its cover, methodology, risk table and recommendations.
- Discuss what the demo proved and what it did not. State up front the limitations from
  `docs/qa-checklist.md` §5: pending tool installs, missing provider key, unenforced SQLite FKs, single-process
  worker, no frontend test harness, no login rate limiting.
- `[TO FILL: interpretation of the results]`

## 10. Limitations and future work

Ordered as in `TASK_PLAN.md` § Timeline cut line, but framed as future work: a durable worker queue for
restart-safe runs, enforced foreign keys with cascade rules, rate limiting, a frontend test harness, Nuclei,
risk prioritization, grounded Q&A, and a containerized deployment.

## 11. Conclusion

`[TO FILL after I4: one paragraph, restate the human-in-the-loop contribution and the demo outcome]`

## 12. References

`docs/PLAN.md`, `docs/TASK_PLAN.md`, `docs/system-design.md`, `docs/risk-methodology.md`,
`docs/auth-checklist.md`, `docs/fix-plan.md`, the five member logs, OWASP Risk Rating Methodology, OWASP Top
10, OWASP Cheat Sheet Series, OWASP Juice Shop, Nmap, OWASP ZAP, FastAPI, React. `[TO FILL: full citation
format required by the course]`

---

## Appendices

- **Appendix A:** the generated assessment PDF (`docs/evidence/08-report/E-12-generated-report.pdf`) -
  `[TO FILL: not yet generated]`
- **Appendix B:** QA checklist and evidence index (`docs/qa-checklist.md`, `docs/evidence/README.md`)
- **Appendix C:** integration log I1-I4 (`docs/INTEGRATION_LOG.md`)
- **Appendix D:** API surface and ERD (`docs/system-design.md` §3, §5)
- **Appendix E: per-member contributions.** Each section is written and reviewed by its own member; M5
  assembles but does not write another member's account.

| Member | Section owner | Status |
|---|---|---|
| M1 Scan engine | `[name]` | `[TO FILL]` - approach, decisions, verification, defense notes |
| M2 AI pipeline | `[name]` | `[TO FILL]` - approach, decisions, verification, defense notes |
| M3 Frontend | `[name]` | `[TO FILL]` - approach, decisions, verification, defense notes |
| M4 Findings & reports | `[name]` | `[TO FILL]` - approach, decisions, verification, defense notes |
| M5 Docs/QA/deploy | `[name]` | `[TO FILL]` - approach, decisions, verification, defense notes |

Each member's section should answer: what I built, why I built it that way, what I verified, what I would
change, and what I can defend in the oral exam. Use `docs/member-logs/` as the source of truth.
