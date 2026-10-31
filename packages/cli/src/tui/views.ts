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
  StepPair,
} from "@htv/core";
import {
  BLANK,
  DELTA_COLOR,
  RATING_COLOR,
  heading,
  hstack,
  line,
  panel,
  seg,
  table,
  wrap,
} from "./lines.js";
import type { Line } from "./lines.js";

// Resources listed per step, busiest first; the rest are counted.
const MAX_STEP_RESOURCES = 12;
// Below this width the panels of a tab stack instead of sitting side by side.
const SIDE_BY_SIDE_MIN = 96;
// The three cache summary panels need more room to share a row.
const CACHE_ROW_MIN = 120;
const METRICS_WIDTH = 38;
const LIST_WIDTH = 36;

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

/** Two panels side by side when the width allows, else one above the other. */
function pair(
  left: { title: string; body: Line[]; width: number },
  right: { title: string; body: Line[] },
  width: number
): Line[] {
  if (width < SIDE_BY_SIDE_MIN) {
    return [...panel(left.title, left.body, width), ...panel(right.title, right.body, width)];
  }
  const rightWidth = width - left.width - 1;
  const minHeight = Math.max(left.body.length, right.body.length) + 2;
  return hstack([
    { lines: panel(left.title, left.body, left.width, { minHeight }), width: left.width },
    { lines: panel(right.title, right.body, rightWidth, { minHeight }), width: rightWidth },
  ]);
}

// ── Overview ──────────────────────────────────────────────────────────────────

function nodeRows(flow: Flow, pageIndex: number): Line[] {
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

/** The rated metrics of one page beside its network nodes, and the region note when there is one. */
export function overviewRegion(flow: Flow, pageIndex: number, width: number): Line[] {
  const summary = summarizeFlowMetrics(flow)[pageIndex];
  const rows = COMPARED_METRICS.map((metric) => {
    const value = metric.value(summary) ?? null;
    const style =
      value === null ? { dim: true } : { color: RATING_COLOR[rateMetric(metric.key, value)] };
    return [metric.label, seg(formatMetricValue(value, metric.unit), style)];
  });
  const lines = pair(
    {
      title: "Metrics",
      body: table(["Metric", "Value"], rows, ["left", "right"]),
      width: METRICS_WIDTH,
    },
    { title: "Network", body: nodeRows(flow, pageIndex) },
    width
  );
  const suggestion = flow.hints.suggestedClientRegion;
  if (suggestion && flow.clientRegion === "default") {
    const text = `${suggestion.reason}. Re-run with --region ${suggestion.region} to draw the Great Firewall.`;
    lines.push(...panel("Note", wrap(text, width - 4), width));
  }
  return lines;
}

/** Both flows' metrics with B − A, numbered against the notes that change how they read. */
export function compareOverviewRegion(comparison: FlowComparison, width: number): Line[] {
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
      seg(
        formatMetricValue(value, unit),
        value === null ? { dim: true } : { color: RATING_COLOR[rateMetric(m.key, value)] }
      );
    return [
      `${m.label}${marker(m.key)}`,
      rated(m.a),
      rated(m.b),
      seg(formatDelta(m.delta, unit), { color: DELTA_COLOR[m.rating] }),
      seg(formatDeltaPct(m.deltaPct), { dim: true }),
    ];
  });
  const lines = panel(
    "Metrics · B − A",
    table(["Metric", "A", "B", "Δ", "Δ %"], rows, ["left", "right", "right", "right", "right"]),
    width
  );
  if (caveats.length > 0) {
    const notes: Line[] = [];
    caveats.forEach((caveat, i) => {
      const [first, ...rest] = wrap(caveat.text, width - 8, "    ");
      notes.push(
        [seg(`[${i + 1}] `, { color: "yellow" }), seg(first[0].text.trimStart())],
        ...rest
      );
    });
    lines.push(...panel("Notes", notes, width));
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

/**
 * The step titles as a list with the current one highlighted. A list taller than `maxRows`
 * shows a window around the selection, with the number of steps hidden above and below.
 */
function stepListRows(titles: string[], selected: number, width: number, maxRows: number): Line[] {
  const row = (i: number): Line => {
    const text = `${i === selected ? "▸" : " "} ${String(i + 1).padStart(2)}  ${titles[i]}`;
    return i === selected ? [seg(text.padEnd(width), { inverse: true, bold: true })] : [seg(text)];
  };
  if (titles.length <= maxRows) return titles.map((_, i) => row(i));
  const visible = Math.max(1, maxRows - 2);
  const start = Math.min(Math.max(0, selected - Math.floor(visible / 2)), titles.length - visible);
  const end = start + visible;
  const more = (count: number, arrow: string): Line => [
    seg(`  ${arrow} ${count} more`, { dim: true }),
  ];
  return [
    start > 0 ? more(start, "↑") : BLANK,
    ...Array.from({ length: visible }, (_, i) => row(start + i)),
    end < titles.length ? more(titles.length - end, "↓") : BLANK,
  ];
}

function stepDetailRows(flow: Flow, stepIndex: number, width: number): Line[] {
  const step = flow.steps[stepIndex];
  const rows: Line[] = [[seg(step.title, { bold: true })]];
  if (flow.pages.length > 1) rows.push([seg(pageLabel(flow, step.pageIndex), { dim: true })]);
  rows.push(
    ...wrap(step.description, width),
    BLANK,
    line(seg("Route  ", { dim: true }), route(flow, step))
  );
  if (step.badge) {
    rows.push(
      line(seg("Badge  ", { dim: true }), `${step.badge.type.toUpperCase()} ${step.badge.value}`)
    );
  }
  if (step.metrics.length > 0) {
    rows.push(
      BLANK,
      ...table(
        ["Metric", "Value"],
        step.metrics.map((m) => [m.label, m.value]),
        ["left", "right"]
      )
    );
  }
  const network = getStepResources(flow, step);
  if (network.length > 0)
    rows.push(BLANK, heading(`Network requests · ${network.length}`), ...resourceRows(network));
  const cached = getStepCacheResources(flow, step);
  if (cached.length > 0)
    rows.push(BLANK, heading(`From the browser cache · ${cached.length}`), ...resourceRows(cached));
  return rows;
}

/** The step list beside the current step: what happens, its route, metrics and resources. */
export function stepsRegion(flow: Flow, stepIndex: number, width: number, height: number): Line[] {
  const listWidth = width < SIDE_BY_SIDE_MIN ? width : LIST_WIDTH;
  const detailWidth = width < SIDE_BY_SIDE_MIN ? width : width - listWidth - 1;
  return pair(
    {
      title: "Steps",
      body: stepListRows(
        flow.steps.map((s) => s.title),
        stepIndex,
        listWidth - 4,
        height - 2
      ),
      width: listWidth,
    },
    {
      title: `Step ${stepIndex + 1} / ${flow.steps.length}`,
      body: stepDetailRows(flow, stepIndex, detailWidth - 4),
    },
    width
  );
}

/** The paired steps of a comparison beside the current pair: both sides' step, routes and deltas. */
export function pairStepsRegion(
  a: Flow,
  b: Flow,
  pairs: StepPair[],
  pairIndex: number,
  views: { a: { index: number; current: boolean }; b: { index: number; current: boolean } },
  width: number,
  height: number
): Line[] {
  const listWidth = width < SIDE_BY_SIDE_MIN ? width : LIST_WIDTH;
  const detailWidth = (width < SIDE_BY_SIDE_MIN ? width : width - listWidth - 1) - 4;
  const titles = pairs.map((p) => (p.a !== undefined ? a.steps[p.a] : b.steps[p.b!]).title);
  const stepA = a.steps[views.a.index];
  const stepB = b.steps[views.b.index];
  const side = (tag: "A" | "B", step: DiagramStep, current: boolean): Line => [
    seg(`${tag}  `, { bold: true, color: tag === "A" ? "cyan" : "yellow" }),
    seg(step.title, current ? { bold: true } : { dim: true }),
    ...(current ? [] : [seg("  (holds its previous step)", { dim: true })]),
  ];
  const rows: Line[] = [
    side("A", stepA, views.a.current),
    side("B", stepB, views.b.current),
    BLANK,
    ...wrap((views.a.current ? stepA : stepB).description, detailWidth),
    BLANK,
    line(seg("Route A  ", { dim: true }), route(a, stepA)),
    line(seg("Route B  ", { dim: true }), route(b, stepB)),
  ];
  const metrics = compareStepMetrics(
    views.a.current ? stepA : undefined,
    views.b.current ? stepB : undefined
  );
  if (metrics.length > 0) {
    rows.push(
      BLANK,
      ...table(
        ["Metric", "A", "B", "Δ"],
        metrics.map((row) => [
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
  return pair(
    {
      title: "Steps",
      body: stepListRows(titles, pairIndex, listWidth - 4, height - 2),
      width: listWidth,
    },
    { title: `Step ${pairIndex + 1} / ${pairs.length}`, body: rows },
    width
  );
}

// ── Hosts ─────────────────────────────────────────────────────────────────────

/** Every host of a page: requests, browser-cache hits, bytes, TTFB, CDN cache hits, provider and PoP. */
export function hostsRegion(flow: Flow, pageIndex: number, width: number): Line[] {
  const { har } = flow.pages[pageIndex];
  const hops = analyzeHops(har, har.documentEntry.url);
  return panel(
    `Hosts · ${pageLabel(flow, pageIndex)}`,
    table(
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
    width
  );
}

/** The hosts of both flows joined by name; the TTFB delta covers the URLs both requested. */
export function hostDeltaRegion(
  comparison: FlowComparison,
  names: { a: string; b: string },
  width: number
): Line[] {
  const notes = comparison.caveats.flatMap((c, i) => (c.affects.includes("hosts") ? [i + 1] : []));
  return panel(
    `Hosts · A ${names.a} vs B ${names.b}${notes.length ? ` [${notes.join(",")}]` : ""}`,
    table(
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
    width
  );
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
  seg(label.padEnd(19), { dim: true }),
  seg(value),
];

function recommendationRows(recommendations: CacheRecommendation[], width: number): Line[] {
  const rows: Line[] = [];
  recommendations.forEach((rec, i) => {
    const { icon, color } = SEVERITY[rec.severity];
    if (i > 0) rows.push(BLANK);
    rows.push([seg(`${icon} `, { color, bold: true }), seg(rec.label, { bold: true })]);
    rows.push(...wrap(rec.description, width, "  "));
    if (rec.resources && rec.resources.length > 0) {
      const total = rec.resources.reduce((sum, r) => sum + r.transferSize, 0);
      rows.push(
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
  });
  return rows;
}

/** The cache report of a page: document, static assets and browser cache, then the recommendations. */
export function cacheRegion(report: CacheReport, width: number): Line[] {
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

  const document: Line[] = [
    kv("CDN cache", doc.cdnStatus === "unknown" ? "—" : doc.cdnStatus.toUpperCase()),
    kv("max-age", doc.maxAge === null ? "—" : `${doc.maxAge}s`),
    ...(directives ? [kv("Directives", directives)] : []),
    kv("CDN age", doc.age === null ? "—" : `${doc.age}s`),
  ];
  const assets: Line[] =
    own.total > 0
      ? [
          kv("CDN hits", `${own.cdnHits}/${own.total} ${pct(own.cdnHitRatio)}`),
          kv("Immutable", `${own.immutableCount}/${own.total} ${pct(own.immutableRatio)}`),
        ]
      : [[seg("No own static assets", { dim: true })]];
  const cache: Line[] = [
    kv(
      "Hit ratio",
      `${pct(browser.hitRatio)} (${browser.fromDisk + browser.fromMemory + inferred}/${browser.total})`
    ),
    ...(browser.fromDisk > 0 ? [kv("From disk", String(browser.fromDisk))] : []),
    ...(browser.fromMemory > 0 ? [kv("From memory", String(browser.fromMemory))] : []),
    ...(inferred > 0 ? [kv("Inferred (WPT)", String(inferred))] : []),
    ...(revalidated > 0 ? [kv("Revalidated (304)", String(revalidated))] : []),
  ];
  const panels = [
    { title: "Document", body: document },
    { title: `Static assets · ${own.total}`, body: assets },
    { title: "Browser cache", body: cache },
  ];

  let lines: Line[];
  if (width >= CACHE_ROW_MIN) {
    const third = Math.floor((width - 2) / 3);
    const widths = [third, third, width - 2 * third - 2];
    const minHeight = Math.max(...panels.map((p) => p.body.length)) + 2;
    lines = hstack(
      panels.map((p, i) => ({
        lines: panel(p.title, p.body, widths[i], { minHeight }),
        width: widths[i],
      }))
    );
  } else {
    lines = panels.flatMap((p) => panel(p.title, p.body, width));
  }
  if (recommendations.length > 0) {
    lines.push(...panel("Recommendations", recommendationRows(recommendations, width - 4), width));
  }
  return lines;
}
