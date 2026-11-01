import type { HarEntry, PreconnectSource, ResourcePriority, ResourceType } from "@htv/core";

// More preconnects than this compete with the critical requests for bandwidth and CPU.
export const MAX_PRECONNECT_HOSTS = 3;

// Tag managers, analytics, beacons and ads: they load after the render on purpose, so a
// preconnect to them only takes a connection away from what the page needs to render.
const NON_CRITICAL_HOSTS = [
  "googletagmanager.com",
  "google-analytics.com",
  "analytics.google.com",
  "doubleclick.net",
  "googlesyndication.com",
  "googleadservices.com",
  "adservice.google.com",
  "facebook.net",
  "facebook.com",
  "hotjar.com",
  "hotjar.io",
  "clarity.ms",
  "bat.bing.com",
  "segment.com",
  "segment.io",
  "mixpanel.com",
  "amplitude.com",
  "heapanalytics.com",
  "fullstory.com",
  "nr-data.net",
  "newrelic.com",
  "licdn.com",
  "ads.linkedin.com",
  "analytics.tiktok.com",
  "criteo.com",
  "criteo.net",
  "taboola.com",
  "outbrain.com",
  "adnxs.com",
  "scorecardresearch.com",
  "quantserve.com",
  "tiqcdn.com",
  "adobedtm.com",
  "demdex.net",
  "omtrdc.net",
  "chartbeat.com",
  "plausible.io",
  "cloudflareinsights.com",
  "vercel-scripts.com",
];

function isNonCriticalHost(hostname: string): boolean {
  return NON_CRITICAL_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

// Fonts and stylesheets hold the first render; scripts and images only when the browser
// fetches them at high priority (parser-blocking scripts, the LCP image).
const RENDER_ORDER: Partial<Record<ResourceType, number>> = {
  font: 0,
  stylesheet: 1,
  script: 2,
  image: 3,
};

const HIGH_PRIORITY: ReadonlySet<ResourcePriority | undefined> = new Set(["VeryHigh", "High"]);

function isRenderCritical(entry: HarEntry, renderDeadline: number | null): boolean {
  if (renderDeadline !== null && entry.startTime >= renderDeadline) return false;
  if (entry.resourceType === "font" || entry.resourceType === "stylesheet") return true;
  if (entry.resourceType !== "script" && entry.resourceType !== "image") return false;
  // Without priorities (Firefox HARs) only the timing before the render tells.
  return entry.priority === undefined ? renderDeadline !== null : HIGH_PRIORITY.has(entry.priority);
}

interface PreconnectOptions {
  documentHostname: string;
  preconnectHints: Record<string, PreconnectSource>;
  // When the page rendered (LCP, else FCP) on the HAR time base; null without a trace.
  renderDeadline: number | null;
}

/**
 * The cross-origin hosts worth a preconnect: hosts of resources the render waits for
 * (fonts, stylesheets, high-priority scripts and images fetched before the render), most
 * critical first, without the document host, hosts already preconnected and tag, analytics
 * and ad hosts. At most MAX_PRECONNECT_HOSTS.
 */
export function preconnectCandidates(
  resources: HarEntry[],
  { documentHostname, preconnectHints, renderDeadline }: PreconnectOptions
): string[] {
  const best = new Map<string, { order: number; startTime: number }>();
  for (const entry of resources) {
    let hostname: string;
    try {
      hostname = new URL(entry.url).hostname;
    } catch {
      continue;
    }
    if (hostname === documentHostname || preconnectHints[hostname]) continue;
    if (isNonCriticalHost(hostname) || !isRenderCritical(entry, renderDeadline)) continue;
    const order = RENDER_ORDER[entry.resourceType]!;
    const current = best.get(hostname);
    if (
      !current ||
      order < current.order ||
      (order === current.order && entry.startTime < current.startTime)
    ) {
      best.set(hostname, { order, startTime: entry.startTime });
    }
  }
  return [...best.entries()]
    .sort(([, a], [, b]) => a.order - b.order || a.startTime - b.startTime)
    .slice(0, MAX_PRECONNECT_HOSTS)
    .map(([hostname]) => hostname);
}
