"""OWASP ZAP runner (M1 T1.5).

Drives a ZAP daemon via its REST API:
    passive-safe target:  spider only (endpoint discovery)
    full_intrusive:       spider + active scan (actual exploitation attempts)

Designed to degrade gracefully: if the daemon is not reachable the job fails
with an actionable message and the assessment continues with the other tools.
Start ZAP with: zap.bat -cmd -daemon -port 8080 -config api.key=<secret>
"""

from __future__ import annotations

import asyncio
import json

import httpx

from app.scanner.base import BaseRunner, RunnerError, ScanContext
from app.scanner.registry import register

POLL_SECONDS = 2.0
MAX_POLLS = 300  # 10 minutes hard cap per phase

# ZAP alerts span many of our categories; map by alert-name keywords rather
# than hardcoding everything to injection. Default is injection because that
# is what most active-scan plugins probe for.
_CATEGORY_KEYWORDS: list[tuple[tuple[str, ...], str]] = [
    (("cookie", "session", "csrf"), "Session management"),
    (("header", "hsts", "csp", "https", "tls", "certificate"), "Security configuration & HTTPS"),
    (("directory browsing", "backup", "cross-domain", "sensitive file", ".env", "git"), "Exposed files & directories"),
    (("disclosure", "information leak", "banner", "debug", "trace"), "Information disclosure"),
]


def zap_category(alert_title: str) -> str:
    lower = (alert_title or "").lower()
    for keywords, category in _CATEGORY_KEYWORDS:
        if any(k in lower for k in keywords):
            return category
    return "Input validation & injection"


class ZapUnavailable(RunnerError):
    pass


@register("zap")
class ZapRunner(BaseRunner):
    def _client(self) -> httpx.AsyncClient:
        from app.config import settings

        if not settings.zap_api_url:
            raise ZapUnavailable("ZAP_API_URL is not configured.")
        return httpx.AsyncClient(
            base_url=settings.zap_api_url.rstrip("/"), timeout=10.0, params={"apikey": settings.zap_api_key}
        )

    async def _wait_phase(self, client: httpx.AsyncClient, view: str, ctx: ScanContext, lo: float, hi: float) -> None:
        for i in range(MAX_POLLS):
            if ctx.cancelled():
                raise RunnerError("Cancelled")
            resp = await client.get(view)
            resp.raise_for_status()
            progress = int(resp.json().get("status", "0")) / 100.0
            ctx.progress(lo + (hi - lo) * progress)
            if progress >= 1.0:
                return
            await asyncio.sleep(POLL_SECONDS)
        raise RunnerError(f"ZAP {view} did not finish within the time cap")

    async def run(self, ctx: ScanContext) -> None:
        try:
            async with self._client() as client:
                try:
                    version = (await client.get("/JSON/core/view/version/")).json().get("version", "?")
                except httpx.HTTPError as exc:
                    raise ZapUnavailable(
                        f"ZAP daemon unreachable at {client.base_url} - start it with "
                        "`zap.bat -cmd -daemon -port 8080 -config api.key=<secret>` (PLAN.md section 11)."
                    ) from exc
                ctx.log(f"Connected to ZAP {version}")
                ctx.progress(0.05)

                # Spider (endpoint discovery) - always.
                ctx.log(f"Spidering {ctx.target.base_url}")
                await client.post("/JSON/spider/action/scan/", params={"url": ctx.target.base_url})
                await self._wait_phase(client, "/JSON/spider/view/status/", ctx, 0.05, 0.45)

                alerts: list[dict] = []

                # Active scan - only when the intensity gate allows intrusion.
                if ctx.is_full:
                    ctx.log("Active scan starting (full intensity)")
                    await client.post("/JSON/pscan/action/enableAllScanners/")
                    await client.post("/JSON/ascan/action/scan/", params={"url": ctx.target.base_url})
                    await self._wait_phase(client, "/JSON/ascan/view/status/", ctx, 0.45, 0.9)
                else:
                    ctx.log("Skipping active scan: target is passive_safe")
                    ctx.progress(0.9)

                resp = await client.get(
                    "/JSON/core/view/alerts/", params={"baseurl": ctx.target.base_url, "start": 0, "count": 500}
                )
                alerts = resp.json().get("alerts", [])

            # Normalise ZAP alerts into our raw structure.
            normalised = [
                {
                    "plugin_id": a.get("pluginId"),
                    "title": a.get("name"),
                    "risk": a.get("risk"),  # informational/low/medium/high (ZAP scale)
                    "confidence": a.get("confidence"),
                    "url": a.get("url"),
                    "description": (a.get("description") or "")[:1500],
                    "solution": (a.get("solution") or "")[:1500],
                    "evidence": (a.get("evidence") or "")[:500],
                    "cwe": a.get("cweid"),
                }
                for a in alerts
            ]
            ctx.job.raw_output = json.dumps(
                {"mode": "full_intrusive" if ctx.is_full else "passive_safe", "alerts": normalised}
            )
            ctx.log(f"ZAP done: {len(normalised)} alert(s)")
            ctx.progress(1.0)
            ctx.db.commit()
        except httpx.HTTPError as exc:
            raise ZapUnavailable(f"ZAP communication failed mid-run: {exc}") from exc
