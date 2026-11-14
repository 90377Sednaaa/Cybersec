"""Nmap runner (M1 T1.2).

Runs nmap as a subprocess with XML output on stdout, parses the XML into a
hosts/ports/services structure, and stores it as the job's raw output.

Intensity profiles (deliberately conservative - no intrusive NSE scripts,
no -O OS detection which requires admin/Npcap privileges on Windows):
    passive_safe:  top 1000 ports, service version detection
    full_intrusive: top 5000 ports, faster timing, version detection

When the nmap executable is missing the job fails with an actionable message
instead of crashing the pipeline. A hard time cap prevents a hung scan from
hanging the job forever.
"""

from __future__ import annotations

import asyncio
import json
import shutil
import xml.etree.ElementTree as ET
from urllib.parse import urlsplit

from app.scanner.base import BaseRunner, RunnerError, ScanContext
from app.scanner.registry import register

# Intensity -> extra argv
PROFILES = {
    "passive_safe": ["--top-ports", "1000", "-sV"],
    "full_intrusive": ["--top-ports", "5000", "-T4", "-sV"],
}

NMAP_TIME_CAP_SECONDS = 900.0


def build_nmap_target_args(base_url: str) -> list[str]:
    """nmap wants a host (and optional -p), never a URL. Extract both from the
    registered base_url. Pure function for unit testing."""
    parts = urlsplit(base_url)
    host = parts.hostname
    if not host:
        raise RunnerError(f"Invalid base_url '{base_url}' - no hostname to scan")
    # A hostname can never legitimately start with "-", but urlsplit happily
    # returns one ("http://-6" -> "-6"). nmap's own option parser would then read
    # it as a flag (-6, -v, --open, ...) and escape the conservative profile.
    # Rejected outright rather than relying on a "--" terminator, whose support
    # in nmap is not documented.
    if host.startswith("-"):
        raise RunnerError(f"Invalid hostname '{host}' - it would be parsed as an nmap option")
    args: list[str] = []
    if parts.port:
        args += ["-p", str(parts.port)]
    args.append(host)
    return args


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
        argv = [binary, *profile, "-oX", "-", *build_nmap_target_args(str(ctx.target.base_url))]
        ctx.job.command = " ".join(argv)
        ctx.log(f"$ {ctx.job.command}")
        ctx.progress(0.1)

        process = await asyncio.create_subprocess_exec(
            *argv,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        async def consume_stdout() -> bytes:
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
            return b"".join(chunks)

        try:
            stdout_bytes, stderr = await asyncio.wait_for(
                asyncio.gather(consume_stdout(), process.stderr.read()), timeout=NMAP_TIME_CAP_SECONDS
            )
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()
            raise RunnerError(
                f"nmap exceeded the {int(NMAP_TIME_CAP_SECONDS)}s time cap and was terminated"
            ) from None
        await process.wait()
        ctx.progress(0.95)

        stdout = stdout_bytes.decode(errors="replace")
        stderr = stderr.decode(errors="replace")
        if process.returncode != 0:
            raise RunnerError(f"nmap exited with code {process.returncode}: {stderr.strip()[:400]}")

        # `stdout` is already a str (decoded above). Calling .decode() again
        # raised AttributeError here, so every successful nmap run was reported
        # as "failed unexpectedly" and its XML was never parsed.
        parsed = parse_nmap_xml(stdout)
        ctx.job.raw_output = json.dumps(parsed)
        total_ports = sum(len(h["open_ports"]) for h in parsed["hosts"])
        ctx.log(f"nmap finished: {len(parsed['hosts'])} host(s), {total_ports} open port(s). {parsed['summary']}")
        ctx.progress(1.0)
        ctx.db.commit()
