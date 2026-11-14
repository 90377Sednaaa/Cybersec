"""Outbound host safety (Wave 2b: proposal 05's accepted policy).

Policy under test:
- public address                     -> allowed
- private / loopback / link-local    -> allowed only with an authorization
  reference AND the host in in_scope_assets
- cloud metadata                     -> always blocked
- every redirect hop                 -> re-checked
"""

import asyncio
import http.server
import threading
from types import SimpleNamespace

import httpx
import pytest

from app.scanner import hostguard


@pytest.fixture()
def fake_dns(monkeypatch):
    """Point a hostname at a chosen address without touching real DNS."""

    def install(mapping: dict[str, str]):
        monkeypatch.setattr(hostguard, "resolve_addresses", lambda host: {mapping[host]} if host in mapping else set())

    return install


def test_public_address_is_allowed(fake_dns):
    fake_dns({"example.com": "93.184.216.34"})
    hostguard.check_host("example.com")  # no exception


@pytest.mark.parametrize("address", ["127.0.0.1", "10.0.0.5", "192.168.1.10", "169.254.1.1", "::1"])
def test_non_public_address_requires_an_authorization_record(fake_dns, address):
    fake_dns({"internal.test": address})

    with pytest.raises(hostguard.HostBlocked):
        hostguard.check_host("internal.test")

    # An authorization reference alone is not enough - the host must be in scope.
    with pytest.raises(hostguard.HostBlocked):
        hostguard.check_host("internal.test", authorization_ref="AUTH-1", in_scope_assets=["other.test"])

    # Both together are enough (and URL entries are accepted, not just bare hosts).
    hostguard.check_host(
        "internal.test", authorization_ref="AUTH-1", in_scope_assets=["http://internal.test:8080/app"]
    )


@pytest.mark.parametrize("address", ["169.254.169.254", "169.254.170.2", "100.100.100.200"])
def test_cloud_metadata_is_blocked_even_when_authorized(fake_dns, address):
    fake_dns({"metadata.test": address})
    with pytest.raises(hostguard.HostBlocked) as excinfo:
        hostguard.check_host("metadata.test", authorization_ref="AUTH-1", in_scope_assets=["metadata.test"])
    assert "metadata" in str(excinfo.value).lower()


def test_unresolvable_host_is_not_blocked(fake_dns):
    """Nothing to protect against; the caller's connection error is clearer."""
    fake_dns({})
    hostguard.check_host("does-not-exist.invalid")


def test_check_target_reads_the_row(fake_dns):
    fake_dns({"127.0.0.1": "127.0.0.1"})
    blocked = SimpleNamespace(base_url="http://127.0.0.1:3000", authorization_ref="", in_scope_assets=[])
    with pytest.raises(hostguard.HostBlocked):
        hostguard.check_target(blocked)

    allowed = SimpleNamespace(
        base_url="http://127.0.0.1:3000",
        authorization_ref="AUTH-1",
        in_scope_assets=["http://127.0.0.1:3000"],
    )
    hostguard.check_target(allowed)


def test_redirect_hop_to_metadata_is_blocked(fake_dns):
    """The initial request is authorized; the 302 target is not. httpx fires the
    request hook per hop, so the guard has to catch it."""

    class Redirecting(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            self.send_response(302)
            self.send_header("Location", "http://metadata.test/latest/meta-data/")
            self.end_headers()

        def log_message(self, *_args):
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Redirecting)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    port = server.server_address[1]
    try:
        fake_dns({"127.0.0.1": "127.0.0.1", "metadata.test": "169.254.169.254"})
        target = SimpleNamespace(
            base_url=f"http://127.0.0.1:{port}/",
            authorization_ref="AUTH-1",
            in_scope_assets=[f"http://127.0.0.1:{port}"],
        )

        async def follow():
            async with httpx.AsyncClient(
                follow_redirects=True,
                timeout=5.0,
                event_hooks={"request": [hostguard.request_guard(target)]},
            ) as client:
                return await client.get(target.base_url)

        with pytest.raises(hostguard.HostBlocked):
            asyncio.run(follow())
    finally:
        server.shutdown()


def test_redirect_to_an_authorized_host_still_works(fake_dns):
    """Guard against over-blocking: an in-scope redirect must go through."""

    class Redirecting(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            if self.path == "/start":
                self.send_response(302)
                self.send_header("Location", "/end")
                self.end_headers()
            else:
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"ok")

        def log_message(self, *_args):
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Redirecting)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_address[1]
    try:
        fake_dns({"127.0.0.1": "127.0.0.1"})
        target = SimpleNamespace(
            base_url=f"http://127.0.0.1:{port}/start",
            authorization_ref="AUTH-1",
            in_scope_assets=[f"http://127.0.0.1:{port}"],
        )

        async def follow():
            async with httpx.AsyncClient(
                follow_redirects=True,
                timeout=5.0,
                event_hooks={"request": [hostguard.request_guard(target)]},
            ) as client:
                return await client.get(target.base_url)

        response = asyncio.run(follow())
        assert response.status_code == 200
        assert len(response.history) == 1
    finally:
        server.shutdown()
