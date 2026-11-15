import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Eye,
  FileCheck2,
  FileDown,
  Info,
  Keyboard,
  Lock,
  Moon,
  Radio,
  Shield,
  ShieldAlert,
  Sparkles,
  Sun,
  Target,
  Terminal,
  UserCheck,
  Zap,
} from "lucide-react"

import logo from "@/assets/aletheia-logo.png"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { useTheme } from "@/lib/theme"
import { cn } from "cn"

interface TocItem {
  id: string
  title: string
  icon: typeof Shield
  badge?: string
}

const TOC_SECTIONS: TocItem[] = [
  { id: "overview", title: "1. Overview & Human in the Loop", icon: Shield, badge: "Core" },
  { id: "quickstart", title: "2. Quick Start (3-Min Run)", icon: Zap, badge: "Start here" },
  { id: "scoping", title: "3. Scope & Target Registry", icon: Target },
  { id: "assessments", title: "4. Scans & Real-Time SSE Stream", icon: Radio },
  { id: "verification", title: "5. Human Finding Verification", icon: UserCheck, badge: "Crucial" },
  { id: "reporting", title: "6. Reports & Inline Preview", icon: FileCheck2 },
  { id: "ai-pipeline", title: "7. AI Pipeline & Redaction", icon: Sparkles },
  { id: "keyboard-shortcuts", title: "8. Keyboard Shortcuts", icon: Keyboard },
  { id: "troubleshooting", title: "9. Troubleshooting & FAQ", icon: Info },
]

export function UserGuidePage() {
  const { theme, toggle } = useTheme()
  const [activeSection, setActiveSection] = useState<string>("overview")

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((entry) => entry.isIntersecting)
        if (visible) {
          setActiveSection(visible.target.id)
        }
      },
      {
        rootMargin: "-20% 0px -70% 0px",
        threshold: 0,
      }
    )

    TOC_SECTIONS.forEach(({ id }) => {
      const el = document.getElementById(id)
      if (el) observer.observe(el)
    })

    return () => observer.disconnect()
  }, [])

  return (
    <div className="min-h-screen bg-background text-foreground antialiased selection:bg-primary/20">
      {/* Sticky Top Header */}
      <header className="sticky top-0 z-40 flex h-14 w-full items-center justify-between border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60 sm:px-8">
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2.5 transition-opacity hover:opacity-85">
            <img src={logo} alt="Aletheia logo" className="size-7 object-contain" />
            <span className="font-semibold tracking-tight">Aletheia</span>
          </Link>
          <Separator orientation="vertical" className="!h-4" />
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">User Guide &amp; Operating Manual</span>
            <Badge variant="outline" className="hidden sm:inline-flex text-[11px] font-normal">
              v1.0 • Assessor Guide
            </Badge>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">
            {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/">
              <ArrowLeft className="size-4 mr-1.5" />
              <span>Back to App</span>
            </Link>
          </Button>
        </div>
      </header>

      {/* Main Content Layout */}
      <div className="mx-auto flex max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:px-8">
        {/* Left Sticky Table of Contents */}
        <aside className="hidden lg:block w-72 shrink-0">
          <div className="sticky top-20 flex flex-col gap-6">
            <div className="flex flex-col gap-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Table of Contents
              </p>
              <p className="text-xs text-muted-foreground/80">
                Jump directly to any phase of the assessment pipeline.
              </p>
            </div>

            <nav className="flex flex-col gap-1 pr-2">
              {TOC_SECTIONS.map((item) => {
                const Icon = item.icon
                const isActive = activeSection === item.id
                return (
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    className={cn(
                      "group relative flex items-center justify-between rounded-md px-3 py-2 text-xs font-medium transition-all duration-150",
                      isActive
                        ? "bg-primary/10 text-primary font-semibold before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-r before:bg-primary"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                    )}
                  >
                    <div className="flex items-center gap-2.5 truncate">
                      <Icon className={cn("size-3.5 shrink-0", isActive ? "text-primary" : "text-muted-foreground")} />
                      <span className="truncate">{item.title}</span>
                    </div>
                    {item.badge && (
                      <Badge
                        variant={isActive ? "default" : "secondary"}
                        className="ml-2 h-4 px-1.5 text-[10px] font-normal shrink-0"
                      >
                        {item.badge}
                      </Badge>
                    )}
                  </a>
                )
              })}
            </nav>

            <Separator />

            {/* Quick Helper Card */}
            <Card className="bg-muted/40 border-dashed shadow-none">
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
                  <ShieldAlert className="size-3.5 text-primary" />
                  Assessor Golden Rule
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-1 text-xs text-muted-foreground leading-relaxed">
                AI outputs are strictly advisory candidates. <strong>Never assume candidate findings are real vulnerabilities</strong> until confirmed with raw scan evidence.
              </CardContent>
            </Card>
          </div>
        </aside>

        {/* Right Scrollable Content */}
        <main className="flex-1 min-w-0 flex flex-col gap-16 pb-24">

          {/* Section 1: Overview */}
          <section id="overview" className="scroll-mt-20 flex flex-col gap-6">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Overview &amp; The Human-in-the-Loop Concept</h1>
              <p className="mt-2 text-base text-muted-foreground leading-relaxed">
                <strong>Aletheia</strong> is an AI-assisted security assessment and vulnerability analysis platform designed to combine battle-tested discovery tools (Nmap, OWASP ZAP, custom HTTP prober, DNS) with modern LLM-driven interpretation, while keeping the <strong>human security assessor in charge</strong> of verified findings.
              </p>
            </div>

            <Alert className="border-primary/20 bg-primary/5 text-foreground">
              <UserCheck className="size-4 text-primary" />
              <AlertTitle className="font-semibold text-primary">Core Ethical Principle: Assessor Verification</AlertTitle>
              <AlertDescription className="text-xs leading-relaxed text-muted-foreground">
                In security audits, hallucinations or unvalidated flags waste client time and compromise trust. In Aletheia, AI analysis generates candidate items tagged with <Badge variant="secondary" className="text-[10px] uppercase font-mono px-1 py-0">ai_candidate</Badge>. They never appear in confirmed vulnerability tallies or executive summaries until an authorized assessor explicitly approves them.
              </AlertDescription>
            </Alert>

            {/* Pipeline Stage Visualizer */}
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold text-foreground">The 6-Stage Security Pipeline</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {[
                  { stage: "1. Scope & Authorize", desc: "Define target URLs with audit sign-off ticket and intensity bounds." },
                  { stage: "2. Reconnaissance", desc: "DNS resolution, PTR records, MX checks, and nameserver enumeration." },
                  { stage: "3. Tool Scanning", desc: "Port scans (Nmap), HTTP header & TLS probes, and spider crawler (ZAP)." },
                  { stage: "4. AI Interpretation", desc: "Normalizer + LLM extracts evidence, CVE correlations, and structured candidates." },
                  { stage: "5. Human Verification", desc: "Assessor verifies findings, discards false positives, and attaches notes." },
                  { stage: "6. Executive Reporting", desc: "Generates HTML preview and client-ready Playwright PDF reports." },
                ].map((item, idx) => (
                  <Card key={idx} className="bg-card/50 hover:bg-card transition-colors">
                    <CardHeader className="p-4 pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-xs font-semibold text-foreground">{item.stage}</CardTitle>
                        <Badge variant="outline" className="text-[10px] font-mono">Stage 0{idx + 1}</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="p-4 pt-1 text-xs text-muted-foreground leading-relaxed">
                      {item.desc}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </section>

          <Separator />

          {/* Section 2: Quick Start */}
          <section id="quickstart" className="scroll-mt-20 flex flex-col gap-6">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Quick Start Walkthrough</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Follow this quick 3-step path to execute your first end-to-end assessment.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="p-4 pb-2">
                  <Badge className="w-fit mb-1 text-[10px]" variant="secondary">Step 1</Badge>
                  <CardTitle className="text-sm font-semibold">Sign in as Assessor</CardTitle>
                  <CardDescription className="text-xs">Bootstrap dev credentials</CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-1 text-xs text-muted-foreground flex flex-col gap-2">
                  <p>Navigate to <code className="bg-muted px-1.5 py-0.5 rounded font-mono">/login</code> and sign in with the seeded credentials:</p>
                  <div className="bg-muted/80 rounded p-2 font-mono text-[11px] flex flex-col gap-1">
                    <div>Email: <span className="text-foreground font-semibold">admin@example.com</span></div>
                    <div>Pass: <span className="text-foreground font-semibold">admin123</span></div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="p-4 pb-2">
                  <Badge className="w-fit mb-1 text-[10px]" variant="secondary">Step 2</Badge>
                  <CardTitle className="text-sm font-semibold">Register a Target</CardTitle>
                  <CardDescription className="text-xs">Add an authorized URL</CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-1 text-xs text-muted-foreground flex flex-col gap-2">
                  <p>Go to <strong>Targets &gt; Add Target</strong>. Set:</p>
                  <ul className="list-disc pl-4 space-y-1">
                    <li>URL: <code className="bg-muted px-1 py-0.5 rounded font-mono">http://127.0.0.1:8000</code></li>
                    <li>Auth Ref: <code className="bg-muted px-1 py-0.5 rounded font-mono">DEMO-TICKET-01</code></li>
                    <li>Intensity: <Badge variant="outline" className="text-[10px] py-0">passive_safe</Badge></li>
                  </ul>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="p-4 pb-2">
                  <Badge className="w-fit mb-1 text-[10px]" variant="secondary">Step 3</Badge>
                  <CardTitle className="text-sm font-semibold">Launch Assessment</CardTitle>
                  <CardDescription className="text-xs">Observe live SSE log</CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-1 text-xs text-muted-foreground flex flex-col gap-2">
                  <p>Go to <strong>Assessments &gt; New Assessment</strong>, choose your target, click <strong>Launch</strong>, and watch the real-time event log.</p>
                  <p>Once finished, review findings in the drawer and preview the generated report.</p>
                </CardContent>
              </Card>
            </div>
          </section>

          <Separator />

          {/* Section 3: Target Scoping */}
          <section id="scoping" className="scroll-mt-20 flex flex-col gap-6">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Scope &amp; Target Registry</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Aletheia enforces rigid scoping gates in the orchestrator before any packet is transmitted.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="flex flex-col gap-4">
                <h3 className="text-sm font-semibold">Target Fields &amp; Safety Rules</h3>
                <ul className="flex flex-col gap-2.5 text-xs text-muted-foreground leading-relaxed">
                  <li className="flex items-start gap-2">
                    <ChevronRight className="size-3.5 text-primary shrink-0 mt-0.5" />
                    <span><strong>Authorization Reference:</strong> Mandatory contract or approval code (e.g. <code className="font-mono text-foreground">SOW-2026-QA</code>). Unverified external scans are blocked.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <ChevronRight className="size-3.5 text-primary shrink-0 mt-0.5" />
                    <span><strong>Base URL:</strong> Must be a valid absolute URI starting with <code className="font-mono text-foreground">http://</code> or <code className="font-mono text-foreground">https://</code>.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <ChevronRight className="size-3.5 text-primary shrink-0 mt-0.5" />
                    <span><strong>SSRF Protection (HostGuard):</strong> Localhost and RFC1918 private IPs are blocked by default unless explicitly listed in <code className="font-mono text-foreground">in_scope_assets</code>.</span>
                  </li>
                </ul>

                <Alert variant="default" className="border-amber-500/30 bg-amber-500/5 text-foreground">
                  <AlertTriangle className="size-4 text-amber-500" />
                  <AlertTitle className="text-xs font-semibold text-amber-500">Intensity Gate Enforced Server-Side</AlertTitle>
                  <AlertDescription className="text-xs text-muted-foreground">
                    If an assessor selects <strong>full_intrusive</strong> for a target registered as <strong>passive_safe</strong>, the API rejects the request with HTTP 409 Conflict.
                  </AlertDescription>
                </Alert>
              </div>

              {/* Intensity Breakdown Card */}
              <Card>
                <CardHeader className="p-4 pb-3">
                  <CardTitle className="text-sm font-semibold">Intensity Profiles</CardTitle>
                  <CardDescription className="text-xs">Understand scan tool activation</CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-0 flex flex-col gap-3">
                  <div className="rounded-md border p-3 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-foreground">passive_safe</span>
                      <Badge variant="outline" className="text-[10px] text-emerald-500 border-emerald-500/30">Safe in production</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      DNS recon, basic Nmap service scan, and custom HTTP headers/TLS/cookie checks. No active fuzzing, no spidering.
                    </p>
                  </div>

                  <div className="rounded-md border p-3 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-foreground">full_intrusive</span>
                      <Badge variant="outline" className="text-[10px] text-rose-500 border-rose-500/30">Admin Only</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Includes OWASP ZAP active crawler, parameter injection fuzzing, and directory brute force. Run only against staging environments.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </section>

          <Separator />

          {/* Section 4: Running Assessments */}
          <section id="assessments" className="scroll-mt-20 flex flex-col gap-6">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Scans &amp; Real-Time SSE Stream</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Aletheia executes assessments using an in-process asynchronous runner and streams real-time updates over Server-Sent Events (SSE).
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
              <div className="flex flex-col gap-4 text-xs text-muted-foreground leading-relaxed">
                <p>
                  When an assessment is launched, the orchestrator queues parallel jobs for each scheduled security tool:
                </p>
                <div className="flex flex-col gap-2">
                  <div className="flex items-start gap-2">
                    <Terminal className="size-4 text-primary shrink-0 mt-0.5" />
                    <div><strong>Live Stream Terminal:</strong> Streams timestamped logs directly into the UI over a fetch-based SSE channel without polling.</div>
                  </div>
                  <div className="flex items-start gap-2">
                    <Activity className="size-4 text-primary shrink-0 mt-0.5" />
                    <div><strong>Shared-Axis Job Timeline:</strong> Visualizes the start, progress, and duration of DNS, Nmap, Prober, and ZAP in real time.</div>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="size-4 text-primary shrink-0 mt-0.5" />
                    <div><strong>Graceful Degradation:</strong> If an optional tool like ZAP is offline, its individual job fails cleanly while the rest of the scan finishes.</div>
                  </div>
                </div>

                <Alert className="border-border">
                  <Info className="size-4" />
                  <AlertTitle className="text-xs font-semibold">Safe Cancellation</AlertTitle>
                  <AlertDescription className="text-xs text-muted-foreground">
                    Clicking <strong>Cancel</strong> immediately aborts in-flight tool subprocesses and gracefully records the assessment as cancelled.
                  </AlertDescription>
                </Alert>
              </div>

              {/* Mock Terminal Card */}
              <Card className="bg-zinc-950 text-zinc-100 border-zinc-800 font-mono text-xs">
                <CardHeader className="p-3 border-b border-zinc-800 flex flex-row items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-full bg-red-500/80 inline-block" />
                    <span className="size-2.5 rounded-full bg-yellow-500/80 inline-block" />
                    <span className="size-2.5 rounded-full bg-green-500/80 inline-block" />
                    <span className="text-[11px] text-zinc-400 ml-2 font-sans font-medium">Live Scan Event Log</span>
                  </div>
                  <Badge variant="outline" className="text-[10px] text-emerald-400 border-emerald-500/30">SSE Connected</Badge>
                </CardHeader>
                <CardContent className="p-4 flex flex-col gap-1.5 text-[11px] leading-relaxed text-zinc-300">
                  <div className="text-zinc-500">2026-11-15 14:02:10 [orchestrator] target=http://127.0.0.1:8000 intensity=passive_safe</div>
                  <div><span className="text-sky-400">job:started</span> tool=dns status=running</div>
                  <div><span className="text-sky-400">job:started</span> tool=prober status=running</div>
                  <div><span className="text-emerald-400">dns:completed</span> resolved 127.0.0.1 (0.04s)</div>
                  <div><span className="text-amber-400">candidate:created</span> &quot;Missing Content-Security-Policy&quot; (medium)</div>
                  <div><span className="text-amber-400">candidate:created</span> &quot;Missing Strict-Transport-Security&quot; (medium)</div>
                  <div><span className="text-emerald-400">prober:completed</span> 14 headers inspected (0.28s)</div>
                  <div className="text-emerald-400 font-semibold">[orchestrator] assessment completed: 7 candidates recorded</div>
                </CardContent>
              </Card>
            </div>
          </section>

          <Separator />

          {/* Section 5: Human Verification */}
          <section id="verification" className="scroll-mt-20 flex flex-col gap-6">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Human Finding Verification</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Findings start as unconfirmed AI candidates and require explicit verification by an assessor.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card className="border-border">
                <CardHeader className="p-4 pb-2">
                  <Badge variant="secondary" className="w-fit text-[10px]">Initial State</Badge>
                  <CardTitle className="text-xs font-semibold mt-1">ai_candidate</CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-1 text-xs text-muted-foreground">
                  Generated automatically by scanners and LLM analysis. Does not count in confirmed tallies.
                </CardContent>
              </Card>

              <Card className="border-emerald-500/30 bg-emerald-500/5">
                <CardHeader className="p-4 pb-2">
                  <Badge className="w-fit text-[10px] bg-emerald-600 text-white">Confirmed</Badge>
                  <CardTitle className="text-xs font-semibold mt-1 text-emerald-600 dark:text-emerald-400">verified</CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-1 text-xs text-muted-foreground">
                  Assessor verified the technical evidence. Included in the final report&apos;s executive summary.
                </CardContent>
              </Card>

              <Card className="border-rose-500/30 bg-rose-500/5">
                <CardHeader className="p-4 pb-2">
                  <Badge variant="outline" className="w-fit text-[10px] text-rose-500 border-rose-500/30">Discarded</Badge>
                  <CardTitle className="text-xs font-semibold mt-1 text-rose-600 dark:text-rose-400">false_positive</CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-1 text-xs text-muted-foreground">
                  Assessor identified the finding as noise or inaccurate. Excluded from executive totals.
                </CardContent>
              </Card>

              <Card className="border-amber-500/30 bg-amber-500/5">
                <CardHeader className="p-4 pb-2">
                  <Badge variant="outline" className="w-fit text-[10px] text-amber-500 border-amber-500/30">Pending Proof</Badge>
                  <CardTitle className="text-xs font-semibold mt-1 text-amber-600 dark:text-amber-400">needs_evidence</CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-1 text-xs text-muted-foreground">
                  Finding is plausible but requires deeper active probing or assessor proof before confirmation.
                </CardContent>
              </Card>
            </div>

            {/* How to verify in the drawer */}
            <div className="rounded-lg border bg-card p-5 flex flex-col gap-3">
              <h3 className="text-sm font-semibold">How to Review &amp; Verify in the Findings Drawer</h3>
              <ol className="list-decimal pl-5 space-y-2 text-xs text-muted-foreground leading-relaxed">
                <li>Navigate to <strong>Findings</strong> and filter by Assessment or Severity.</li>
                <li>Click any finding row to open the <strong>Detail Drawer</strong>.</li>
                <li>Inspect the raw <strong>HTTP Transcript</strong>, OWASP category mapping, and reproduction steps.</li>
                <li>Optionally upload supporting evidence (pcap, screenshot, HTTP request log) up to 5 MB.</li>
                <li>Choose an action: <strong>Verify Finding</strong>, <strong>Mark False Positive</strong>, or <strong>Needs Evidence</strong>, and provide mandatory assessor notes.</li>
                <li><em>Concurrency Safeguard:</em> Finding updates use compare-and-swap (CAS) to prevent overlapping assessor decisions from causing lost updates (HTTP 409).</li>
              </ol>
            </div>
          </section>

          <Separator />

          {/* Section 6: Reporting */}
          <section id="reporting" className="scroll-mt-20 flex flex-col gap-6">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Reports &amp; Live HTML Preview</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Aletheia provides both an instant in-app HTML preview and official Playwright-rendered PDF reports.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader className="p-4 pb-2">
                  <div className="flex items-center gap-2">
                    <Eye className="size-4 text-primary" />
                    <CardTitle className="text-sm font-semibold">Instant In-App Preview</CardTitle>
                  </div>
                  <CardDescription className="text-xs">No downloads or file viewers required</CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-1 text-xs text-muted-foreground flex flex-col gap-2 leading-relaxed">
                  <p>
                    Clicking <strong>Preview Report</strong> opens a sandboxed iframe displaying the self-contained Jinja2 HTML report directly within Aletheia.
                  </p>
                  <p>
                    It displays the latest verified findings, risk matrices, and executive summaries instantly, making review frictionless before printing.
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="p-4 pb-2">
                  <div className="flex items-center gap-2">
                    <FileDown className="size-4 text-primary" />
                    <CardTitle className="text-sm font-semibold">Playwright Chromium PDF Export</CardTitle>
                  </div>
                  <CardDescription className="text-xs">Official formal security report</CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-1 text-xs text-muted-foreground flex flex-col gap-2 leading-relaxed">
                  <p>
                    Clicking <strong>Generate PDF</strong> queues an async render job powered by Playwright headless Chromium.
                  </p>
                  <p>
                    The resulting PDF is authenticated, cleanly formatted with page numbers, executive summaries, and vulnerability remediation tables.
                  </p>
                </CardContent>
              </Card>
            </div>
          </section>

          <Separator />

          {/* Section 7: AI Pipeline & Redaction */}
          <section id="ai-pipeline" className="scroll-mt-20 flex flex-col gap-6">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">AI Pipeline &amp; Secret Redaction</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                How LLM providers integrate safely with zero credential leakage.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
              <div className="flex flex-col gap-3 text-xs text-muted-foreground leading-relaxed">
                <p>
                  Aletheia integrates with OpenAI-compatible providers (OpenRouter, local Ollama, OpenAI) to perform two distinct tasks:
                </p>
                <ul className="list-disc pl-4 space-y-1">
                  <li><strong>Interpretation:</strong> Translates raw scan outputs and HTTP responses into structured findings matching our strict Pydantic JSON schema.</li>
                  <li><strong>Summary:</strong> Synthesizes verified findings into executive-level risk narratives and remediation guidance.</li>
                </ul>
                <p>
                  If no provider is configured, the platform fails soft: rule-based findings are still generated and the report renders with an &quot;AI summary pending&quot; placeholder.
                </p>
              </div>

              <Card className="border-border">
                <CardHeader className="p-4 pb-2">
                  <div className="flex items-center gap-2">
                    <Lock className="size-4 text-emerald-500" />
                    <CardTitle className="text-xs font-semibold">Data Privacy &amp; Secret Protection</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="p-4 pt-1 flex flex-col gap-2 text-xs text-muted-foreground">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0 mt-0.5" />
                    <span><strong>Fernet Encryption:</strong> Provider API keys are encrypted at rest using your instance <code className="font-mono text-foreground">SECRET_KEY</code>.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0 mt-0.5" />
                    <span><strong>Pre-Call Redaction:</strong> Bearer tokens, passwords, session cookies, and private keys are scrubbed before payload transmission.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0 mt-0.5" />
                    <span><strong>Audit Trail:</strong> Every outbound LLM interaction writes an immutable audit record in <code className="font-mono text-foreground">ai_outputs</code>.</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </section>

          <Separator />

          {/* Section 8: Keyboard Shortcuts */}
          <section id="keyboard-shortcuts" className="scroll-mt-20 flex flex-col gap-6">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Keyboard Shortcuts</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Power-user navigation chords for rapid assessor movement.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {[
                { chord: "g then d", desc: "Jump to Dashboard" },
                { chord: "g then t", desc: "Jump to Targets" },
                { chord: "g then a", desc: "Jump to Assessments" },
                { chord: "g then f", desc: "Jump to Findings" },
                { chord: "g then s", desc: "Jump to Settings" },
                { chord: "?", desc: "Open Shortcuts Reference" },
              ].map((item, idx) => (
                <div key={idx} className="flex items-center justify-between rounded-lg border p-3 bg-card/40">
                  <span className="text-xs text-muted-foreground">{item.desc}</span>
                  <kbd className="rounded border bg-muted px-2 py-0.5 font-mono text-[11px] font-semibold text-foreground">
                    {item.chord}
                  </kbd>
                </div>
              ))}
            </div>
          </section>

          <Separator />

          {/* Section 9: Troubleshooting */}
          <section id="troubleshooting" className="scroll-mt-20 flex flex-col gap-6">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Troubleshooting &amp; FAQ</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Common questions and resolutions when running or presenting Aletheia.
              </p>
            </div>

            <div className="flex flex-col gap-3">
              {[
                {
                  q: "ZAP daemon is reported as offline during an assessment",
                  a: "ZAP is only scheduled for full_intrusive scans. For passive_safe scans, ZAP is ignored. If you are demoing intrusive scans, launch ZAP via: zap.bat -cmd -daemon -port 8080 -config api.key=<key> or pass -StartZap to setup-dev.ps1.",
                },
                {
                  q: "Report generation fails with 'BrowserType.launch: Executable doesn't exist'",
                  a: "Playwright Chromium is missing on the system. Run: backend\\.venv\\Scripts\\python -m playwright install chromium to download the headless browser.",
                },
                {
                  q: "Why do my AI findings say 'AI executive summary pending'?",
                  a: "No LLM provider key is registered, or the provider returned an error (e.g. rate limit). Go to Settings > Add Provider and add a valid OpenRouter or OpenAI API key. The scan still completes cleanly without it.",
                },
                {
                  q: "Nmap job logs 'nmap executable not found on PATH'",
                  a: "Install Nmap using winget install --id Insecure.Nmap -e, then restart your terminal before launching the backend server.",
                },
              ].map((item, idx) => (
                <Card key={idx}>
                  <CardHeader className="p-4 pb-2">
                    <CardTitle className="text-xs font-semibold text-foreground flex items-center gap-2">
                      <ChevronRight className="size-3.5 text-primary shrink-0" />
                      {item.q}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 pt-0 text-xs text-muted-foreground leading-relaxed">
                    {item.a}
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>

        </main>
      </div>
    </div>
  )
}
