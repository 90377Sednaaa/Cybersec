"""AI pipeline (M2): LLM client, secret redaction, interpretation, summaries.

House rules (PLAN.md / AGENTS.md hard rules):
- every prompt passes the redaction layer before any provider call
- API keys are Fernet-encrypted at rest and never logged or returned
- AI output is only ever candidates (`ai_candidate`) - the human assessor confirms
"""
