import { getRootDomain } from "../utils/domain.js";
import { isOwnNetworkResource, isOwnResource } from "../analysis/network-requests.js";
import type {
  CacheReport,
  CacheRecommendation,
  CdnCacheStatus,
  HarEntry,
  ParsedHar,
  RecommendationResource,
  ResourceCacheProfile,
} from "../types.js";

function parseMaxAge(cacheControl: string): number | null {
  const match = cacheControl.match(/\bmax-age=(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

// Splits a header list on commas that are not inside a quoted string.
function splitList(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of value) {
    if (char === '"') quoted = !quoted;
    if (char === "," && !quoted) {
      parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current.trim());
  return parts.filter(Boolean);
}

const FWD_STATUS: Record<string, CdnCacheStatus> = {
  miss: "miss",
  "uri-miss": "miss",
  "vary-miss": "miss",
  request: "miss",
  partial: "miss",
  stale: "stale",
  bypass: "bypass",
  method: "bypass",
};

// Cache-Status (RFC 9211) lists the caches the response crossed, the one closest to
// the client last. The last member that says "hit" or gives a "fwd" reason decides.
// `fwd` wins over `hit` when both are present (a stale entry that was revalidated).
function parseCacheStatus(value: string): CdnCacheStatus {
  for (const member of splitList(value).reverse()) {
    const params = member
      .split(";")
      .slice(1)
      .map((p) => p.trim().toLowerCase());
    const fwd = params.find((p) => p.startsWith("fwd="))?.slice(4);
    if (fwd !== undefined) return FWD_STATUS[fwd] ?? "miss";
    if (params.some((p) => p === "hit" || p === "hit=?1")) return "hit";
  }
  return "unknown";
}

// Classifies the free-form x-cache family: "Hit from cloudfront", "TCP_HIT",
// "TCP_REFRESH_HIT", "HIT, MISS". With several tiers the last one is the one closest
// to the client.
function parseXCache(value: string): CdnCacheStatus {
  const tier = splitList(value.toLowerCase()).pop() ?? "";
  if (/refresh_?hit/.test(tier)) return "stale";
  if (tier.includes("miss")) return "miss";
  if (tier.includes("hit")) return "hit";
  return "unknown";
}

const SIMPLE_STATUS: Record<string, CdnCacheStatus> = {
  hit: "hit",
  prerender: "hit",
  miss: "miss",
  stale: "stale",
  expired: "stale",
  revalidated: "stale",
  updating: "stale",
  bypass: "bypass",
  dynamic: "bypass",
};

// Header precedence: the platform-specific status headers first (x-vercel-cache,
// cf-cache-status, cdn-cache), then the standard Cache-Status, then the x-cache
// family. x-cache-remote reports the parent tier, so it is the last resort.
export function detectCdnCacheStatus(headers: Record<string, string>): CdnCacheStatus {
  for (const name of ["x-vercel-cache", "cf-cache-status", "cdn-cache"]) {
    const status = SIMPLE_STATUS[headers[name]?.trim().toLowerCase() ?? ""];
    if (status) return status;
  }

  const cacheStatus = headers["cache-status"];
  if (cacheStatus) {
    const status = parseCacheStatus(cacheStatus);
    if (status !== "unknown") return status;
  }

  for (const name of ["x-cache", "x-cache-status", "x-cache-remote"]) {
    const value = headers[name];
    if (value) {
      const status = parseXCache(value);
      if (status !== "unknown") return status;
    }
  }

  return "unknown";
}

export function profileResourceCache(headers: Record<string, string>): ResourceCacheProfile {
  const cc = headers["cache-control"] ?? "";
  const maxAge = parseMaxAge(cc);
  const rawAge = headers["age"];
  const parsedAge = rawAge !== undefined ? parseInt(rawAge, 10) : null;

  return {
    cdnStatus: detectCdnCacheStatus(headers),
    maxAge,
    age: parsedAge !== null && !isNaN(parsedAge) ? parsedAge : null,
    immutable: cc.includes("immutable"),
    mustRevalidate: cc.includes("must-revalidate"),
    noStore: cc.includes("no-store"),
  };
}

// A file name that carries a content hash: main.3f2a9c1b.js, chunk-47TTPNLV.js, index-BkD3x9_a.js.
// The hash is the last "." or "-" separated part, 8+ characters mixing letters and digits, so
// versions (jquery-3.6.1.min.js), words (nuance-c2c-button.css) and dates (build-20260101.js)
// do not count.
const HASHED_FILE =
  /[.-]([A-Za-z0-9_]{8,})\.(?:m?js|css|woff2?|ttf|otf|png|jpe?g|gif|webp|avif|svg)$/i;

function isContentHashed(url: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return false;
  }
  const hash = HASHED_FILE.exec(pathname)?.[1];
  return hash !== undefined && /\d/.test(hash) && /[a-z]/i.test(hash);
}

// Cache-Control that makes the browser download or revalidate the response on every use.
function preventsReuse(cacheControl: string): boolean {
  return /\b(no-store|no-cache)\b|\bmax-age=0\b/i.test(cacheControl);
}

/** Content-hashed assets fetched over the network that the browser may not reuse, biggest first. */
function uncachedVersionedAssets(entries: HarEntry[]): RecommendationResource[] {
  return entries
    .filter(
      (e) =>
        !e.isDocument &&
        e.fromCache === false &&
        (e.status === 200 || e.status === 304) &&
        isContentHashed(e.url) &&
        preventsReuse(e.responseHeaders["cache-control"] ?? "")
    )
    .map((e) => ({
      url: e.url,
      transferSize: e.transferSize,
      cacheControl: e.responseHeaders["cache-control"] ?? "",
    }))
    .sort((a, b) => b.transferSize - a.transferSize);
}

function buildRecommendations(
  doc: ResourceCacheProfile,
  own: CacheReport["ownResources"],
  browser: CacheReport["browser"],
  uncachedVersioned: RecommendationResource[]
): CacheRecommendation[] {
  const recs: CacheRecommendation[] = [];

  // Document-level
  if (doc.noStore) {
    recs.push({
      label: "Document not cached",
      description:
        "The document uses no-store, preventing any caching. Consider public, max-age=0, must-revalidate so CDNs can serve it.",
      severity: "critical",
    });
  } else if (doc.cdnStatus === "miss") {
    recs.push({
      label: "CDN miss on document",
      description:
        "The HTML document was not served from CDN cache. Ensure the CDN is configured to cache HTML responses.",
      severity: "warning",
    });
  } else if (doc.cdnStatus === "bypass") {
    recs.push({
      label: "CDN bypassed for document",
      description:
        "The CDN is bypassing the cache for the HTML document. Review Vary headers and CDN cache rules.",
      severity: "warning",
    });
  } else if (doc.cdnStatus === "hit" && doc.maxAge === 0 && doc.mustRevalidate) {
    recs.push({
      label: "Document revalidates on every request",
      description:
        "The document uses max-age=0, must-revalidate — the browser cannot cache it between navigations. Consider adding stale-while-revalidate for faster perceived navigation.",
      severity: "info",
    });
  } else if (doc.cdnStatus === "hit") {
    recs.push({
      label: "Document served from CDN",
      description:
        "The HTML document is cached at the CDN edge, reducing origin load and improving latency.",
      severity: "good",
    });
  }

  // Static assets
  if (own.total > 0) {
    if (own.immutableRatio >= 0.8) {
      recs.push({
        label: "Static assets use long-term caching",
        description: `${Math.round(own.immutableRatio * 100)}% of own resources use immutable long-term caching — ideal for content-hashed assets.`,
        severity: "good",
      });
    } else if (own.immutableRatio < 0.5) {
      recs.push({
        label: "Static assets could use longer TTLs",
        description:
          "Less than half of own resources use immutable long-term caching. Consider max-age=31536000, immutable for versioned assets.",
        severity: "warning",
      });
    }

    if (own.cdnHitRatio >= 0.8) {
      recs.push({
        label: "CDN cache effective for static assets",
        description: `${Math.round(own.cdnHitRatio * 100)}% of own resources fetched over the network came from the CDN cache.`,
        severity: "good",
      });
    } else if (own.cdnHits > 0 && own.cdnHitRatio < 0.5) {
      recs.push({
        label: "Low CDN hit rate for static assets",
        description: `Only ${Math.round(own.cdnHitRatio * 100)}% of own resources fetched over the network hit the CDN cache. Check Cache-Control headers and CDN configuration.`,
        severity: "warning",
      });
    }
  }

  if (uncachedVersioned.length > 0) {
    recs.push({
      label: "Versioned assets are not cached",
      description: `${uncachedVersioned.length} content-hashed assets are served with Cache-Control that forbids reusing them, so every visit fetches them again. Their file name changes whenever their content does: serve them with public, max-age=31536000, immutable.`,
      severity: "critical",
      resources: uncachedVersioned,
    });
  }

  // Browser cache
  const inferred = browser.inferred ?? 0;
  if (inferred > 0) {
    recs.push({
      label: "Browser cache hits inferred from WebPageTest",
      description: `WebPageTest leaves browser-cache hits out of repeat views. ${inferred} resources of the first view that were still fresh and not requested again are counted as hits.`,
      severity: "info",
    });
  }
  const revalidated = browser.revalidated ?? 0;
  if (revalidated > 0) {
    recs.push({
      label: `${revalidated} resources revalidated (304)`,
      description:
        "The browser had these resources cached but had to ask the server whether they changed: their lifetime had expired or Cache-Control requires revalidation. Each one costs a round trip without a download.",
      severity: "info",
    });
  }
  if (browser.total > 0) {
    if (browser.hitRatio >= 0.7) {
      recs.push({
        label: "Browser cache working well",
        description: `${Math.round(browser.hitRatio * 100)}% of resources served from browser cache — effective for repeat visits.`,
        severity: "good",
      });
    } else if (browser.hitRatio === 0) {
      recs.push({
        label: "No browser cache hits",
        description:
          "No resources were served from the browser cache. This may be a first visit or cache was disabled during recording.",
        severity: "info",
      });
    } else if (browser.hitRatio < 0.4) {
      recs.push({
        label: "Low browser cache hit ratio",
        description: `Only ${Math.round(browser.hitRatio * 100)}% of resources came from browser cache. Review Cache-Control headers for static assets.`,
        severity: "warning",
      });
    }
  }

  return recs;
}

export function analyzeCacheForHar(har: ParsedHar): CacheReport {
  const doc = har.documentEntry;
  const documentProfile = profileResourceCache(doc.responseHeaders);
  const documentRoot = getRootDomain(doc.url);

  const ownNonDoc = har.entries.filter((e) => isOwnResource(e, documentRoot));
  // A browser-cache hit replays a stored response: its CDN status is not this load's.
  const ownNetwork = ownNonDoc.filter((e) => isOwnNetworkResource(e, documentRoot));

  const cdnHits = ownNetwork.filter(
    (e) => detectCdnCacheStatus(e.responseHeaders) === "hit"
  ).length;

  const immutableCount = ownNonDoc.filter((e) =>
    (e.responseHeaders["cache-control"] ?? "").includes("immutable")
  ).length;

  const ownTotal = ownNonDoc.length;

  const allNonDoc = har.entries.filter((e) => !e.isDocument);
  const fromDisk = allNonDoc.filter((e) => e.fromCache === "disk").length;
  const fromMemory = allNonDoc.filter((e) => e.fromCache === "memory").length;
  const inferred = har.inferredCacheHits?.length ?? 0;
  const revalidated = allNonDoc.filter((e) => e.status === 304).length;
  const browserTotal = allNonDoc.length + inferred;

  const ownResources: CacheReport["ownResources"] = {
    total: ownTotal,
    network: ownNetwork.length,
    cdnHits,
    cdnHitRatio: ownNetwork.length > 0 ? cdnHits / ownNetwork.length : 0,
    immutableCount,
    immutableRatio: ownTotal > 0 ? immutableCount / ownTotal : 0,
  };

  const browser: CacheReport["browser"] = {
    total: browserTotal,
    fromDisk,
    fromMemory,
    inferred,
    revalidated,
    hitRatio: browserTotal > 0 ? (fromDisk + fromMemory + inferred) / browserTotal : 0,
  };

  return {
    document: documentProfile,
    ownResources,
    browser,
    recommendations: buildRecommendations(
      documentProfile,
      ownResources,
      browser,
      uncachedVersionedAssets(har.entries)
    ),
  };
}
