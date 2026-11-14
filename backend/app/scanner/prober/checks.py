"""Passive and intrusive HTTP checks for the prober (M1 T1.4).

Pure functions that take HTTP/TLS facts and return (raw_facts, candidate_findings).
Kept free of DB/session concerns so they can be unit-tested against canned
responses. Includes the scope-safety filter (out-of-scope paths are never
probed).

Candidate findings are *deterministic* rule results (missing header = missing
header) and are inserted with status `ai_candidate`: per the platform rules
they are still unverified until an assessor confirms them. The AI interpreter
(M2) adds the non-deterministic findings on top of these later.
"""

from __future__ import annotations

import ssl
from datetime import datetime, timezone
from urllib.parse import urlsplit

import httpx

# header -> (expected value or None for "must be present", severity, remediation)
SECURITY_HEADERS = {
    "content-security-policy": (None, "high", "Add a Content-Security-Policy to mitigate XSS and injection risks."),
    "strict-transport-security": (None, "medium", "Add Strict-Transport-Security to force HTTPS connections."),
    "x-content-type-options": ("nosniff", "low", "Send X-Content-Type-Options: nosniff to prevent MIME sniffing."),
    "x-frame-options": (None, "low", "Send X-Frame-options (or a CSP frame-ancestors directive) to deter clickjacking."),
    "referrer-policy": (None, "low", "Send a Referrer-Policy header to control referrer leakage."),
    "permissions-policy": (None, "info", "Send a Permissions-Policy header to restrict powerful browser features."),
}

# (path, severity, why it matters) - probed only at full_intrusive
PROBE_PATHS = [
    ("/.env", "high", "Environment file may expose credentials and secrets."),
    ("/.git/HEAD", "high", "Exposed .git directory leaks the full source history."),
    ("/backup.zip", "high", "Backup archive may contain application source and secrets."),
    ("/backup.tar.gz", "high", "Backup archive may contain application source and secrets."),
    ("/composer.json", "low", "Dependency manifest reveals the exact stack versions."),
    ("/package.json", "low", "Dependency manifest reveals the exact stack versions."),
    ("/debug.log", "medium", "Debug logs often contain stack traces and secrets."),
    ("/error.log", "medium", "Error logs often contain stack traces and internal paths."),
    ("/admin/", "medium", "Admin panel reachable without authentication gate at this path."),
    ("/server-status", "medium", "Apache server-status leaks requests and internal endpoints."),
    ("/.DS_Store", "low", "macOS metadata file leaks directory listings."),
]


def check_security_headers(headers: httpx.Headers) -> tuple[dict, list[dict]]:
    facts = {k: headers.get(k) for k in SECURITY_HEADERS}
    findings = []
    for name, (expected, severity, remediation) in SECURITY_HEADERS.items():
        value = headers.get(name)
        missing = value is None or (expected is not None and value.lower() != expected)
        if missing:
            findings.append(
                {
                    "category": "Security configuration & HTTPS",
                    "title": f"Missing security header: {name}"
                    + ("" if expected is None else f" (expected: {expected})"),
                    "severity": severity,
                    "remediation": remediation,
                }
            )
    return facts, findings


def check_cookies(headers: httpx.Headers) -> tuple[list[str], list[dict]]:
    cookies: list[str] = headers.get_list("set-cookie")
    findings = []
    for cookie in cookies:
        lower = cookie.lower()
        name = cookie.split("=", 1)[0].strip()
        if "httponly" not in lower:
            findings.append(
                {
                    "category": "Session management",
                    "title": f"Cookie '{name}' missing HttpOnly flag",
                    "severity": "low",
                    "remediation": "Set the HttpOnly attribute so scripts cannot read the session cookie.",
                }
            )
        if "secure" not in lower:
            findings.append(
                {
                    "category": "Session management",
                    "title": f"Cookie '{name}' missing Secure flag",
                    "severity": "low",
                    "remediation": "Set the Secure attribute so the cookie is only sent over HTTPS.",
                }
            )
    return cookies, findings


def check_disclosure(headers: httpx.Headers, body: str) -> tuple[dict, list[dict]]:
    facts = {"server": headers.get("server", ""), "x_powered_by": headers.get("x-powered-by", "")}
    findings = []
    if facts["server"]:
        findings.append(
            {
                "category": "Information disclosure",
                "title": f"Server banner disclosed: {facts['server']}",
                "severity": "info",
                "remediation": "Remove or generalize the Server header so version-specific exploits are harder to target.",
            }
        )
    if facts["x_powered_by"]:
        findings.append(
            {
                "category": "Information disclosure",
                "title": f"Technology disclosed via X-Powered-By: {facts['x_powered_by']}",
                "severity": "info",
                "remediation": "Remove the X-Powered-By header; it advertises the exact framework and version.",
            }
        )
    return facts, findings


def check_tls(cert: dict | None) -> list[dict]:
    if not cert:
        return []
    findings = []
    # get_tls_info serializes `not_after` to an ISO string for JSON storage and
    # keeps the datetime under `not_after_dt` (the prober strips that key before
    # writing raw_output). Read the datetime first or expiry checks never fire.
    not_after = cert.get("not_after_dt") or cert.get("not_after")
    if isinstance(not_after, datetime):
        days_left = (not_after - datetime.now(timezone.utc)).days
        if days_left < 0:
            findings.append(
                {
                    "category": "Security configuration & HTTPS",
                    "title": f"TLS certificate expired {-days_left} day(s) ago",
                    "severity": "high",
                    "remediation": "Renew the TLS certificate immediately; clients cannot establish trusted connections.",
                }
            )
        elif days_left < 30:
            findings.append(
                {
                    "category": "Security configuration & HTTPS",
                    "title": f"TLS certificate expires in {days_left} day(s)",
                    "severity": "medium",
                    "remediation": "Renew the TLS certificate before expiry.",
                }
            )
    if cert.get("self_signed"):
        findings.append(
            {
                "category": "Security configuration & HTTPS",
                "title": "Self-signed TLS certificate",
                "severity": "medium",
                "remediation": "Deploy a certificate from a trusted CA (or your internal CA root on clients).",
            }
        )
    return findings


def is_path_allowed(path: str, out_of_scope_assets: list[str] | None) -> bool:
    """Scope-safety filter (T1.4 acceptance: the prober never touches
    out-of-scope paths). Entries may be full URLs or paths; prefix matching on
    the normalized path. Pure function for unit testing."""
    for entry in out_of_scope_assets or []:
        blocked = urlsplit(entry).path if "://" in entry else entry
        blocked = (blocked or "").rstrip("/")
        if not blocked:
            continue
        if path == blocked or path.startswith(blocked + "/"):
            return False
    return True


def allowed_probe_paths(out_of_scope_assets: list[str] | None) -> list[tuple[str, str, str]]:
    return [(p, s, w) for p, s, w in PROBE_PATHS if is_path_allowed(p, out_of_scope_assets)]


def check_exposed_paths(base_url: str, hits: list[tuple[str, int]]) -> list[dict]:
    findings = []
    for path, status in hits:
        severity, why = next(((s, w) for p, s, w in PROBE_PATHS if p == path), ("medium", "Resource is exposed."))
        findings.append(
            {
                "category": "Exposed files & directories",
                "title": f"Exposed resource {path} (HTTP {status})",
                "severity": severity,
                "remediation": why + " Restrict access or remove the resource.",
            }
        )
    return findings


def get_tls_info(hostname: str, port: int) -> dict | None:
    """Fetch certificate facts directly (no verification) so self-signed certs are reportable."""
    if port != 443:
        return None
    try:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        import socket

        with socket.create_connection((hostname, 443), timeout=5) as sock:
            with ctx.wrap_socket(sock, server_hostname=hostname) as tls:
                der = tls.getpeercert(binary_form=True)
                if not der:
                    return None
        import hashlib

        # Decode with cryptography (available: it is already a backend dependency).
        from cryptography import x509
        from cryptography.hazmat.primitives import hashes, serialization

        cert_obj = x509.load_der_x509_certificate(der)
        subject = cert_obj.subject.rfc4514_string()
        issuer = cert_obj.issuer.rfc4514_string()
        not_after = cert_obj.not_valid_after_utc
        self_signed = cert_obj.issuer == cert_obj.subject
        sha256 = hashlib.sha256(der).hexdigest()[:16]
        return {
            "subject": subject,
            "issuer": issuer,
            "not_after": not_after.isoformat(),
            "not_after_dt": not_after,
            "self_signed": self_signed,
            "sha256_prefix": sha256,
        }
    except Exception:
        return None
