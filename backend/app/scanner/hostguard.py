"""Outbound host safety (proposal 05, accepted 2026-11-14).

The single place that decides "may this run contact this host?", used by every
runner so the policy cannot drift between dns, nmap, prober and zap.

Policy:
- public addresses: allowed
- loopback / private / link-local / reserved: allowed **only** when the target
  carries a non-empty ``authorization_ref`` AND the host is listed in
  ``in_scope_assets``
- cloud metadata addresses: blocked unconditionally, even with an
  authorization record - nothing in an assessment needs instance credentials

Why resolve instead of string-matching the URL: a hostname is not an address.
``http://localhost``, ``http://127.0.0.1`` and a DNS name pointing at
``10.0.0.5`` are the same target, and a public host can 302 to any of them.
Every hop is therefore checked after resolution, which is why the prober
validates redirects through an httpx request hook.

Known limitation (accepted): a host that fails to resolve at check time is
allowed through, because it cannot be contacted either. A deliberately
rebinding DNS server could resolve publicly for this check and privately for
the connection.
"""

from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlsplit

from app.scanner.base import RunnerError

# Addresses that hand out cloud credentials. Refused before the authorization
# check runs, so even an "authorized" target cannot reach them.
METADATA_ADDRESSES = {
    "169.254.169.254",  # AWS / GCP / Azure / OpenStack instance metadata
    "169.254.170.2",  # AWS ECS task credentials
    "100.100.100.200",  # Alibaba Cloud
    "fd00:ec2::254",  # AWS IPv6 metadata
}


class HostBlocked(RunnerError):
    """The target host may not be contacted. The message is safe to show."""


def _asset_hosts(in_scope_assets: list[str] | None) -> set[str]:
    """Hostnames from the in-scope list. Entries may be full URLs or bare hosts."""
    hosts: set[str] = set()
    for entry in in_scope_assets or []:
        raw = str(entry).strip()
        if not raw:
            continue
        if "://" in raw:
            host = urlsplit(raw).hostname
        else:
            host = raw.split("/")[0].split(":")[0]
        if host:
            hosts.add(host.lower())
    return hosts


def resolve_addresses(host: str) -> set[str]:
    """Every address a hostname currently maps to. Empty when it cannot resolve."""
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return set()
    return {info[4][0] for info in infos}


def _is_restricted(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    return ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_unspecified


def classify_address(raw: str) -> str:
    """'metadata' | 'restricted' | 'public' | 'invalid'.

    Public so the LLM-provider settings can apply the same policy to a model
    endpoint that the scan engine applies to a target - one definition of
    "is this address safe to talk to", not two.
    """
    try:
        ip = ipaddress.ip_address(raw)
    except ValueError:
        return "invalid"
    if str(ip) in METADATA_ADDRESSES:
        return "metadata"
    return "restricted" if _is_restricted(ip) else "public"


def check_host(
    host: str,
    *,
    authorization_ref: str = "",
    in_scope_assets: list[str] | None = None,
) -> None:
    """Raise HostBlocked when the host must not be contacted."""
    if not host:
        raise HostBlocked("No hostname to contact")

    addresses = resolve_addresses(host)
    if not addresses:
        # Unresolvable: nothing to protect against, and the caller's own
        # connection error is the more useful message.
        return

    for raw in sorted(addresses):
        kind = classify_address(raw)
        if kind == "invalid":
            continue

        if kind == "metadata":
            raise HostBlocked(
                f"Refusing to contact cloud metadata address {raw} (via '{host}'). "
                "Instance credentials are never an assessment target."
            )

        if kind == "restricted":
            authorized = bool((authorization_ref or "").strip()) and host.lower() in _asset_hosts(in_scope_assets)
            if not authorized:
                raise HostBlocked(
                    f"Refusing to contact non-public host '{host}' ({raw}): it resolves to a private, "
                    "loopback or link-local address and the target has no authorization reference "
                    "listing it in in-scope assets."
                )


def check_target(target) -> None:
    """Convenience wrapper: validate a Target row's base_url host."""
    host = urlsplit(str(target.base_url)).hostname or ""
    check_host(host, authorization_ref=target.authorization_ref or "", in_scope_assets=target.in_scope_assets)


def request_guard(target):
    """httpx async request hook: validates EVERY hop, redirects included.

    httpx fires request hooks inside its redirect loop (verified: a 302 chain
    produces one hook call per hop), so a public target cannot bounce the
    prober onto an internal address.
    """

    async def guard(request) -> None:
        check_host(
            request.url.host,
            authorization_ref=getattr(target, "authorization_ref", "") or "",
            in_scope_assets=getattr(target, "in_scope_assets", None),
        )

    return guard
