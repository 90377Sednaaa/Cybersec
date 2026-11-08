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
