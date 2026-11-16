"""Scan import parser (M1/M4).

Parses user-uploaded scan files (Nmap XML, OWASP ZAP JSON) into Aletheia's
standard `raw_output` format, ready for the normalizer and AI interpreter.
"""

from __future__ import annotations

import json
import xml.etree.ElementTree as ET
from typing import Any

from app.scanner.nmap_runner import parse_nmap_xml


def parse_imported_nmap(xml_text: str) -> dict[str, Any]:
    """Parse raw Nmap XML string into the standard `{hosts: [...], summary: ...}` dict."""
    if not xml_text or not xml_text.strip():
        raise ValueError("Nmap XML file is empty")
    try:
        data = parse_nmap_xml(xml_text)
    except ET.ParseError as exc:
        raise ValueError(f"Malformed Nmap XML: {exc}") from exc
    except Exception as exc:
        raise ValueError(f"Failed to parse Nmap XML: {exc}") from exc

    if not isinstance(data, dict) or "hosts" not in data:
        raise ValueError("Invalid Nmap XML structure - no hosts element found")
    return data


def parse_imported_zap(json_text: str) -> dict[str, Any]:
    """Parse raw OWASP ZAP JSON report string into `{mode: ..., alerts: [...]}` dict."""
    if not json_text or not json_text.strip():
        raise ValueError("ZAP JSON file is empty")
    try:
        raw = json.loads(json_text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Malformed ZAP JSON: {exc}") from exc

    raw_alerts: list[dict[str, Any]] = []

    if isinstance(raw, list):
        raw_alerts = [item for item in raw if isinstance(item, dict)]
    elif isinstance(raw, dict):
        if "alerts" in raw and isinstance(raw["alerts"], list):
            raw_alerts = raw["alerts"]
        elif "site" in raw and isinstance(raw["site"], list):
            for site in raw["site"]:
                if isinstance(site, dict) and "alerts" in site and isinstance(site["alerts"], list):
                    raw_alerts.extend(site["alerts"])
        elif "site" in raw and isinstance(raw["site"], dict):
            alerts = raw["site"].get("alerts", [])
            if isinstance(alerts, list):
                raw_alerts.extend(alerts)

    normalised: list[dict[str, Any]] = []
    for a in raw_alerts:
        if not isinstance(a, dict):
            continue
        title = a.get("name") or a.get("alert") or a.get("title") or ""
        if not title:
            continue

        risk_val = a.get("risk") or a.get("riskdesc") or "Low"
        # Extract first word, e.g. "Medium (High)" -> "medium"
        risk_clean = str(risk_val).split()[0].lower() if risk_val else "low"

        # Evidence / URI instances
        instances = a.get("instances")
        first_instance = instances[0] if (isinstance(instances, list) and instances and isinstance(instances[0], dict)) else {}

        url = a.get("url") or first_instance.get("uri") or ""
        evidence = str(a.get("evidence") or first_instance.get("evidence") or "")

        normalised.append(
            {
                "plugin_id": a.get("pluginId") or a.get("pluginid"),
                "title": title,
                "risk": risk_clean,
                "confidence": a.get("confidence") or a.get("confidenceDesc") or "Medium",
                "url": url,
                "description": (a.get("description") or a.get("desc") or "")[:1500],
                "solution": (a.get("solution") or "")[:1500],
                "evidence": evidence[:500],
                "cwe": a.get("cweid") or a.get("cwe"),
            }
        )

    return {"mode": "passive_safe", "alerts": normalised}


def parse_imported_scan(tool: str, content: str) -> dict[str, Any]:
    """Dispatch file content to the appropriate parser for the tool."""
    tool_normalized = (tool or "").strip().lower()
    if tool_normalized == "nmap":
        return parse_imported_nmap(content)
    if tool_normalized == "zap":
        return parse_imported_zap(content)
    raise ValueError(f"Unsupported tool '{tool}'. Aletheia supports 'nmap' and 'zap' scan imports.")
