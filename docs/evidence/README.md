# Evidence pack - Aletheia

**M5 task T5.3.** This directory is the evidence pack for the final report and oral defense. The folders and
their `.gitkeep` files exist so the structure is committed; **no artifacts have been captured yet**. The
scripted capture run is described in [`../qa-checklist.md`](../qa-checklist.md) and is blocked by T5.1
(Nmap / ZAP daemon / Playwright Chromium) and by the lack of a real LLM provider key.

## Folder map

| Folder | Pipeline stage | Artifacts to capture |
|---|---|---|
| `01-scope/` | Define scope | `E-01-target-registry.png`, `E-02-intensity-gate-409.png` |
| `02-recon/` | Reconnaissance | `E-03-dns-job.json` |
| `03-scan/` | Scanning | `E-04-nmap-output.json`, `E-05-prober-and-zap-alerts.png` |
| `04-assessment/` | Security assessment | `E-06-sse-live-log.png`, `E-06b-job-timeline.png` |
| `05-ai/` | AI analysis | `E-07-interpretation-output.json`, `E-08-redaction-test.txt` |
| `06-verification/` | Human verification | `E-09-verification-before-after.png`, `E-09b-viewer-403.png`, `E-10-evidence-detail.png` |
| `07-risk/` | Risk assessment | `E-11-risk-table.png`, `E-11b-dashboard.png` |
| `08-report/` | Report generation | `E-12-generated-report.pdf`, `E-13-dashboard-themes.png` |
| `99-exports/` | Cross-cutting | `E-14-verification-log.txt`, `E-15-member-contributions.md`, `E-16-verified-findings.csv` |

Artifact IDs are stable: the same ID appears in `qa-checklist.md`, the rubric traceability table and the
presentation skeleton. Do not rename an artifact without updating all three.

## Naming rules

- `E-NN-short-name.png` for screenshots, `.json` / `.csv` / `.txt` for exports, `.pdf` for reports.
- Use a lowercase, hyphenated short name; no spaces, no dates in filenames (dates go in the checklist).
- One artifact per claim. If a screenshot needs explaining, add a sibling `E-NN-short-name.md` with a
  two-line caption: what it shows and which checklist row it satisfies.

## Hygiene (hard rules)

- **Never** capture a real LLM API key, a JWT, an `Authorization` header, or an unredacted prompt. Settings
  screenshots must show `has_api_key: true` and nothing else.
- Evidence uploads and generated PDFs that live under `backend/evidence/` and `backend/reports/` are
  gitignored runtime artifacts. Only a deliberately exported, sanitised copy belongs here.
- Only local Juice Shop and the team's own site may appear in screenshots. No third-party host, no real
  customer data.
- Keep a generated PDF here only if it contains no secrets; it is a graded deliverable, so it is worth the
  extra check.

## Definition of done

Every row of `qa-checklist.md` §2 has a matching file, every rubric line in §3 links at least one artifact,
and the sign-off table in §6 is filled. Until then this pack is a scaffold, not evidence.
