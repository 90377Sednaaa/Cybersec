"""HTTP prober runner (M1 T1.4) - our own check engine, no external tool.

Passive (always): fetch the base URL, then run security-header, cookie-flag,
information-disclosure, and TLS-certificate checks.
Full intrusive: additionally probe a small wordlist of commonly exposed files.

Everything deterministic lands in `job.raw_output`; unambiguous rule hits are
turned into `ai_candidate` findings here (M2's interpreter adds the fuzzy ones).
"""

from __future__ import annotations

import asyncio
import json
import uuid
from urllib.parse import urlsplit

import httpx

from app.scanner import hostguard
from app.scanner.base import BaseRunner, RunnerError, ScanContext
from app.scanner.prober import checks
from app.scanner.registry import register

USER_AGENT = "AletheiaProber/0.1"
REQUEST_TIMEOUT = 10.0
PROBE_CONCURRENCY = 6


@register("prober")
class ProberRunner(BaseRunner):
    async def run(self, ctx: ScanContext) -> None:
        parts = urlsplit(ctx.target.base_url)
        scheme, hostname = parts.scheme or "http", parts.hostname
        if not hostname:
            raise RunnerError(f"Invalid base_url '{ctx.target.base_url}'")
        port = parts.port or (443 if scheme == "https" else 80)

        # Refuse a non-public target with no authorization record before opening
        # a socket (proposal 05). The request hook below repeats this per hop.
        hostguard.check_target(ctx.target)

        ctx.log(f"Probing {ctx.target.base_url} (passive checks)")
        ctx.progress(0.1)
        tls_info = await asyncio.to_thread(checks.get_tls_info, hostname, port) if scheme == "https" else None

        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=REQUEST_TIMEOUT,
            headers={"User-Agent": USER_AGENT},
            verify=False,
            # Validates every redirect hop, so an authorized public target cannot
            # bounce the prober onto an internal address.
            event_hooks={"request": [hostguard.request_guard(ctx.target)]},
        ) as client:
            try:
                response = await client.get(ctx.target.base_url)
            except httpx.HTTPError as exc:
                raise RunnerError(
                    f"Target unreachable: {exc}. Is the application running at {ctx.target.base_url}?"
                ) from exc
            ctx.progress(0.4)

            header_facts, header_findings = checks.check_security_headers(response.headers)
            cookie_list, cookie_findings = checks.check_cookies(response.headers)
            disclosure_facts, disclosure_findings = checks.check_disclosure(response.headers, response.text)
            # Pass the full TLS facts (including the datetime) so expiry checks work;
            # the datetime is stripped again when serializing raw output.
            tls_findings = checks.check_tls(tls_info or {})
            ctx.progress(0.6)

            probes: list[tuple[str, int]] = []
            if ctx.is_full:
                probe_paths = checks.allowed_probe_paths(ctx.target.out_of_scope_assets)
                skipped = len(checks.PROBE_PATHS) - len(probe_paths)
                if skipped:
                    ctx.log(f"Scope filter: {skipped} probe path(s) skipped (out of scope)")

                # Capture a baseline for a random nonexistent route so SPAs
                # (like OWASP Juice Shop) returning HTTP 200 index.html do not
                # trigger false positives on every wordlist entry.
                baseline: dict | None = None
                base_root = ctx.target.base_url.rstrip("/")
                try:
                    not_found_resp = await client.get(f"{base_root}/__aletheia_404_{uuid.uuid4().hex[:10]}")
                    if not_found_resp.status_code < 400:
                        body = not_found_resp.content
                        baseline = {
                            "status_code": not_found_resp.status_code,
                            "content_type": not_found_resp.headers.get("content-type", "").split(";", 1)[0].strip().lower(),
                            "length": len(body),
                            "prefix": body[:128],
                        }
                        ctx.log(
                            f"Soft-404 baseline detected (HTTP {baseline['status_code']}, "
                            f"{baseline['content_type'] or 'unknown'}, {baseline['length']} bytes)"
                        )
                except httpx.HTTPError:
                    baseline = None

                ctx.log(f"Probing {len(probe_paths)} common paths (full intensity)")
                sem = asyncio.Semaphore(PROBE_CONCURRENCY)
                completed = 0
                total_paths = max(1, len(probe_paths))

                async def probe_one(path: str) -> tuple[str, int] | None:
                    nonlocal completed
                    async with sem:
                        if ctx.cancelled():
                            raise RunnerError("Cancelled")
                        hit: tuple[str, int] | None = None
                        try:
                            probe = await client.get(base_root + path)
                            if probe.status_code < 400:
                                ct = probe.headers.get("content-type", "")
                                body = probe.content
                                if not checks.is_soft_404(
                                    baseline,
                                    status_code=probe.status_code,
                                    content_type=ct,
                                    body=body,
                                ) and checks.matches_expected_content(path, ct, body):
                                    hit = (path, probe.status_code)
                                    ctx.log(f"  hit: {path} -> {probe.status_code}")
                        except httpx.HTTPError:
                            pass
                        completed += 1
                        ctx.progress(0.6 + 0.35 * completed / total_paths)
                        return hit

                results = await asyncio.gather(*(probe_one(path) for path, _sev, _why in probe_paths))
                probes = [item for item in results if item is not None]
            exposed_findings = checks.check_exposed_paths(ctx.target.base_url, probes)

        candidate_findings = header_findings + cookie_findings + disclosure_findings + tls_findings + exposed_findings
        raw = {
            "url": str(response.url),
            "status_code": response.status_code,
            "headers": header_facts | disclosure_facts,
            "cookies": cookie_list,
            "tls": {k: v for k, v in (tls_info or {}).items() if k != "not_after_dt"},
            "probed_paths": [{"path": p, "status": s} for p, s in probes],
            "candidate_findings": candidate_findings,
        }
        ctx.job.raw_output = json.dumps(raw, default=str)
        ctx.log(f"Prober done: {len(candidate_findings)} deterministic candidate finding(s), {len(probes)} exposed path(s)")
        ctx.progress(1.0)
        ctx.db.commit()
