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
import subprocess
import threading
import time
import xml.etree.ElementTree as ET
from urllib.parse import urlsplit

from app.scanner import hostguard
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


def build_nmap_argv(binary: str, base_url: str, *, is_full: bool) -> list[str]:
    """Assemble the nmap argv, avoiding the fatal `--top-ports` + `-p` clash.

    Nmap exits with code 1 ("Only one of --top-ports or -p can be specified")
    whenever both flags appear together. Targets with an explicit port in
    `base_url` (e.g. `http://localhost:3000` for OWASP Juice Shop) supply `-p`,
    so `--top-ports <N>` is stripped from the profile in that case.
    """
    profile = list(PROFILES["full_intrusive" if is_full else "passive_safe"])
    target_args = build_nmap_target_args(base_url)
    if "-p" in target_args and "--top-ports" in profile:
        idx = profile.index("--top-ports")
        del profile[idx : idx + 2]
    return [binary, *profile, "-oX", "-", *target_args]


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
                cpes = [c.text.strip() for c in service.findall("cpe") if c.text and c.text.strip()] if service is not None else []
                port_entry: dict = {
                    "port": int(port.get("portid", "0")),
                    "protocol": port.get("protocol", "tcp"),
                    "service": (service.get("name") if service is not None else "") or "",
                    "product": (service.get("product") if service is not None else "") or "",
                    "version": (service.get("version") if service is not None else "") or "",
                }
                extrainfo = (service.get("extrainfo") if service is not None else "") or ""
                if extrainfo:
                    port_entry["extrainfo"] = extrainfo
                if cpes:
                    port_entry["cpe"] = cpes
                ports_out.append(port_entry)
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


async def _run_nmap_popen_fallback(argv: list[str], ctx: ScanContext) -> tuple[int, bytes, bytes]:
    """Fallback using subprocess.Popen + daemon pipe-draining threads when the
    active asyncio loop does not support subprocess transports (e.g. Windows
    SelectorEventLoop under `uvicorn --reload`). All ctx.progress/ctx.cancelled
    calls remain on the event-loop thread so SQLAlchemy sessions and asyncio
    queues are never touched from worker threads."""
    proc = subprocess.Popen(
        argv,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    stdout_chunks: list[bytes] = []
    stderr_chunks: list[bytes] = []
    stdout_bytes_read = 0

    def _drain(stream, bucket: list[bytes], track: bool) -> None:
        nonlocal stdout_bytes_read
        if stream is None:
            return
        try:
            while True:
                chunk = stream.read(65536)
                if not chunk:
                    break
                bucket.append(chunk)
                if track:
                    stdout_bytes_read += len(chunk)
        finally:
            stream.close()

    t_out = threading.Thread(target=_drain, args=(proc.stdout, stdout_chunks, True), daemon=True)
    t_err = threading.Thread(target=_drain, args=(proc.stderr, stderr_chunks, False), daemon=True)
    t_out.start()
    t_err.start()

    deadline = time.monotonic() + NMAP_TIME_CAP_SECONDS
    last_reported = 0
    try:
        while proc.poll() is None:
            if ctx.cancelled():
                proc.kill()
                await asyncio.to_thread(proc.wait)
                raise RunnerError("Cancelled")
            if time.monotonic() >= deadline:
                proc.kill()
                await asyncio.to_thread(proc.wait)
                raise RunnerError(
                    f"nmap exceeded the {int(NMAP_TIME_CAP_SECONDS)}s time cap and was terminated"
                )
            if stdout_bytes_read != last_reported:
                last_reported = stdout_bytes_read
                ctx.progress(min(0.9, 0.1 + stdout_bytes_read / 200_000))
            await asyncio.sleep(0.25)
    finally:
        await asyncio.to_thread(t_out.join, 5)
        await asyncio.to_thread(t_err.join, 5)

    return proc.returncode or 0, b"".join(stdout_chunks), b"".join(stderr_chunks)


@register("nmap")
class NmapRunner(BaseRunner):
    async def run(self, ctx: ScanContext) -> None:
        binary = shutil.which("nmap")
        if binary is None:
            raise RunnerError(
                "nmap executable not found on PATH. Install Nmap (see PLAN.md section 11) "
                "or run the assessment without the nmap tool."
            )

        hostguard.check_target(ctx.target)

        argv = build_nmap_argv(binary, str(ctx.target.base_url), is_full=ctx.is_full)
        ctx.job.command = " ".join(argv)
        ctx.log(f"$ {ctx.job.command}")
        ctx.progress(0.1)

        try:
            process = await asyncio.create_subprocess_exec(
                *argv,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        except NotImplementedError:
            # Windows SelectorEventLoop (used by `uvicorn --reload`) does not
            # implement asyncio subprocess transports. Fall back to subprocess.Popen
            # with pipe-draining threads while keeping DB/SSE updates on the loop.
            returncode, stdout_bytes, stderr = await _run_nmap_popen_fallback(argv, ctx)
            ctx.progress(0.95)
        else:
            async def consume_stdout() -> bytes:
                chunks: list[bytes] = []
                assert process.stdout is not None
                while True:
                    if ctx.cancelled():
                        process.kill()
                        await process.wait()
                        raise RunnerError("Cancelled")
                    try:
                        chunk = await asyncio.wait_for(process.stdout.read(65536), timeout=0.5)
                    except asyncio.TimeoutError:
                        continue
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
            returncode = process.returncode or 0
            ctx.progress(0.95)

        stdout = stdout_bytes.decode(errors="replace")
        stderr_text = stderr.decode(errors="replace")
        if returncode != 0:
            raise RunnerError(f"nmap exited with code {returncode}: {stderr_text.strip()[:400]}")

        # `stdout` is already a str (decoded above). Calling .decode() again
        # raised AttributeError here, so every successful nmap run was reported
        # as "failed unexpectedly" and its XML was never parsed.
        parsed = parse_nmap_xml(stdout)
        ctx.job.raw_output = json.dumps(parsed)
        total_ports = sum(len(h["open_ports"]) for h in parsed["hosts"])
        ctx.log(f"nmap finished: {len(parsed['hosts'])} host(s), {total_ports} open port(s). {parsed['summary']}")
        ctx.progress(1.0)
        ctx.db.commit()
