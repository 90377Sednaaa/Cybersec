"""Nmap XML parsing (T1.2) - pure parse test, no nmap binary needed."""

import json
import pathlib
from datetime import UTC, datetime, timedelta

from app.scanner.nmap_runner import parse_nmap_xml
from app.scanner.prober import checks
from app.scanner.registry import get_runner, registered_tools

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "nmap_localhost.xml"


def test_parse_fixture_extracts_open_ports_and_services():
    parsed = parse_nmap_xml(FIXTURE.read_text(encoding="utf-8"))
    assert len(parsed["hosts"]) == 1
    host = parsed["hosts"][0]
    assert host["address"] == "127.0.0.1"
    assert host["hostname"] == "localhost"
    assert len(host["open_ports"]) == 1  # closed port filtered out
    port = host["open_ports"][0]
    assert port["port"] == 3000
    assert port["service"] == "http"
    assert port["product"] == "Express"
    assert "9.14 seconds" in parsed["summary"]


def test_registry_has_all_four_tools():
    tools = registered_tools()
    assert {"dns", "nmap", "prober", "zap"}.issubset(set(tools))
    assert get_runner("nmap").name == "nmap"


def test_nmap_target_args_extract_host_not_url():
    """Regression: nmap must receive a hostname (and optional -p), never a URL string."""
    import pytest as _pytest

    from app.scanner.base import RunnerError
    from app.scanner.nmap_runner import build_nmap_target_args

    assert build_nmap_target_args("http://localhost:3000") == ["-p", "3000", "localhost"]
    assert build_nmap_target_args("https://example.com/app") == ["example.com"]
    with _pytest.raises(RunnerError):
        build_nmap_target_args("not-a-url")


def test_out_of_scope_paths_are_never_probed():
    """Regression: the scope-safety filter must drop blocked paths (prefix-aware,
    tolerant of full-URL entries)."""
    from app.scanner.prober.checks import allowed_probe_paths, is_path_allowed

    out = ["http://example.com/admin/", "/server-status", "/logout"]
    assert is_path_allowed("/.env", out) is True
    assert is_path_allowed("/admin/", out) is False
    assert is_path_allowed("/admin/sub/thing", out) is False
    assert is_path_allowed("/server-status", out) is False
    assert is_path_allowed("/administrator/", out) is True  # different path, not a prefix match

    paths = [p for p, _s, _w in allowed_probe_paths(out)]
    assert "/admin/" not in paths
    assert "/server-status" not in paths
    assert "/.env" in paths


def test_prober_passive_checks_flag_missing_headers():
    """Pure check functions against a canned response-like object."""
    import httpx

    headers = httpx.Headers({"content-type": "text/html", "server": "nginx/1.24.0"})
    facts, findings = checks.check_security_headers(headers)
    titles = {f["title"] for f in findings}
    assert "Missing security header: content-security-policy" in titles
    assert facts["x-content-type-options"] is None

    _c, disc = checks.check_disclosure(headers, "")
    assert any("nginx" in f["title"] for f in disc)


def test_tls_expiry_check():
    # +1 hour margin so .days doesn't truncate to 9 during the same second
    soon = datetime.now(UTC) + timedelta(days=10, hours=1)
    findings = checks.check_tls({"not_after": soon, "self_signed": True})
    titles = " | ".join(f["title"] for f in findings)
    assert "expires in 10 day(s)" in titles
    assert "Self-signed TLS certificate" in titles


def test_tls_expiry_check_uses_production_shape():
    """Regression (F-06): get_tls_info stores an ISO *string* under not_after and
    keeps the datetime under not_after_dt (the prober strips that key before
    serializing raw_output). The old code only read not_after, so real scans
    never produced an expiry finding even though this pure test passed."""
    soon = datetime.now(UTC) + timedelta(days=10, hours=1)
    cert = {"not_after": soon.isoformat(), "not_after_dt": soon, "self_signed": False}
    titles = " | ".join(f["title"] for f in checks.check_tls(cert))
    assert "expires in 10 day(s)" in titles

    expired = datetime.now(UTC) - timedelta(days=3)
    cert = {"not_after": expired.isoformat(), "not_after_dt": expired, "self_signed": False}
    titles = " | ".join(f["title"] for f in checks.check_tls(cert))
    assert "expired" in titles


def test_nmap_run_parses_subprocess_xml():
    """Regression (F-01): a successful nmap run must parse its XML. The old code
    called .decode() on an already-decoded str and raised AttributeError, which
    the orchestrator swallowed as "failed unexpectedly". Mocked so no nmap
    binary is needed."""
    import asyncio
    import json
    from types import SimpleNamespace
    from unittest.mock import AsyncMock, MagicMock, patch

    from app.models import ScanIntensity
    from app.scanner.base import ScanContext
    from app.scanner.nmap_runner import NmapRunner

    class FakeStdout:
        def __init__(self, data: bytes) -> None:
            self.data, self.sent = data, False

        async def read(self, _n: int = -1) -> bytes:
            if self.sent:
                return b""
            self.sent = True
            return self.data

    class FakeStderr:
        async def read(self) -> bytes:
            return b""

    class FakeProcess:
        def __init__(self, data: bytes) -> None:
            self.stdout, self.stderr = FakeStdout(data), FakeStderr()
            self.returncode = 0

        async def wait(self) -> int:
            return 0

        def kill(self) -> None:
            pass

    job = SimpleNamespace(command="", raw_output=None)
    ctx = ScanContext(
        db=MagicMock(),
        target=SimpleNamespace(base_url="http://localhost:3000"),
        assessment=SimpleNamespace(intensity=ScanIntensity.passive_safe),
        job=job,
        emit_log=lambda _line: None,
        emit_progress=lambda _value: None,
        cancelled=lambda: False,
    )

    with (
        patch("app.scanner.nmap_runner.shutil.which", return_value="nmap"),
        patch(
            "app.scanner.nmap_runner.asyncio.create_subprocess_exec",
            new=AsyncMock(return_value=FakeProcess(FIXTURE.read_bytes())),
        ),
    ):
        asyncio.run(NmapRunner().run(ctx))

    parsed = json.loads(job.raw_output)
    assert len(parsed["hosts"]) == 1
    assert parsed["hosts"][0]["address"] == "127.0.0.1"
