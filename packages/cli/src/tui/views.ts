import {
  COMPARED_METRICS,
  analyzeHops,
  compareStepMetrics,
  formatBytes,
  formatDelta,
  formatDeltaPct,
  formatMetricValue,
  formatMs,
  getStepCacheResources,
  getStepResources,
  rateDelta,
  rateMetric,
  shortUrl,
  summarizeFlowMetrics,
} from "@htv/core";
import type {
  CacheReport,
  CacheRecommendation,
  DiagramStep,
  Flow,
  FlowComparison,
  HarEntry,
} from "@htv/core";
import { BLANK, DELTA_COLOR, RATING_COLOR, heading, line, seg, table, wrap } from "./lines.js";
import type { Line } from "./lines.js";

// Resources listed per step, busiest first; the rest are counted.
const MAX_STEP_RESOURCES = 12;

const pct = (ratio: number) => `${Math.round(ratio * 100)}%`;

/** The page a flow position belongs to: "Page 2 / 3 · Checkout", or its name alone. */
export function pageLabel(flow: Flow, pageIndex: number): string {
  const name = flow.pages[pageIndex]?.name ?? "";
  return flow.pages.length > 1 ? `Page ${pageIndex + 1} / ${flow.pages.length} · ${name}` : name;
}

/** The labels of the nodes a step lights up, in order: "Browser → Akamai Edge → Origin Server". */
function route(flow: Flow, step: DiagramStep): string {
  const nodes = flow.pageAnalyses[step.pageIndex]?.nodes ?? [];
  return step.activeNodes.map((id) => nodes.find((n) => n.id === id)?.label ?? id).join(" → ");
}

// ── Overview ──────────────────────────────────────────────────────────────────

/** The metrics summary of every page, rated like the web app, then the current page's nodes. */
export function overviewLines(flow: Flow, pageIndex: number, width: number): Line[] {
  const summaries = summarizeFlowMetrics(flow);
  const rows = COMPARED_METRICS.map((metric) => [
    metric.label,
    ...summaries.map((summary) => {
      const value = metric.value(summary) ?? null;
      return seg(formatMetricValue(value, metric.unit), {
        color: RATING_COLOR[rateMetric(metric.key, value)],
      });
    }),
  ]);
  const lines: Line[] = [
    heading("Metrics"),
    ...table(["Metric", ...summaries.map((s) => s.name)], rows, [
      "left",
      ...summaries.map(() => "right" as const),
    ]),
    BLANK,
    heading(`Network · ${pageLabel(flow, pageIndex)}`),
    ...nodeLines(flow, pageIndex),
  ];
  const suggestion = flow.hints.suggestedClientRegion;
  if (suggestion && flow.clientRegion === "default") {
    lines.push(
      BLANK,
      ...wrap(`Note: ${suggestion.reason}. Re-run with --region ${suggestion.region}.`, width)
    );
  }
  return lines;
}

function nodeLines(flow: Flow, pageIndex: number): Line[] {
  const nodes = (flow.pageAnalyses[pageIndex]?.nodes ?? []).filter((n) => n.present);
  return table(
    ["Node", "Detail", "Requests"],
    nodes.map((node) => {
      const stats = node.resourceStats;
      const detail = [node.subLabel, stats?.label].filter(Boolean).join(" · ");
      const requests = stats
        ? `${stats.count}${stats.avgMs !== undefined ? ` · avg ${formatMs(stats.avgMs)}` : ""}`
        : "";
      return [seg(node.label, { bold: true }), detail, requests];
    })
  );
}

/** Both flows' metrics with B − A, numbered against the notes that change how they read. */
export function compareOverviewLines(
  comparison: FlowComparison,
  names: { a: string; b: string },
  width: number
): Line[] {
  const { metrics, caveats } = comparison;
  const marker = (target: string) => {
    const numbers = caveats.flatMap((c, i) =>
      (c.affects as string[]).includes(target) ? [i + 1] : []
    );
    return numbers.length > 0 ? ` [${numbers.join(",")}]` : "";
  };
  const unitOf = (key: string) => COMPARED_METRICS.find((m) => m.key === key)!.unit;
  const rows = metrics.map((m) => {
    const unit = unitOf(m.key);
    const rated = (value: number | null) =>
      seg(formatMetricValue(value, unit), { color: RATING_COLOR[rateMetric(m.key, value)] });
    return [
      `${m.label}${marker(m.key)}`,
      rated(m.a),
      rated(m.b),
      seg(formatDelta(m.delta, unit), { color: DELTA_COLOR[m.rating] }),
      seg(formatDeltaPct(m.deltaPct), { dim: true }),
    ];
  });
  const lines: Line[] = [
    heading("Metrics · B − A"),
    ...table(["Metric", `A ${names.a}`, `B ${names.b}`, "Δ", "Δ %"], rows, [
      "left",
      "right",
      "right",
      "right",
      "right",
    ]),
  ];
  if (caveats.length > 0) {
    lines.push(BLANK, heading("Notes"));
    caveats.forEach((caveat, i) => {
      const [first, ...rest] = wrap(caveat.text, width - 4, "    ");
      lines.push(
        [seg(`[${i + 1}] `, { color: "yellow" }), seg(first[0].text.trimStart())],
        ...rest
      );
    });
  }
  return lines;
}

// ── Steps ─────────────────────────────────────────────────────────────────────

function resourceRows(entries: HarEntry[]): Line[] {
  const shown = [...entries]
    .sort((a, b) => b.transferSize - a.transferSize)
    .slice(0, MAX_STEP_RESOURCES);
  const lines = table(
    ["Resource", "Type", "Size", "Time"],
    shown.map((e) => [
      shortUrl(e.url),
      e.resourceType,
      formatBytes(e.transferSize),
      formatMs(e.duration),
    ]),
    ["left", "left", "right", "right"]
  );
  if (entries.length > shown.length) {
    lines.push([seg(`… ${entries.length - shown.length} more`, { dim: true })]);
  }
  return lines;
}

/** One step of the flow: what happens, the route it lights up, its metrics and resources. */
export function stepLines(flow: Flow, stepIndex: number, width: number): Line[] {
  const step = flow.steps[stepIndex];
  const lines: Line[] = [
    line(
      seg(`Step ${stepIndex + 1} / ${flow.steps.length}`, { dim: true }),
      seg(`  ${pageLabel(flow, step.pageIndex)}`, { dim: true })
    ),
    heading(step.title),
    ...wrap(step.description, width),
    BLANK,
    line(seg("Route  ", { dim: true }), route(flow, step)),
  ];
  if (step.badge) {
    lines.push(
      line(seg("Badge  ", { dim: true }), `${step.badge.type.toUpperCase()} ${step.badge.value}`)
    );
  }
  if (step.metrics.length > 0) {
    lines.push(
      BLANK,
      ...table(
        ["Metric", "Value"],
        step.metrics.map((m) => [m.label, m.value]),
        ["left", "right"]
      )
    );
  }
  const network = getStepResources(flow, step);
  if (network.length > 0) {
    lines.push(BLANK, heading(`Network requests · ${network.length}`), ...resourceRows(network));
  }
  const cached = getStepCacheResources(flow, step);
  if (cached.length > 0) {
    lines.push(
      BLANK,
      heading(`From the browser cache · ${cached.length}`),
      ...resourceRows(cached)
    );
  }
  return lines;
}

/** One pair of a comparison: the step each flow shows, their joined metrics and routes. */
export function pairLines(
  a: Flow,
  b: Flow,
  views: { a: { index: number; current: boolean }; b: { index: number; current: boolean } },
  position: { index: number; total: number },
  width: number
): Line[] {
  const stepA = a.steps[views.a.index];
  const stepB = b.steps[views.b.index];
  const title = (side: "A" | "B", step: DiagramStep, current: boolean): Line => [
    seg(`${side}  `, { bold: true, color: side === "A" ? "cyan" : "yellow" }),
    seg(step.title, current ? { bold: true } : { dim: true }),
    ...(current ? [] : [seg("  (holds its previous step)", { dim: true })]),
  ];
  const rows = compareStepMetrics(
    views.a.current ? stepA : undefined,
    views.b.current ? stepB : undefined
  );
  const lines: Line[] = [
    line(seg(`Step ${position.index + 1} / ${position.total}`, { dim: true })),
    title("A", stepA, views.a.current),
    title("B", stepB, views.b.current),
    BLANK,
    ...wrap((views.a.current ? stepA : stepB).description, width),
    BLANK,
    line(seg("Route A  ", { dim: true }), route(a, stepA)),
    line(seg("Route B  ", { dim: true }), route(b, stepB)),
  ];
  if (rows.length > 0) {
    lines.push(
      BLANK,
      ...table(
        ["Metric", "A", "B", "Δ"],
        rows.map((row) => [
          row.label,
          row.a ?? "",
          row.b ?? "",
          seg(
            row.delta === null
              ? ""
              : formatDelta(
                  row.delta,
                  row.unit === "ms" ? "ms" : Number.isInteger(row.delta) ? "count" : "score"
                ),
            { color: DELTA_COLOR[row.rating] }
          ),
        ]),
        ["left", "right", "right", "right"]
      )
    );
  }
  return lines;
}

// ── Hosts ─────────────────────────────────────────────────────────────────────

/** Every host of a page: requests, browser-cache hits, bytes, TTFB, CDN cache hits, provider and PoP. */
export function hostLines(flow: Flow, pageIndex: number): Line[] {
  const { har } = flow.pages[pageIndex];
  const hops = analyzeHops(har, har.documentEntry.url);
  return [
    heading(`Hosts · ${pageLabel(flow, pageIndex)}`),
    ...table(
      [
        "Host",
        "Requests",
        "Cached",
        "Transfer",
        "Avg TTFB",
        "CDN hits",
        "Provider",
        "PoP",
        "Party",
      ],
      hops.map((hop) => [
        seg(hop.host, { bold: true }),
        String(hop.requests),
        String(hop.browserCacheHits),
        formatBytes(hop.bytes),
        formatMs(hop.avgTtfbMs),
        hop.cacheHits + hop.cacheMisses > 0 ? pct(hop.hitRatio) : "n/a",
        hop.providerName,
        hop.pop ? `${hop.pop.city} (${hop.pop.code.toUpperCase()})` : "",
        hop.party,
      ]),
      ["left", "right", "right", "right", "right", "right", "left", "left", "left"]
    ),
  ];
}

/** The hosts of both flows joined by name; the TTFB delta covers the URLs both requested. */
export function hostDeltaLines(
  comparison: FlowComparison,
  names: { a: string; b: string }
): Line[] {
  const notes = comparison.caveats.flatMap((c, i) => (c.affects.includes("hosts") ? [i + 1] : []));
  return [
    heading(`Hosts · A ${names.a} vs B ${names.b}${notes.length ? ` [${notes.join(",")}]` : ""}`),
    ...table(
      [
        "Host",
        "Req A",
        "Req B",
        "Δ",
        "Avg TTFB A",
        "Avg TTFB B",
        "Same URLs",
        "Δ TTFB",
        "Provider",
      ],
      comparison.hops.map(({ host, a, b, sameUrls }) => {
        const requests = (b?.requests ?? 0) - (a?.requests ?? 0);
        const ttfb = sameUrls ? Math.round(sameUrls.delta) : null;
        return [
          seg(host, { bold: true }),
          String(a?.requests ?? 0),
          String(b?.requests ?? 0),
          seg(formatDelta(requests, "count"), { color: DELTA_COLOR[rateDelta(requests)] }),
          a ? formatMs(a.avgTtfbMs) : "—",
          b ? formatMs(b.avgTtfbMs) : "—",
          String(sameUrls?.count ?? 0),
          seg(ttfb === null ? "" : formatDelta(ttfb, "ms"), {
            color: DELTA_COLOR[rateDelta(ttfb)],
          }),
          (b ?? a)!.providerName,
        ];
      }),
      ["left", "right", "right", "right", "right", "right", "right", "right", "left"]
    ),
  ];
}

// ── Cache ─────────────────────────────────────────────────────────────────────

const SEVERITY: Record<CacheRecommendation["severity"], { icon: string; color: string }> = {
  good: { icon: "✓", color: "green" },
  info: { icon: "i", color: "cyan" },
  warning: { icon: "!", color: "yellow" },
  critical: { icon: "✕", color: "red" },
};

const fileName = (url: string) => {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).pop() ?? url;
  } catch {
    return url;
  }
};

const kv = (label: string, value: string): Line => [
  seg(label.padEnd(24), { dim: true }),
  seg(value),
];

/** The cache report of a page: document, static assets, browser cache and recommendations. */
export function cacheLines(report: CacheReport, title: string, width: number): Line[] {
  const { document: doc, ownResources: own, browser, recommendations } = report;
  const inferred = browser.inferred ?? 0;
  const revalidated = browser.revalidated ?? 0;
  const directives = Object.entries({
    immutable: doc.immutable,
    "must-revalidate": doc.mustRevalidate,
    "no-store": doc.noStore,
  })
    .filter(([, on]) => on)
    .map(([name]) => name)
    .join(", ");

  const lines: Line[] = [
    heading(title),
    BLANK,
    heading("Document"),
    kv("CDN cache", doc.cdnStatus === "unknown" ? "—" : doc.cdnStatus.toUpperCase()),
    kv("max-age", doc.maxAge === null ? "—" : `${doc.maxAge}s`),
    ...(directives ? [kv("Directives", directives)] : []),
    kv("CDN age", doc.age === null ? "—" : `${doc.age}s`),
  ];
  if (own.total > 0) {
    lines.push(
      BLANK,
      heading(`Static assets · ${own.total}`),
      kv("CDN hits", `${own.cdnHits}/${own.total} ${pct(own.cdnHitRatio)}`),
      kv("Immutable", `${own.immutableCount}/${own.total} ${pct(own.immutableRatio)}`)
    );
  }
  lines.push(
    BLANK,
    heading("Browser cache"),
    kv(
      "Hit ratio",
      `${pct(browser.hitRatio)} (${browser.fromDisk + browser.fromMemory + inferred}/${browser.total})`
    )
  );
  if (browser.fromDisk > 0) lines.push(kv("From disk", String(browser.fromDisk)));
  if (browser.fromMemory > 0) lines.push(kv("From memory", String(browser.fromMemory)));
  if (inferred > 0) lines.push(kv("Inferred (WebPageTest)", String(inferred)));
  if (revalidated > 0) lines.push(kv("Revalidated (304)", String(revalidated)));

  if (recommendations.length > 0) lines.push(BLANK, heading("Recommendations"));
  for (const rec of recommendations) {
    const { icon, color } = SEVERITY[rec.severity];
    lines.push(BLANK, [seg(`${icon} `, { color, bold: true }), seg(rec.label, { bold: true })]);
    lines.push(...wrap(rec.description, width, "  "));
    if (rec.resources && rec.resources.length > 0) {
      const total = rec.resources.reduce((sum, r) => sum + r.transferSize, 0);
      lines.push(
        [seg(`  ${rec.resources.length} resources · ${formatBytes(total)}`, { dim: true })],
        ...table(
          ["  Resource", "Size", "Cache-Control"],
          rec.resources.map((r) => [
            `  ${fileName(r.url)}`,
            formatBytes(r.transferSize),
            r.cacheControl,
          ]),
          ["left", "right", "left"]
        ).slice(1)
      );
    }
  }
  return lines;
}
