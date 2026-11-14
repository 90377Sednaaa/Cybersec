"""DNS recon runner (M1 T1.3).

Resolves A/AAAA records for the target's hostname via `socket.getaddrinfo`
(so the local hosts file is respected - important because Juice Shop usually
runs as `localhost`), and MX/NS/TXT via dnspython when a real domain is given.

At `full_intrusive` it additionally probes a small built-in subdomain wordlist
(queries only - DNS lookups are non-destructive, but the extra traffic is kept
behind the gate anyway so passive assessments stay minimal).
"""

from __future__ import annotations

import asyncio
import json
import socket
from urllib.parse import urlsplit

import dns.resolver

from app.scanner import hostguard
from app.scanner.base import BaseRunner, RunnerError, ScanContext
from app.scanner.registry import register

SUBDOMAIN_WORDLIST = ["www", "mail", "api", "dev", "staging", "test", "admin", "portal", "vpn", "intranet"]

# getaddrinfo has no timeout parameter of its own; a stalled resolver would pin a
# worker thread for the life of the process.
RESOLVE_TIMEOUT_SECONDS = 5.0


async def _resolve(fn, *args):
    """Blocking resolver call off the loop, with a hard timeout.

    The underlying thread cannot be cancelled, so a timed-out lookup may linger
    until the OS resolver gives up - but the job no longer waits for it.
    """
    return await asyncio.wait_for(asyncio.to_thread(fn, *args), timeout=RESOLVE_TIMEOUT_SECONDS)


def target_hostname(base_url: str) -> str:
    return urlsplit(base_url).hostname or ""


def resolve_addr(hostname: str) -> dict:
    """A/AAAA via getaddrinfo; returns {ipv4: [...], ipv6: [...]} (localhost-friendly)."""
    out = {"ipv4": [], "ipv6": []}
    try:
        infos = socket.getaddrinfo(hostname, None)
    except OSError as exc:
        return {"error": str(exc), "ipv4": [], "ipv6": []}
    for family, _, _, _, sockaddr in infos:
        addr = sockaddr[0]
        if family == socket.AF_INET and addr not in out["ipv4"]:
            out["ipv4"].append(addr)
        elif family == socket.AF_INET6 and addr not in out["ipv6"]:
            out["ipv6"].append(addr)
    return out


def resolve_record_type(hostname: str, rtype: str) -> list[str]:
    try:
        answers = dns.resolver.resolve(hostname, rtype, lifetime=5)
    except Exception:  # NXDomain, NoAnswer, no resolver, lifetime errors - all "no data"
        return []
    return sorted(str(r) for r in answers)


@register("dns")
class DnsRunner(BaseRunner):
    async def run(self, ctx: ScanContext) -> None:
        hostname = target_hostname(ctx.target.base_url)
        if not hostname:
            raise RunnerError(f"Could not extract a hostname from base_url '{ctx.target.base_url}'")
        hostguard.check_target(ctx.target)

        ctx.log(f"Resolving records for {hostname}")
        ctx.progress(0.2)
        records: dict = {"hostname": hostname}
        try:
            records["addresses"] = await _resolve(resolve_addr, hostname)
        except asyncio.TimeoutError:
            records["addresses"] = {"ipv4": [], "ipv6": [], "error": "resolver timed out"}

        for i, rtype in enumerate(("MX", "NS", "TXT")):
            if ctx.cancelled():
                raise RunnerError("Cancelled")
            try:
                records[rtype.lower()] = await _resolve(resolve_record_type, hostname, rtype)
            except asyncio.TimeoutError:
                records[rtype.lower()] = []
            ctx.progress(0.2 + 0.2 * (i + 1))

        subdomains: dict[str, list[str]] = {}
        if ctx.is_full:
            ctx.log("Probing subdomain wordlist (full intensity)")
            total = len(SUBDOMAIN_WORDLIST)
            for i, name in enumerate(SUBDOMAIN_WORDLIST):
                if ctx.cancelled():
                    raise RunnerError("Cancelled")
                fqdn = f"{name}.{hostname}"
                try:
                    found = await _resolve(resolve_addr, fqdn)
                except asyncio.TimeoutError:
                    found = {}
                if found.get("ipv4") or found.get("ipv6"):
                    subdomains[fqdn] = found.get("ipv4") or found.get("ipv6")
                ctx.progress(0.8 + 0.15 * i / total)
        records["subdomains"] = subdomains

        ctx.job.raw_output = json.dumps(records)
        n = len(records["addresses"].get("ipv4", []))
        ctx.log(f"DNS done: {n} IPv4 address(es), {len(subdomains)} subdomain hit(s)")
        ctx.progress(1.0)
        ctx.db.commit()
