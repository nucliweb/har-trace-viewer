import { formatBytes, formatMs } from "../utils/format.js";
import { METRIC_THRESHOLDS, rateMetric, summarizeFlowMetrics } from "./metrics-summary.js";
import type { PageMetricsSummary } from "./metrics-summary.js";
import type {
  Finding,
  FindingConfidence,
  FindingEvidence,
  FindingMetric,
  FindingPage,
  FindingSeverity,
  Flow,
  HarEntry,
  PageAnalysis,
  Recommendation,
} from "../types.js";

// ── Rules for the reports' recommendations ───────────────────────────────────

interface Rule {
  id: string;
  metric: FindingMetric;
  confidence: FindingConfidence;
  // The recommendation is about the document: without resources, the document is its evidence.
  document?: true;
}

const rule = (
  id: string,
  metric: FindingMetric,
  confidence: FindingConfidence,
  document?: true
): Rule => ({ id, metric, confidence, ...(document ? { document } : {}) });

// The known recommendation labels and their rule ids. Patterns match the labels that carry a
// count, and the table keeps the ids stable when a label is reworded: change the pattern, never
// the id.
const RULES: [string | RegExp, Rule][] = [
  // Network report
  [/^The document is behind /, rule("document-redirects", "ttfb", "high", true)],
  [/ server errors? \(5xx\)$/, rule("server-errors", "none", "high")],
  [/ requests? failed \(4xx\)$/, rule("client-errors", "requests", "high")],
  [/ insecure requests? on an HTTPS page$/, rule("mixed-content", "none", "high")],
  [/ downloaded more than once$/, rule("duplicate-requests", "transfer", "high")],
  [/^\d+ resource redirects?$/, rule("resource-redirects", "requests", "high")],
  // Cache report: the document
  [
    "Personalized document not cached",
    rule("personalized-document-not-cached", "ttfb", "medium", true),
  ],
  ["Document not cached", rule("document-not-cached", "ttfb", "medium", true)],
  ["CDN miss on document", rule("cdn-miss-document", "ttfb", "medium", true)],
  ["CDN bypassed for document", rule("cdn-bypass-document", "ttfb", "medium", true)],
  ["Document served from CDN", rule("cdn-hit-document", "ttfb", "medium", true)],
  ["Document revalidates on every request", rule("document-revalidates", "ttfb", "high", true)],
  // Cache report: static assets
  ["Static assets use long-term caching", rule("long-term-caching", "transfer", "medium")],
  ["Static assets could use longer TTLs", rule("short-ttl-static-assets", "transfer", "medium")],
  ["CDN cache effective for static assets", rule("cdn-cache-effective", "lcp", "medium")],
  ["Low CDN hit rate for static assets", rule("low-cdn-hit-rate", "lcp", "medium")],
  ["Versioned assets are not cached", rule("versioned-assets-not-cached", "transfer", "high")],
  [
    "Versioned assets revalidate on every use",
    rule("versioned-assets-revalidate", "requests", "high"),
  ],
  // Cache report: browser cache
  ["Browser cache hits inferred from WebPageTest", rule("wpt-inferred-cache-hits", "none", "low")],
  [/ resources? revalidated \(304\)$/, rule("revalidated-resources", "requests", "high")],
  ["Browser cache working well", rule("browser-cache-effective", "transfer", "medium")],
  ["No browser cache hits", rule("no-browser-cache-hits", "transfer", "medium")],
  ["Low browser cache hit ratio", rule("low-browser-cache-hit-ratio", "transfer", "medium")],
  // Render report: LCP attribution from the trace
  ["LCP image is lazy-loaded", rule("lcp-image-lazy-loaded", "lcp", "high")],
  ["LCP image discovered late", rule("lcp-image-discovered-late", "lcp", "high")],
  [
    "LCP resource not preloaded and discovered by script/CSS",
    rule("lcp-resource-not-preloaded", "lcp", "high"),
  ],
  ["LCP element render delay", rule("lcp-render-delay", "lcp", "medium")],
  ["LCP is good", rule("lcp-good", "lcp", "high")],
  // Render report: render-blocking resources and critical chains
  ["Render-blocking resources delay FCP", rule("render-blocking-resources", "fcp", "high")],
  ["Third-party script blocks rendering", rule("third-party-render-blocking", "fcp", "high")],
  ["Long critical request chain", rule("long-critical-chain", "fcp", "medium")],
  ["Render-blocking resources are minimal", rule("render-blocking-minimal", "fcp", "high")],
  // Compression report
  ["Text responses served uncompressed", rule("uncompressed-text", "transfer", "high")],
  ["Brotli would shrink gzip responses", rule("gzip-only-text", "transfer", "medium")],
  ["Legacy image formats", rule("legacy-image-formats", "transfer", "medium")],
  ["Images double-encoded", rule("images-double-encoded", "transfer", "high")],
  [
    "Text compressed with Brotli or Zstandard, images in modern formats",
    rule("compression-good", "transfer", "high"),
  ],
  // Connections report
  ["Hosts still on HTTP/1.1", rule("http1-hosts", "none", "high")],
  ["Several connections to the same host", rule("several-connections-per-host", "none", "high")],
  ["Cookies sent to static hosts", rule("cookies-to-static-hosts", "transfer", "high")],
  ["HTTP/3 advertised but not used", rule("http3-advertised-not-used", "none", "medium")],
  ["Every busy host on one HTTP/2 or HTTP/3 connection", rule("connections-good", "none", "high")],
];

// For recommendations without a rule: the metric their label names, else their report's.
const METRIC_WORDS: [RegExp, FindingMetric][] = [
  [/\bLCP\b|largest contentful/i, "lcp"],
  [/\bFCP\b|first contentful|first paint|render-blocking/i, "fcp"],
  [/\bCLS\b|layout shift/i, "cls"],
  [/\bINP\b|interaction/i, "inp"],
  [/\bTTFB\b|first byte/i, "ttfb"],
  [/compress|gzip|brotli|zstd|minif/i, "transfer"],
];
const SOURCE_METRIC: Record<string, FindingMetric> = { render: "lcp", compression: "transfer" };

/** A rule id from a label: kebab-case, without the counts and sizes that change between runs. */
function slug(label: string): string {
  const id = label
    .toLowerCase()
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:ms|s|kb|mb|gb|b|%|×)?(?![a-z])/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return id || "finding";
}

function ruleFor(label: string, source: string): Rule {
  const known = RULES.find(([match]) =>
    typeof match === "string" ? match === label : match.test(label)
  );
  if (known) return known[1];
  const metric =
    METRIC_WORDS.find(([words]) => words.test(label))?.[1] ?? SOURCE_METRIC[source] ?? "none";
  return rule(slug(label), metric, "medium");
}

// ── From a recommendation to a finding ───────────────────────────────────────

const SEVERITIES: readonly FindingSeverity[] = ["critical", "warning", "info", "good"];

// The end of the first sentence: a stop followed by a capital, "e.g." and "i.e." aside.
const SENTENCE_END = /(?<!\b(?:e\.g|i\.e))[.!?](?=\s+[A-Z<"'(])/;

/** The first sentence of a description, and the rest: what happened, and what to do. */
function splitDescription(description: string): [string, string] {
  const text = description.trim();
  const end = text.search(SENTENCE_END);
  if (end === -1) return [text, ""];
  return [text.slice(0, end + 1), text.slice(end + 1).trim()];
}

// "301 → https://example.com/ · 120 ms": the time at the end of a detail.
function detailMs(detail: string | undefined): number | undefined {
  const match = detail?.match(/(\d+(?:\.\d+)?)\s*(ms|s)$/);
  if (!match) return undefined;
  return Math.round(Number(match[1]) * (match[2] === "s" ? 1000 : 1));
}

function resourceEvidence(rec: Recommendation): FindingEvidence[] {
  return (rec.resources ?? []).map((r) => {
    const detail = r.detail ?? r.cacheControl;
    const ms = detailMs(r.detail);
    return {
      url: r.url,
      ...(detail ? { detail } : {}),
      bytes: r.transferSize,
      ...(ms !== undefined ? { ms } : {}),
    };
  });
}

function documentEvidence(doc: HarEntry): FindingEvidence {
  const cacheControl = doc.responseHeaders["cache-control"];
  return {
    url: doc.url,
    ...(cacheControl ? { detail: `cache-control: ${cacheControl}` } : {}),
    ms: Math.round(doc.ttfb),
  };
}

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

/** A summary without numbers gets the count and size of its evidence: "… (2 resources, 9.0 KB)." */
function withNumbers(summary: string, evidence: FindingEvidence[]): string {
  if (/\d/.test(summary) || evidence.length === 0) return summary;
  const bytes = evidence.reduce((sum, e) => sum + (e.bytes ?? 0), 0);
  const count = `${evidence.length} ${plural(evidence.length, "resource", "resources")}`;
  const numbers = bytes > 0 ? `${count}, ${formatBytes(bytes)}` : count;
  const body = summary.replace(/[.!?]$/, "");
  return `${body} (${numbers}).`;
}

function confidenceOf(found: Rule, rec: Recommendation): FindingConfidence {
  // Repeated fetches that bypassed the cache may be an artifact of the recording.
  if (found.id === "duplicate-requests" && rec.severity === "info") return "low";
  return found.confidence;
}

function recommendationFinding(
  rec: Recommendation,
  source: string,
  page: FindingPage,
  doc: HarEntry | undefined
): Finding {
  const found = ruleFor(rec.label, source);
  const [summary, rest] = splitDescription(rec.description ?? "");
  const evidence = resourceEvidence(rec);
  if (evidence.length === 0 && found.document && doc) evidence.push(documentEvidence(doc));
  return {
    id: found.id,
    title: rec.label,
    severity: rec.severity,
    metric: found.metric,
    summary: withNumbers(summary, rec.resources?.length ? evidence : []),
    recommendation: rest || (rec.severity === "good" ? "No action needed." : ""),
    confidence: confidenceOf(found, rec),
    evidence,
    page,
    source,
  };
}

/** Every `<source>Report` of a page analysis that carries a `recommendations` list. */
function reports(analysis: PageAnalysis | undefined): [string, Recommendation[]][] {
  return Object.entries(analysis ?? {}).flatMap(([key, value]): [string, Recommendation[]][] => {
    if (!key.endsWith("Report")) return [];
    const list = (value as { recommendations?: unknown } | null)?.recommendations;
    if (!Array.isArray(list)) return [];
    const valid = (list as Recommendation[]).filter(
      (r) => typeof r?.label === "string" && SEVERITIES.includes(r.severity)
    );
    return [[key.slice(0, -"Report".length), valid]];
  });
}

// ── Metric findings ──────────────────────────────────────────────────────────

type VitalKey = "ttfb" | "fcp" | "lcp" | "cls" | "inp";

interface VitalRule {
  key: VitalKey;
  id: string;
  label: string;
  confidence: FindingConfidence;
  happened: (value: string, summary: PageMetricsSummary) => string;
  recommendation: string;
}

const VITALS: VitalRule[] = [
  {
    key: "ttfb",
    id: "slow-ttfb",
    label: "TTFB",
    confidence: "high",
    happened: (v, s) =>
      `The document's first byte arrived ${v} after the navigation started (server wait ${formatMs(s.serverWait)})`,
    recommendation:
      "Cut what happens before the first byte: link to the final URL to skip redirects, serve the HTML from a CDN cache, and speed up the server's response.",
  },
  {
    key: "fcp",
    id: "slow-fcp",
    label: "FCP",
    confidence: "high",
    happened: (v) => `The first contentful paint happened at ${v}`,
    recommendation:
      "Shorten the path to the first paint: reduce the TTFB, inline the critical CSS and load the rest without blocking, and load scripts with defer or async.",
  },
  {
    key: "lcp",
    id: "slow-lcp",
    label: "LCP",
    confidence: "high",
    happened: (v) => `The largest contentful paint happened at ${v}`,
    recommendation:
      "Make the LCP element quick to discover and load: reference its image in the HTML without lazy-loading, give it fetchpriority=high or a preload, serve it from a CDN cache, and remove the render-blocking resources in front of it.",
  },
  {
    key: "cls",
    id: "high-cls",
    label: "CLS",
    confidence: "medium",
    happened: (v) => `The layout shifted by a cumulative score of ${v}`,
    recommendation:
      "Reserve space for images, embeds and ads (width and height, or aspect-ratio), and do not insert content above what the user already sees.",
  },
  {
    key: "inp",
    id: "slow-inp",
    label: "INP",
    confidence: "medium",
    happened: (v) => `The slowest interaction took ${v} to paint its next frame`,
    recommendation:
      "Keep the main thread free to respond: break up long tasks, defer non-essential JavaScript, and keep event handlers short, moving work after the next paint.",
  },
];

const formatVital = (key: VitalKey, value: number) =>
  key === "cls" ? String(Number(value.toFixed(3))) : formatMs(value);

const vitalValue = (summary: PageMetricsSummary, key: VitalKey): number | null =>
  summary[key] ?? null;

function vitalFinding(
  vital: VitalRule,
  value: number,
  summary: PageMetricsSummary,
  page: FindingPage,
  documentUrl: string
): Finding | null {
  const rating = rateMetric(vital.key, value);
  if (rating !== "poor" && rating !== "needs-improvement") return null;
  const [good, poor] = METRIC_THRESHOLDS[vital.key].map((limit) => formatVital(vital.key, limit));
  const shown = formatVital(vital.key, value);
  const happened = vital.happened(shown, summary);
  const poorRating = rating === "poor";
  return {
    id: vital.id,
    title: `${vital.label} ${poorRating ? "is poor" : "needs improvement"}: ${shown}`,
    severity: poorRating ? "critical" : "warning",
    metric: vital.key,
    summary: poorRating
      ? `${happened}, over the ${poor} limit for poor (good is ${good} or less).`
      : `${happened}, over the ${good} limit for good (poor is over ${poor}).`,
    recommendation: vital.recommendation,
    confidence: vital.confidence,
    evidence: [
      vital.key === "cls"
        ? { url: documentUrl, detail: `CLS ${shown}` }
        : { url: documentUrl, ms: Math.round(value) },
    ],
    page,
    source: "metrics",
  };
}

/**
 * The Core Web Vitals and TTFB that rate poor or need improvement, or one good finding when
 * every measured one is good. Without an LCP (no trace) a good finding would claim too much.
 */
function metricFindings(
  summary: PageMetricsSummary,
  page: FindingPage,
  documentUrl: string
): Finding[] {
  const measured = VITALS.flatMap((vital) => {
    const value = vitalValue(summary, vital.key);
    return value === null ? [] : [{ vital, value }];
  });
  const findings = measured.flatMap(({ vital, value }) => {
    const finding = vitalFinding(vital, value, summary, page, documentUrl);
    return finding ? [finding] : [];
  });
  if (findings.length > 0 || summary.lcp === null) return findings;
  const values = measured.map(
    ({ vital, value }) => `${vital.label} ${formatVital(vital.key, value)}`
  );
  const list = `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
  return [
    {
      id: "core-web-vitals-good",
      title: "Core Web Vitals are good",
      severity: "good",
      metric: "none",
      summary: `${list} are all within the good thresholds.`,
      recommendation:
        "No action needed: keep them there as the page changes, for instance with --budget in CI.",
      confidence: "high",
      evidence: [{ url: documentUrl, ms: Math.round(summary.lcp) }],
      page,
      source: "metrics",
    },
  ];
}

// ── Collecting ───────────────────────────────────────────────────────────────

const RANK: Record<FindingSeverity, number> = { critical: 0, warning: 1, info: 2, good: 3 };
const total = (evidence: FindingEvidence[], key: "ms" | "bytes") =>
  evidence.reduce((sum, e) => sum + (e[key] ?? 0), 0);

/** Critical first, then warning, info and good; within a severity, the most time, then bytes. */
function byImpact(a: Finding, b: Finding): number {
  return (
    RANK[a.severity] - RANK[b.severity] ||
    total(b.evidence, "ms") - total(a.evidence, "ms") ||
    total(b.evidence, "bytes") - total(a.evidence, "bytes")
  );
}

export interface CollectFindingsOptions {
  /** The side of a comparison the flow is: it goes into each finding's page. */
  side?: "a" | "b";
}

/**
 * Every finding of every page of a flow: the recommendations of each report on its page
 * analysis (any key ending in `Report` with a `recommendations` list), with stable rule ids,
 * and the Core Web Vitals and TTFB rated against the web.dev thresholds. Ordered by severity,
 * then by impact.
 */
export function collectFindings(flow: Flow, options: CollectFindingsOptions = {}): Finding[] {
  const summaries = summarizeFlowMetrics(flow);
  return flow.pages
    .flatMap((flowPage, index) => {
      const page: FindingPage = {
        index,
        name: flowPage.name,
        ...(options.side ? { side: options.side } : {}),
      };
      const doc = flowPage.har.documentEntry;
      return [
        ...reports(flow.pageAnalyses[index]).flatMap(([source, list]) =>
          list.map((rec) => recommendationFinding(rec, source, page, doc))
        ),
        ...metricFindings(summaries[index], page, doc.url),
      ];
    })
    .sort(byImpact);
}

// ── The findings document (--format findings) ────────────────────────────────

export type FindingsPageMetrics = Omit<PageMetricsSummary, "name" | "cls" | "inp"> & {
  cls: number | null;
  inp: number | null;
};

export interface FindingsDocumentPage {
  name: string;
  side?: "a" | "b";
  metrics: FindingsPageMetrics;
  findings: Finding[];
}

export interface FindingsDocument {
  schema: string;
  htvVersion: string;
  generatedAt: string;
  pages: FindingsDocumentPage[];
}

export interface FindingsDocumentMeta {
  htvVersion: string;
  generatedAt: string;
  /** Where the JSON schema of the document lives. */
  schema: string;
}

const round = (value: number, digits: number) => Number(value.toFixed(digits));
const roundOrNull = (value: number | null, digits: number) =>
  value === null ? null : round(value, digits);

/** The metrics summary as the document gives it: times to 0.1 ms, ratios and CLS to 0.001. */
function documentMetrics(m: PageMetricsSummary): FindingsPageMetrics {
  return {
    ttfb: round(m.ttfb, 1),
    serverWait: round(m.serverWait, 1),
    fcp: roundOrNull(m.fcp, 1),
    lcp: roundOrNull(m.lcp, 1),
    cls: roundOrNull(m.cls ?? null, 3),
    inp: roundOrNull(m.inp ?? null, 1),
    dcl: roundOrNull(m.dcl, 1),
    onLoad: roundOrNull(m.onLoad, 1),
    requests: m.requests,
    cacheHits: m.cacheHits,
    transferBytes: m.transferBytes,
    cdnHitRatio: roundOrNull(m.cdnHitRatio, 3),
    browserCacheHitRatio: round(m.browserCacheHitRatio, 3),
  };
}

/**
 * The findings of one flow, or of both sides of a comparison, as a compact document for
 * other tools: per page, its metrics summary (numbers) and its findings.
 */
export function findingsDocument(
  flows: { flow: Flow; side?: "a" | "b" }[],
  meta: FindingsDocumentMeta
): FindingsDocument {
  const pages = flows.flatMap(({ flow, side }) => {
    const findings = collectFindings(flow, side ? { side } : {});
    return summarizeFlowMetrics(flow).map((summary, index) => ({
      name: summary.name,
      ...(side ? { side } : {}),
      metrics: documentMetrics(summary),
      findings: findings.filter((f) => f.page.index === index),
    }));
  });
  return { schema: meta.schema, htvVersion: meta.htvVersion, generatedAt: meta.generatedAt, pages };
}
