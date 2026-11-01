import { detectCdnCacheStatus } from "../inference/cache-analyzer.js";
import { getHostname } from "../utils/domain.js";
import {
  formatBytes,
  formatDelta,
  formatDeltaPct,
  formatMetricValue,
  formatMs,
} from "../utils/format.js";
import type { DeltaUnit } from "../utils/format.js";
import { phaseMs, tcpConnectMs } from "../utils/timing.js";
import { compareFlows } from "./compare.js";
import type { ComparedMetric } from "./compare.js";
import { collectFindings } from "./findings.js";
import { analyzeHops, protocolLabel } from "./hops.js";
import {
  rateMetric,
  summarizeFlowMetrics,
  TTFB_LABEL,
  SERVER_WAIT_LABEL,
} from "./metrics-summary.js";
import type { PageMetricsSummary } from "./metrics-summary.js";
import type { Finding, FindingEvidence, FindingSeverity, Flow, HarEntry } from "../types.js";

// Every export takes the flow to report and, for a comparison, the second flow (B).

interface Side {
  flow: Flow;
  side?: "a" | "b";
}

function sidesOf(flow: Flow, compare?: Flow): Side[] {
  return compare
    ? [
        { flow, side: "a" },
        { flow: compare, side: "b" },
      ]
    : [{ flow }];
}

// ── CSV: one row per request ─────────────────────────────────────────────────

const CSV_COLUMNS = [
  "page",
  "side",
  "url",
  "host",
  "type",
  "method",
  "status",
  "protocol",
  "encoding",
  "from_cache",
  "start_ms",
  "blocked_ms",
  "dns_ms",
  "connect_ms",
  "ssl_ms",
  "send_ms",
  "wait_ms",
  "receive_ms",
  "duration_ms",
  "transfer_bytes",
  "body_bytes",
  "priority",
] as const;

/** RFC 4180: a field with a comma, a quote or a line break is quoted, its quotes doubled. */
function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** At most one decimal, without a trailing ".0"; empty when the phase does not apply. */
function csvMs(ms: number | null): string {
  return ms === null || Number.isNaN(ms) ? "" : String(Number(ms.toFixed(1)));
}

function csvRow(page: string, side: string | undefined, e: HarEntry): string {
  const t = e.timing;
  const connect = phaseMs(t, "connect");
  return [
    csvField(page),
    side ?? "",
    csvField(e.url),
    csvField(getHostname(e.url)),
    csvField(e.resourceType),
    csvField(e.method),
    e.status,
    csvField(e.httpVersion),
    csvField(e.contentEncoding),
    e.fromCache === false ? "false" : e.fromCache,
    csvMs(e.startTime),
    csvMs(phaseMs(t, "blocked")),
    csvMs(phaseMs(t, "dns")),
    // TCP alone: HAR counts the TLS handshake inside connect, ssl_ms has it.
    csvMs(connect === null ? null : tcpConnectMs(t)),
    csvMs(phaseMs(t, "ssl")),
    csvMs(t.send),
    csvMs(t.wait),
    csvMs(t.receive),
    csvMs(e.duration),
    e.transferSize,
    e.bodySize,
    csvField(e.priority),
  ].join(",");
}

/**
 * Every request of every page as RFC 4180 CSV (header row, CRLF line endings): timings in
 * ms to one decimal, empty for a phase that did not apply. The `side` column is `a` or `b`
 * in a comparison and empty otherwise.
 */
export function requestsCsv(flow: Flow, compare?: Flow): string {
  const rows = sidesOf(flow, compare).flatMap(({ flow: f, side }) =>
    f.pages.flatMap((page) => page.har.entries.map((e) => csvRow(page.name, side, e)))
  );
  return [CSV_COLUMNS.join(","), ...rows].map((line) => `${line}\r\n`).join("");
}

// ── Markdown ─────────────────────────────────────────────────────────────────

interface MetricRow {
  key: ComparedMetric;
  label: string;
  unit: DeltaUnit;
  value: (m: PageMetricsSummary) => number | null | undefined;
}

const METRIC_ROWS: readonly MetricRow[] = [
  { key: "ttfb", label: TTFB_LABEL, unit: "ms", value: (m) => m.ttfb },
  { key: "serverWait", label: SERVER_WAIT_LABEL, unit: "ms", value: (m) => m.serverWait },
  { key: "fcp", label: "FCP", unit: "ms", value: (m) => m.fcp },
  { key: "lcp", label: "LCP", unit: "ms", value: (m) => m.lcp },
  { key: "cls", label: "CLS", unit: "score", value: (m) => m.cls },
  { key: "inp", label: "INP", unit: "ms", value: (m) => m.inp },
  { key: "dcl", label: "DCL", unit: "ms", value: (m) => m.dcl },
  { key: "onLoad", label: "onLoad", unit: "ms", value: (m) => m.onLoad },
  { key: "requests", label: "Requests", unit: "count", value: (m) => m.requests },
  { key: "cacheHits", label: "Browser cache hits", unit: "count", value: (m) => m.cacheHits },
  { key: "bytes", label: "Transfer", unit: "bytes", value: (m) => m.transferBytes },
  { key: "cdnHitRatio", label: "CDN hit ratio", unit: "ratio", value: (m) => m.cdnHitRatio },
  {
    key: "browserCacheHitRatio",
    label: "Browser cache hit ratio",
    unit: "ratio",
    value: (m) => m.browserCacheHitRatio,
  },
];

const UNIT_OF = new Map(METRIC_ROWS.map((r) => [r.key, r.unit]));

/** A table cell or heading: pipes escaped, line breaks flattened. */
const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\s*\r?\n\s*/g, " ");

const table = (header: string[], rows: string[][]): string[] => [
  `| ${header.join(" | ")} |`,
  `| ${header.map(() => "---").join(" | ")} |`,
  ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
];

function metricsTable(m: PageMetricsSummary): string[] {
  return table(
    ["Metric", "Value", "Rating"],
    METRIC_ROWS.map((r) => {
      const value = r.value(m) ?? null;
      const rating = rateMetric(r.key, value);
      return [
        r.label,
        formatMetricValue(value, r.unit),
        rating === "none" ? "" : rating.replace("-", " "),
      ];
    })
  );
}

const SEVERITY_TITLES: [FindingSeverity, string][] = [
  ["critical", "Critical"],
  ["warning", "Warning"],
  ["info", "Info"],
];
const MAX_EVIDENCE = 5;

function evidenceLine(e: FindingEvidence): string {
  const parts = [
    e.detail,
    e.bytes === undefined ? undefined : formatBytes(e.bytes),
    e.ms === undefined ? undefined : formatMs(e.ms),
  ].filter((p): p is string => p !== undefined && p !== "");
  const url = `\`${e.url.replace(/`/g, "%60")}\``;
  return `  - ${url}${parts.length ? ` (${parts.join(", ")})` : ""}`;
}

function findingLines(f: Finding): string[] {
  return [
    `- **${f.title}**: ${f.summary}`,
    ...(f.recommendation ? [`  ${f.recommendation}`] : []),
    ...f.evidence.slice(0, MAX_EVIDENCE).map(evidenceLine),
    "",
    `  _Source: ${f.source}; confidence: ${f.confidence}._`,
  ];
}

function findingsSection(findings: Finding[]): string[] {
  if (findings.length === 0) return ["No findings."];
  const lines: string[] = [];
  for (const [severity, title] of SEVERITY_TITLES) {
    const group = findings.filter((f) => f.severity === severity);
    if (group.length === 0) continue;
    lines.push(`#### ${title}`, "", ...group.flatMap(findingLines), "");
  }
  const good = findings.filter((f) => f.severity === "good");
  if (good.length > 0) lines.push(`Good: ${good.map((f) => f.title).join("; ")}.`);
  return lines;
}

function hostsTable(flow: Flow, index: number): string[] {
  const { har } = flow.pages[index];
  const hops = analyzeHops(har, har.documentEntry.url);
  return table(
    ["Host", "Provider · PoP", "Requests", "Cache hits", "Bytes", "Median TTFB", "Protocol"],
    hops.map((h) => [
      h.host,
      h.pop ? `${h.providerName} · ${h.pop.city} (${h.pop.code})` : h.providerName,
      String(h.requests),
      String(h.cacheHits),
      formatBytes(h.bytes),
      formatMs(h.medianTtfbMs),
      protocolLabel(h),
    ])
  );
}

function pageSection({ flow, side }: Side, index: number, summary: PageMetricsSummary): string[] {
  const page = flow.pages[index];
  const heading = side ? `${side.toUpperCase()}: ${page.name}` : page.name;
  const findings = collectFindings(flow, side ? { side } : {}).filter(
    (f) => f.page.index === index
  );
  return [
    `## ${cell(heading)}`,
    "",
    page.har.documentEntry.url,
    "",
    "### Metrics",
    "",
    ...metricsTable(summary),
    "",
    "### Findings",
    "",
    ...findingsSection(findings),
    "",
    "### Hosts",
    "",
    ...hostsTable(flow, index),
    "",
  ];
}

function comparisonSection(a: Flow, b: Flow): string[] {
  const rows = compareFlows(a, b).metrics.map((m) => {
    const unit = UNIT_OF.get(m.key) ?? "count";
    const pct = formatDeltaPct(m.deltaPct);
    return [
      m.label,
      formatMetricValue(m.a, unit),
      formatMetricValue(m.b, unit),
      m.delta === null ? "n/a" : `${formatDelta(m.delta, unit)}${pct ? ` (${pct})` : ""}`,
      m.rating === "none" ? "" : m.rating,
    ];
  });
  return ["## Comparison", "", ...table(["Metric", "A", "B", "Delta", "Rating"], rows), ""];
}

/**
 * A report to paste into a ticket or a doc, GitHub-flavoured Markdown without HTML: per page
 * its metrics, findings (by severity, with the recommendation and up to five evidence rows)
 * and hosts. A comparison opens with a table of the metrics of A and B.
 */
export function markdownReport(flow: Flow, compare?: Flow): string {
  const sides = sidesOf(flow, compare);
  const lines = ["# HAR Trace Viewer report", ""];
  if (compare) lines.push(...comparisonSection(flow, compare));
  for (const side of sides) {
    const summaries = summarizeFlowMetrics(side.flow);
    summaries.forEach((summary, index) => lines.push(...pageSection(side, index, summary)));
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

// ── Mermaid: the document request ────────────────────────────────────────────

/** Mermaid ends a statement at ";" and starts a comment at "#". */
const mermaidText = (text: string) => text.replace(/[;#]/g, ",").replace(/\s+/g, " ");

function documentDiagram(flow: Flow, index: number): string[] {
  const page = flow.pages[index];
  const nodes = flow.pageAnalyses[index]?.nodes ?? flow.nodes;
  const node = (id: string) => nodes.find((n) => n.id === id && n.present);
  const doc = page.har.documentEntry;
  const ttfb = summarizeFlowMetrics(flow)[index].ttfb;

  const gfw = node("gfw");
  const edge = node("edge");
  const origin = node("origin");
  const label = (n: { label: string; subLabel?: string } | undefined, fallback: string) =>
    mermaidText(n ? [n.label, n.subLabel].filter(Boolean).join(" · ") : fallback);

  const cdnStatus = detectCdnCacheStatus(doc.responseHeaders);
  const request = `${doc.method ?? "GET"} ${new URL(doc.url).pathname}`;
  const response = `${doc.status} · TTFB ${formatMs(ttfb)}${edge ? ` · cache ${cdnStatus}` : ""}`;
  const servedByEdge = edge && cdnStatus === "hit";

  // The chain of servers the request crosses, browser side first.
  const chain = ["Browser", ...(gfw ? ["GFW"] : []), ...(edge ? ["Edge"] : [])];
  if (!servedByEdge) chain.push("Origin");
  const lines = [
    "sequenceDiagram",
    "    participant Browser",
    ...(gfw ? [`    participant GFW as ${label(gfw, "GFW")}`] : []),
    ...(edge ? [`    participant Edge as ${label(edge, "CDN edge")}`] : []),
    `    participant Origin as ${label(origin, "Origin")}`,
  ];
  chain.slice(0, -1).forEach((from, i) => {
    lines.push(`    ${from}->>${chain[i + 1]}: ${mermaidText(i === 0 ? request : "forward")}`);
  });
  if (servedByEdge) lines.push("    Note over Edge: served from the CDN cache");
  [...chain].reverse().forEach((from, i, reversed) => {
    if (i === reversed.length - 1) return;
    const to = reversed[i + 1];
    lines.push(`    ${from}-->>${to}: ${to === "Browser" ? mermaidText(response) : "response"}`);
  });
  return lines;
}

/**
 * A Mermaid sequence diagram of the document request per page: Browser, the GFW when the
 * client region has it, the CDN edge and the origin, with the TTFB and the CDN cache status
 * on the response. Each diagram is a fenced Markdown block under a heading with the page name.
 */
export function mermaidReport(flow: Flow, compare?: Flow): string {
  const blocks = sidesOf(flow, compare).flatMap(({ flow: f, side }) =>
    f.pages.map((page, index) => {
      const heading = side ? `${side.toUpperCase()}: ${page.name}` : page.name;
      return [`### ${cell(heading)}`, "", "```mermaid", ...documentDiagram(f, index), "```"].join(
        "\n"
      );
    })
  );
  return `${blocks.join("\n\n")}\n`;
}
