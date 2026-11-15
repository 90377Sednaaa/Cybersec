# Presentation Skeleton - Aletheia

**M5 task T5.5 / course milestone 7.** Status: slide outline only, assembled 2026-11-15. This is the deck
skeleton to be filled after integration wave **I4** passes and the evidence pack exists. It is not a
finished presentation, and no slide claims a result that has not been captured.

Deck conventions: one message per slide, one artifact per claim, no screenshot containing a real API key or
JWT, dark and light theme screenshots side by side where UI is shown. Artifact IDs `E-NN` come from
`docs/qa-checklist.md`; replace every `[TO FILL]` before rehearsal.

---

## Slide plan

| # | Title | Key message (one sentence) | Owner | Evidence | Status |
|---|---|---|---|---|---|
| 1 | Title | Aletheia: tools scan, AI reads, humans confirm | M5 | `frontend/src/assets/aletheia-logo.png` | skeleton |
| 2 | The problem | Raw scanner output is voluminous; fully automated AI triage is unsafe | M5 | `docs/proposal.md` §1 | skeleton |
| 3 | The idea / invariant | **No finding counts as confirmed until a human assessor verifies it** | M5 | `docs/system-design.md` §4.1 state machine | skeleton |
| 4 | Scope and authorization | Only registered, authorized targets; intensity gate returns 409 server-side | M1 | `E-01`, `E-02` | `[TO FILL]` |
| 5 | Architecture | Two-process app: React SPA + FastAPI, with an in-process scan worker | M5 | `docs/system-design.md` §2 flowchart | skeleton |
| 6 | Data model | Ten tables; jobs carry raw output; findings carry the verification audit | M5 | `docs/system-design.md` §3 ERD | skeleton |
| 7 | The eight-step pipeline | Scope -> recon -> scan -> assessment -> AI -> verification -> risk -> report | M5 | `docs/system-design.md` §4 sequence diagram | skeleton |
| 8 | Integrated tools (M1) | Four tools feed one normalized result stream; runners fail soft | M1 | `E-03`, `E-04`, `E-05` | `[TO FILL]` |
| 9 | Live assessment (M1 + M3) | SSE progress + persisted jobs survive a refresh; cancel is a first-class state | M1 / M3 | `E-06`, `E-06b` | `[TO FILL]` |
| 10 | AI integration (M2) | Interpretation + summaries, with redaction before every call and an audit row per attempt | M2 | `E-07`, `E-08` | `[TO FILL]` |
| 11 | Where AI is not used | Deterministic checks are rules, not model output; AI handles ambiguity only | M2 | `docs/member-logs/m1-scan-engine.md` § Key decisions | skeleton |
| 12 | Human verification (M4 + M3) | State machine, evidence, 403 for viewers, 409 for illegal or overlapping decisions | M4 / M3 | `E-09`, `E-09b`, `E-10` | `[TO FILL]` |
| 13 | Risk and framework reference | OWASP Risk Rating likelihood x impact -> severity -> 0-10 score | M4 | `E-11`, `docs/risk-methodology.md` | skeleton |
| 14 | Dashboard and report | Live counts via `X-Total-Count`; Jinja2 HTML to Playwright PDF from verified findings | M3 / M4 | `E-11b`, `E-12` | `[TO FILL]` |
| 15 | QA and evidence | 268 tests, build/lint gate, the negative checks S1-S8, evidence pack mapped to rubric lines | M5 | `E-14`, `docs/qa-checklist.md`, `docs/INTEGRATION_LOG.md` | skeleton |
| 16 | Limitations, stated first | Pending tool installs, single-process worker, no rate limiting, unenforced SQLite FKs | M5 | `docs/qa-checklist.md` §5 | skeleton |
| 17 | Individual contributions | Each member defends one vertical module | All | `docs/final-report.md` Appendix E | `[TO FILL]` |
| 18 | Demo / Q&A | Live eight-step run from a clean shell (or recorded fallback) | All | `E-01`..`E-16` | `[TO FILL]` |

**Fallback if the live demo cannot run:** show the recorded rehearsal plus the generated PDF (Appendix A of
`docs/final-report.md`), and state honestly which steps were not executable. A recorded demo is acceptable;
a fabricated pass is not.

---

## Speaker-note template

Copy per slide. Each note must be written by that slide's owner, not by M5.

```
### Slide <N> - <title>
- Owner / speaker:
- Opening line:
- Three points, in order:
- Artifact on screen and the claim it proves:
- Anticipated examiner question and the answer:
- Transition to next slide:
```

## Per-member contribution slides (slide 17 detail)

`TASK_PLAN.md` divides the platform into five vertical modules so each member can defend a coherent slice.
One sub-slide per member, each written and reviewed by that member:

| Member | Module | Suggested content | Source | Status |
|---|---|---|---|---|
| M1 | Scan engine | Runner interface and registry, four wrappers, orchestrator, SSE, intensity gate; the fail-soft decision | `docs/member-logs/m1-scan-engine.md` | `[TO FILL by M1]` |
| M2 | AI pipeline | Provider client, encrypted keys, redaction, interpretation, summarization, audit rows; why a regex beats a model for deterministic checks | `docs/member-logs/m2-ai-pipeline.md` | `[TO FILL by M2]` |
| M3 | Frontend | Wizard, live run page, findings workflow, settings, dashboard, both themes; the keyboard shortcuts and toast polish | `docs/member-logs/m3-frontend.md` | `[TO FILL by M3]` |
| M4 | Findings & reports | Verification state machine, evidence, OWASP risk mapping, PDF pipeline, auth hardening | `docs/member-logs/m4-findings-reports.md` | `[TO FILL by M4]` |
| M5 | Docs/QA/deploy | Proposal, system design, setup script, QA/evidence pack, integration log, final report and this deck | `docs/member-logs/m5-docs-qa-deploy.md` | `[TO FILL by M5]` |

Each sub-slide should end with one sentence a member can say in the oral defense: "The decision I would
defend is ..., because ...".

---

## Rehearsal checklist

- [ ] All `[TO FILL]` markers replaced.
- [ ] Every artifact ID resolves to a real file in `docs/evidence/`.
- [ ] No secrets visible in any screenshot.
- [ ] Both themes represented in the UI slides.
- [ ] I4 rehearsal logged in `docs/INTEGRATION_LOG.md` before the demo slide is marked ready.
- [ ] Each member has reviewed their own contribution slide and Appendix E section.
- [ ] Timing run: `[TO FILL minutes]`, with the demo buffer decided at the Day-6 sync.
