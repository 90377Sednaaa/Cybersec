"""Nmap runner (M1 T1.2).

Runs nmap as a subprocess with XML output on stdout, parses the XML into a
hosts/ports/services structure, and stores it as the job's raw output.

Intensity profiles (deliberately conservative - no intrusive NSE scripts):
    passive_safe:  top 1000 ports, service version detection
    full_intrusive: top 5000 ports, faster timing, version + OS detection

When the nmap executable is missing the job fails with an actionable message
instead of crashing the pipeline.
"""

from __future__ import annotations

import asyncio
import json
import shutil
import xml.etree.ElementTree as ET

from app.scanner.base import BaseRunner, RunnerError, ScanContext
from app.scanner.registry import register

# Intensity -> extra argv
PROFILES = {
    "passive_safe": ["--top-ports", "1000", "-sV"],
    "full_intrusive": ["--top-ports", "5000", "-T4", "-sV", "-O"],
}


def parse_nmap_xml(xml_text: str) -> dict:
    """Parse `nmap -oX -` output into {hosts: [...], summary}.

    Kept pure so it can be unit-tested against a committed fixture without
    nmap installed.
    """
    root = ET.fromstring(xml_text)
    runstats = root.find("runstats")
    hosts_out: list[dict] = []
    for host in root.findall("host"):
        addr_el = host.find("address")
        hostname = ""
        hostnames = host.find("hostnames")
        if hostnames is not None and (hn := hostnames.find("hostname")) is not None:
            hostname = hn.get("name", "")
        ports_out = []
        ports = host.find("ports")
        if ports is not None:
            for port in ports.findall("port"):
                state_el = port.find("state")
                service = port.find("service")
                if state_el is None or state_el.get("state") != "open":
                    continue
                ports_out.append(
                    {
                        "port": int(port.get("portid", "0")),
                        "protocol": port.get("protocol", "tcp"),
                        "service": (service.get("name") if service is not None else "") or "",
                        "product": (service.get("product") if service is not None else "") or "",
                        "version": (service.get("version") if service is not None else "") or "",
                    }
                )
        if ports_out:
            hosts_out.append(
                {
                    "address": addr_el.get("addr", "") if addr_el is not None else "",
                    "hostname": hostname,
                    "open_ports": ports_out,
                }
            )
    summary = ""
    if runstats is not None:
        finished = runstats.find("finished")
        if finished is not None:
            summary = finished.get("summary", "")
    return {"hosts": hosts_out, "summary": summary}


@register("nmap")
class NmapRunner(BaseRunner):
    async def run(self, ctx: ScanContext) -> None:
        binary = shutil.which("nmap")
        if binary is None:
            raise RunnerError(
                "nmap executable not found on PATH. Install Nmap (see PLAN.md section 11) "
                "or run the assessment without the nmap tool."
            )

        profile = PROFILES["full_intrusive" if ctx.is_full else "passive_safe"]
        argv = [binary, *profile, "-oX", "-", str(ctx.target.base_url)]
        ctx.job.command = " ".join(argv)
        ctx.log(f"$ {ctx.job.command}")
        ctx.progress(0.1)

        process = await asyncio.create_subprocess_exec(
            *argv,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = b"", b""
        # Read in chunks so a long scan can stream progress instead of appearing hung.
        chunks: list[bytes] = []
        assert process.stdout is not None
        while True:
            if ctx.cancelled():
                process.kill()
                await process.wait()
                raise RunnerError("Cancelled")
            chunk = await process.stdout.read(65536)
            if not chunk:
                break
            chunks.append(chunk)
            done = sum(len(c) for c in chunks)
            ctx.progress(min(0.9, 0.1 + done / 200_000))
        stdout = b"".join(chunks)
        stderr = (await process.stderr.read()).decode(errors="replace")
        await process.wait()
        ctx.progress(0.95)

        if process.returncode != 0:
            raise RunnerError(f"nmap exited with code {process.returncode}: {stderr.strip()[:400]}")

        parsed = parse_nmap_xml(stdout.decode(errors="replace"))
        ctx.job.raw_output = json.dumps(parsed)
        total_ports = sum(len(h["open_ports"]) for h in parsed["hosts"])
        ctx.log(f"nmap finished: {len(parsed['hosts'])} host(s), {total_ports} open port(s). {parsed['summary']}")
        ctx.progress(1.0)
        ctx.db.commit()
