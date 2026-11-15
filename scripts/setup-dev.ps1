<#
.SYNOPSIS
    M5 T5.1 - prepare a clean Windows machine to run Aletheia end to end.

.DESCRIPTION
    Verifies and, where possible, installs everything in docs/PLAN.md section 11:
      - Python 3.13 virtualenv + backend dependencies (+ dev dependencies)
      - npm dependencies and a production frontend build
      - Playwright Chromium for PDF report rendering
      - Nmap on PATH (winget id Insecure.Nmap)
      - OWASP ZAP and its daemon, with an API key written to backend/.env
      - optional local OWASP Juice Shop clone (the authorized demo target)

    The script is idempotent and reports a PASS / ACTION REQUIRED line for every
    checklist item. It never edits docs/PLAN.md: that file is a frozen decision
    record, so the section 11 checklist is printed at the end instead of being
    ticked in place. backend/.env is gitignored and must never be committed.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\setup-dev.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\setup-dev.ps1 -SkipTools -SkipTests

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\setup-dev.ps1 -InstallJuiceShop -StartZap

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\setup-dev.ps1 -RepoRoot D:\Cybersec
#>

#requires -Version 5.1

[CmdletBinding()]
param(
    # Repository root to set up. Defaults to this script's parent directory, so a
    # linked worktree can also prepare the main checkout where the runtime DB lives.
    [string]$RepoRoot = "",
    # Skip the external tool installs (Nmap, ZAP). Useful on a restricted machine.
    [switch]$SkipTools,
    # Skip the pytest run.
    [switch]$SkipTests,
    # Skip the production frontend build (npm install still runs).
    [switch]$SkipFrontendBuild,
    # Clone and npm-install OWASP Juice Shop into a sibling directory.
    [switch]$InstallJuiceShop,
    # Launch the ZAP daemon after installing/configuring it.
    [switch]$StartZap,
    # Existing ZAP API key. If omitted, a random one is generated and written to backend/.env.
    [string]$ZapApiKey = "",
    # Explicit path to zap.bat. If omitted, the usual install locations are probed.
    [string]$ZapPath = "",
    # Where to clone Juice Shop. Defaults to a sibling folder of the repository.
    [string]$JuiceShopDir = "",
    [string]$NmapWingetId = "Insecure.Nmap",
    [string]$ZapWingetId = "ZAP.ZAP",
    [string]$ZapPort = "8080"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $script:RepoRoot = Split-Path -Parent $PSScriptRoot
} else {
    $script:RepoRoot = (Resolve-Path -Path $RepoRoot).Path
}
$script:Backend = Join-Path $script:RepoRoot "backend"
$script:Frontend = Join-Path $script:RepoRoot "frontend"
$script:VenvPython = Join-Path $script:Backend ".venv\Scripts\python.exe"
$script:EnvFile = Join-Path $script:Backend ".env"
$script:EnvExample = Join-Path $script:Backend ".env.example"
$script:Checks = @()

function Write-Step { param([string]$Text) Write-Host ""; Write-Host "==> $Text" -ForegroundColor Cyan }
function Write-Pass { param([string]$Text) Write-Host "  [OK]   $Text" -ForegroundColor Green }
function Write-Todo { param([string]$Text) Write-Host "  [TODO] $Text" -ForegroundColor Yellow }
function Test-Cmd { param([string]$Name) return ($null -ne (Get-Command $Name -ErrorAction SilentlyContinue)) }

function Add-Check {
    param([string]$Item, [string]$Status, [string]$Detail)
    $script:Checks += [pscustomobject]@{ Item = $Item; Status = $Status; Detail = $Detail }
}

function Invoke-Section {
    param([string]$Label, [scriptblock]$Body)
    Write-Step $Label
    try {
        & $Body
    } catch {
        Write-Host "  [FAIL] $($_.Exception.Message)" -ForegroundColor Red
        Add-Check $Label "FAIL" $_.Exception.Message
    }
}

function Update-MachinePath {
    # winget installs update the registry PATH, not the current process PATH.
    $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $user = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machine;$user"
}

function New-LocalKey {
    param([int]$Length = 32)
    $alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    return (-join (1..$Length | ForEach-Object { $alphabet[(Get-Random -Maximum $alphabet.Length)] }))
}

function New-StrongSecret {
    # SECRET_KEY signs JWTs and derives the Fernet key that encrypts LLM provider
    # keys. .env.example ships a literal placeholder, so a fresh .env must get a
    # cryptographically random value instead. Existing .env files are never
    # rewritten: changing SECRET_KEY would invalidate sessions and any stored key.
    param([int]$ByteLength = 48)
    $bytes = New-Object byte[] $ByteLength
    $rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
    try {
        $rng.GetBytes($bytes)
    } finally {
        $rng.Dispose()
    }
    return ([BitConverter]::ToString($bytes).Replace("-", "").ToLowerInvariant())
}

function Find-ZapBat {
    param([string]$Explicit)
    if (-not [string]::IsNullOrWhiteSpace($Explicit)) {
        if (Test-Path $Explicit) { return $Explicit }
        return ""
    }
    $candidates = @(
        "C:\Program Files\ZAP\Zed Attack Proxy\zap.bat",
        "C:\Program Files\OWASP\Zed Attack Proxy\zap.bat",
        "C:\Program Files (x86)\OWASP\Zed Attack Proxy\zap.bat"
    )
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) { return $candidate }
    }
    return ""
}

function Start-ZapDaemon {
    param([string]$Path, [string]$Key, [string]$Port)
    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path $Path)) {
        Write-Todo "zap.bat not found; start ZAP manually once it is installed."
        return
    }
    $zapArgs = @("-cmd", "-daemon", "-host", "127.0.0.1", "-port", $Port, "-config", "api.key=$Key")
    Start-Process -FilePath $Path -ArgumentList $zapArgs | Out-Null
    Write-Pass "ZAP daemon launch requested on 127.0.0.1:$Port (allow 30-60 s to become ready)."
}

# ---------------------------------------------------------------------------
# 0. Pre-flight
# ---------------------------------------------------------------------------
Write-Host "Aletheia M5 T5.1 environment setup" -ForegroundColor White
Write-Host "Repository: $script:RepoRoot" -ForegroundColor Gray

if (-not (Test-Path $script:Backend) -or -not (Test-Path $script:Frontend)) {
    throw "backend/ or frontend/ not found. Run this script from a full clone (not a sparse checkout)."
}

Invoke-Section "0. Toolchain pre-flight" {
    if (-not (Test-Cmd "python")) { throw "Python is not on PATH. Install Python 3.13 first." }
    $pyVersion = (& python --version 2>&1 | Out-String).Trim()
    Write-Pass "Python: $pyVersion"
    if ($pyVersion -notmatch "3\.13") { Write-Todo "PLAN.md targets Python 3.13; other versions are untested." }

    if (-not (Test-Cmd "node")) { throw "Node.js is not on PATH. Install Node 22+ first." }
    if (-not (Test-Cmd "npm")) { throw "npm is not on PATH." }
    Write-Pass "Node: $((& node --version 2>&1 | Out-String).Trim()) / npm: $((& npm --version 2>&1 | Out-String).Trim())"

    if (Test-Cmd "winget") {
        Write-Pass "winget is available for optional tool installs."
    } else {
        Write-Todo "winget unavailable; Nmap and ZAP will need manual installers."
    }
}

# ---------------------------------------------------------------------------
# 1. Python virtualenv + dependencies
# ---------------------------------------------------------------------------
Invoke-Section "1. Python venv and backend dependencies" {
    if (-not (Test-Path $script:VenvPython)) {
        Write-Host "  Creating backend/.venv ..." -ForegroundColor Gray
        & python -m venv (Join-Path $script:Backend ".venv")
    }
    & $script:VenvPython -m pip install --disable-pip-version-check -r (Join-Path $script:Backend "requirements.txt") -r (Join-Path $script:Backend "requirements-dev.txt")
    if ($LASTEXITCODE -ne 0) { throw "pip install failed (exit $LASTEXITCODE)." }
    Write-Pass "requirements.txt + requirements-dev.txt installed."
    Add-Check "Python 3.13 venv + backend deps" "PASS" "backend/.venv"
}

# ---------------------------------------------------------------------------
# 2. Backend tests
# ---------------------------------------------------------------------------
if (-not $SkipTests) {
    Invoke-Section "2. Backend test suite" {
        Push-Location $script:Backend
        try {
            & $script:VenvPython -m pytest tests -q
            if ($LASTEXITCODE -ne 0) { throw "pytest failed (exit $LASTEXITCODE)." }
            Write-Pass "pytest passed."
        } finally {
            Pop-Location
        }
    }
}

# ---------------------------------------------------------------------------
# 3. Frontend
# ---------------------------------------------------------------------------
Invoke-Section "3. Frontend dependencies and build" {
    Push-Location $script:Frontend
    try {
        & npm install
        if ($LASTEXITCODE -ne 0) { throw "npm install failed (exit $LASTEXITCODE)." }
        Write-Pass "npm install completed."
        if (-not $SkipFrontendBuild) {
            & npm run build
            if ($LASTEXITCODE -ne 0) { throw "npm run build failed (exit $LASTEXITCODE)." }
            Write-Pass "npm run build passed (0 errors)."
        }
    } finally {
        Pop-Location
    }
}

# ---------------------------------------------------------------------------
# 4. Playwright Chromium (PDF rendering)
# ---------------------------------------------------------------------------
Invoke-Section "4. Playwright Chromium for report PDFs" {
    & $script:VenvPython -m playwright install chromium
    if ($LASTEXITCODE -ne 0) { throw "playwright install chromium failed (exit $LASTEXITCODE)." }
    Write-Pass "Chromium installed; app/reporting.py can now render PDFs."
    Add-Check "Playwright + Chromium" "PASS" "python -m playwright install chromium"
}

# ---------------------------------------------------------------------------
# 5. Nmap
# ---------------------------------------------------------------------------
Invoke-Section "5. Nmap on PATH" {
    if (Test-Cmd "nmap") {
        Write-Pass "nmap: $((& nmap --version 2>&1 | Select-Object -First 1 | Out-String).Trim())"
        Add-Check "Nmap on PATH" "PASS" "nmap --version"
    } elseif (-not $SkipTools -and (Test-Cmd "winget")) {
        Write-Host "  Installing $NmapWingetId with winget ..." -ForegroundColor Gray
        & winget install --id $NmapWingetId -e --accept-source-agreements --accept-package-agreements
        Update-MachinePath
        if (Test-Cmd "nmap") {
            Write-Pass "Nmap installed and on PATH."
            Add-Check "Nmap on PATH" "PASS" "winget install $NmapWingetId"
        } else {
            Write-Todo "Winget finished but nmap is not on this session's PATH. Open a new terminal and re-run this script."
            Add-Check "Nmap on PATH" "ACTION REQUIRED" "restart terminal, then re-run"
        }
    } else {
        Write-Todo "Install Nmap from https://nmap.org/download.html (Windows installer adds nmap to PATH), then verify: nmap --version"
        Add-Check "Nmap on PATH" "ACTION REQUIRED" "manual install from nmap.org"
    }
}

# ---------------------------------------------------------------------------
# 6. ZAP + .env + daemon
# ---------------------------------------------------------------------------
if ([string]::IsNullOrWhiteSpace($ZapApiKey)) { $ZapApiKey = New-LocalKey }

Invoke-Section "6. OWASP ZAP daemon and API key" {
    $zapBat = Find-ZapBat -Explicit $ZapPath

    if ([string]::IsNullOrWhiteSpace($zapBat) -and -not $SkipTools -and (Test-Cmd "winget")) {
        Write-Host "  Installing $ZapWingetId with winget (requires Java 17+, bundled by the Windows package) ..." -ForegroundColor Gray
        & winget install --id $ZapWingetId -e --accept-source-agreements --accept-package-agreements
        Update-MachinePath
        $zapBat = Find-ZapBat -Explicit ""
    }

    $createdEnv = -not (Test-Path $script:EnvFile)
    if ($createdEnv) {
        Copy-Item -Path $script:EnvExample -Destination $script:EnvFile
        Write-Pass "Created backend/.env from .env.example (gitignored, never commit it)."
    }
    $strongSecret = New-StrongSecret

    # Write without a BOM: pydantic-settings reads the file as utf-8 and a BOM
    # would corrupt the first variable (SECRET_KEY). An existing .env keeps its
    # SECRET_KEY verbatim so stored provider keys and JWTs stay valid.
    $envLines = Get-Content -Path $script:EnvFile
    $envLines = $envLines | ForEach-Object {
        if ($_ -match "^SECRET_KEY=" -and $createdEnv) { "SECRET_KEY=$strongSecret" }
        elseif ($_ -match "^ZAP_API_KEY=") { "ZAP_API_KEY=$ZapApiKey" }
        elseif ($_ -match "^ZAP_API_URL=") { "ZAP_API_URL=http://127.0.0.1:$ZapPort" }
        else { $_ }
    }
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText(
        $script:EnvFile,
        (($envLines -join [Environment]::NewLine) + [Environment]::NewLine),
        $utf8NoBom
    )
    Write-Pass "ZAP_API_URL and ZAP_API_KEY written to backend/.env (key value not printed)."
    if ($createdEnv) { Write-Pass "Generated a random SECRET_KEY for the new .env (value not printed)." }

    if (-not [string]::IsNullOrWhiteSpace($zapBat)) {
        Write-Pass "zap.bat found: $zapBat"
        Add-Check "OWASP ZAP daemon + API key" "PASS" "zap.bat found; .env configured"
        if ($StartZap) { Start-ZapDaemon -Path $zapBat -Key $ZapApiKey -Port $ZapPort }
        else {
            Write-Host "  Start it manually in a second terminal:" -ForegroundColor Gray
            Write-Host "    & '$zapBat' -cmd -daemon -host 127.0.0.1 -port $ZapPort -config api.key=<key from backend/.env>" -ForegroundColor Gray
            Write-Todo "Or re-run this script with -StartZap. Only full_intrusive assessments need the daemon."
        }
    } else {
        Write-Todo "Install ZAP from https://www.zaproxy.org/download/ (or winget install --id=ZAP.ZAP -e), then re-run this script."
        Add-Check "OWASP ZAP daemon + API key" "ACTION REQUIRED" "manual install from zaproxy.org"
    }
}

# ---------------------------------------------------------------------------
# 7. Juice Shop (optional)
# ---------------------------------------------------------------------------
if ($InstallJuiceShop) {
    Invoke-Section "7. OWASP Juice Shop (authorized demo target)" {
        if ([string]::IsNullOrWhiteSpace($JuiceShopDir)) {
            $JuiceShopDir = Join-Path (Split-Path -Parent $script:RepoRoot) "juice-shop"
        }
        if (-not (Test-Path $JuiceShopDir)) {
            if (-not (Test-Cmd "git")) { throw "git is required to clone Juice Shop." }
            & git clone --depth 1 https://github.com/juice-shop/juice-shop.git $JuiceShopDir
            if ($LASTEXITCODE -ne 0) { throw "git clone failed (exit $LASTEXITCODE)." }
        }
        Push-Location $JuiceShopDir
        try {
            & npm install
            if ($LASTEXITCODE -ne 0) { throw "npm install failed in Juice Shop (exit $LASTEXITCODE)." }
        } finally {
            Pop-Location
        }
        Write-Pass "Juice Shop ready at $JuiceShopDir. Start it with: npm start (port 3000)."
        Add-Check "Juice Shop on :3000" "READY" $JuiceShopDir
    }
} else {
    Add-Check "Juice Shop on :3000" "ACTION REQUIRED" "re-run with -InstallJuiceShop, or clone it manually"
}

Add-Check "OpenRouter API key (+ optional Ollama)" "MANUAL" "paste a real key in Settings; never commit it"

# ---------------------------------------------------------------------------
# 8. PLAN.md section 11 checklist + next steps
# ---------------------------------------------------------------------------
Write-Step "docs/PLAN.md section 11 checklist"
foreach ($check in $script:Checks) {
    $colour = "Yellow"
    if ($check.Status -eq "PASS" -or $check.Status -eq "READY") { $colour = "Green" }
    if ($check.Status -eq "FAIL") { $colour = "Red" }
    Write-Host ("  [{0,-15}] {1,-36} {2}" -f $check.Status, $check.Item, $check.Detail) -ForegroundColor $colour
}

Write-Host ""
Write-Host "Next: start the four processes, then follow docs/qa-checklist.md for the demo run." -ForegroundColor Cyan
Write-Host "  1. cd backend; .venv\Scripts\python -m uvicorn app.main:app --port 8000" -ForegroundColor Gray
Write-Host "  2. cd frontend; npm run dev                 (http://localhost:5173)" -ForegroundColor Gray
Write-Host "  3. Juice Shop: npm start                    (http://localhost:3000)" -ForegroundColor Gray
Write-Host "  4. ZAP daemon (only for full_intrusive)     (http://127.0.0.1:$ZapPort)" -ForegroundColor Gray
Write-Host "  Login: admin@example.com / admin123 (development default; change it before any non-local use)." -ForegroundColor Gray
Write-Host "  Only registered, authorized targets may be scanned. Never commit backend/.env." -ForegroundColor Gray
