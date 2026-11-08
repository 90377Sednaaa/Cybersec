"""Secret redaction layer (M2 T2.3).

The brief's hard ethical rule: never expose credentials or confidential
information to public AI services. Every prompt that leaves the platform
passes through here first - no exceptions, including the test-connection
ping. Also applied to raw tool content before it is embedded in prompts.

Two mechanisms:
1. pattern scrub - regex table over passwords/tokens/auth headers/private
   keys/dotenv contents/high-entropy secrets, replaced by a featureless
   placeholder;
2. per-target deny list - target-specific terms (hostnames, usernames,
   paths) redacted verbatim.

Replacement is severe on purpose: redacted means the value must not
survive in any recoverable form.
"""

from __future__ import annotations

import re

REDACTED = "[REDACTED]"

# order matters: more specific patterns first so a broader one cannot eat
# the surrounding markers another pattern needs to see
SCRUB_PATTERNS: list[tuple[str, re.Pattern]] = [
    (
        "private_key_block",
        re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"),
    ),
    (
        "auth_header",
        re.compile(r"(?i)\b(Authorization|X-Api-Key|X-Auth-Token|Api-Key|Api-Token)\s*[:=]\s*[^\r\n]+"),
    ),
    (
        "cookie_header",
        re.compile(r"(?i)\b(Set-Cookie|Cookie)\s*:\s*[^\r\n]+"),
    ),
    (
        "bearer_token",
        re.compile(r"(?i)\bbearer\s+[A-Za-z0-9\-._~+/]+=*"),
    ),
    ("jwt", re.compile(r"\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b")),
    (
        # any identifier that ends in a sensitive keyword: password, api_token,
        # client_secret_token, session_id, db_key, ... catches compound names
        # like "secret_token" that plain alternation cannot see
        "credential_assignment",
        re.compile(
            r"(?i)\b([a-z0-9_-]*(?:password|passwd|secret|token|access_key|private_key|session_id|credential)\b)"
            r"[\"']?\s*[:=]\s*(['\"`]?)[^\s'\"`;&\r\n]{4,}\2"
        ),
    ),
    (
        "dotenv_entry",
        re.compile(
            r"(?im)^[ \t]*[A-Z_]{2,}(?:_(?:KEY|SECRET|TOKEN|PASSWORD|PASSPHRASE))\s*=\s*[^\r\n]+"
        ),
    ),
    (
        "url_query_credential",
        re.compile(r"(?i)[?&](password|token|secret|api_key|apikey|access_token)=[^\s&\"']+"),
    ),
    (
        "aws_access_key",
        re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"),
    ),
    (
        "github_token",
        re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,255}\b"),
    ),
    (
        "openai_style_key",
        re.compile(r"\bsk-[A-Za-z0-9_-]{16,}\b"),
    ),
    (
        "url_credential",
        re.compile(r"(?i)\b(https?:\/\/[^\/\s:@]+):([^\/\s@]+)@"),
    ),
    (
        "high_entropy_hex",
        re.compile(r"\b[0-9a-fA-F]{32,64}\b"),
    ),
]


def redact_text(text: str, deny_list: list[str] | None = None) -> str:
    """Scrub secrets from one string. Deny-list terms are matched after the
    pattern table, case-insensitively."""
    for _name, pattern in SCRUB_PATTERNS:
        text = pattern.sub(REDACTED, text)
    for term in deny_list or []:
        term = term.strip()
        if len(term) >= 3:
            text = re.sub(re.escape(term), REDACTED, text, flags=re.IGNORECASE)
    return text


def redact_payload(payload, deny_list: list[str] | None = None):
    """Recursively redact strings inside dicts/lists/tuples meant for a prompt."""
    if isinstance(payload, str):
        return redact_text(payload, deny_list)
    if isinstance(payload, dict):
        return {key: redact_payload(value, deny_list) for key, value in payload.items()}
    if isinstance(payload, (list, tuple)):
        return [redact_payload(item, deny_list) for item in payload]
    return payload


def redact_messages(messages: list[dict], deny_list: list[str] | None = None) -> list[dict]:
    """Redact the content of OpenAI-style chat messages. Applied by the client
    to EVERY outbound call - this is the compiled form of the ethical rule."""
    return [
        {key: redact_payload(value, deny_list) if key == "content" else value for key, value in message.items()}
        for message in messages
    ]
