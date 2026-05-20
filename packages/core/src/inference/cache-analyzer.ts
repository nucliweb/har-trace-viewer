import type {
  CacheReport,
  CacheRecommendation,
  CdnCacheStatus,
  ParsedHar,
  ResourceCacheProfile,
} from "../types.js";

function getRootDomain(url: string): string {
  try {
    const parts = new URL(url).hostname.split(".");
    return parts.slice(-2).join(".");
  } catch {
    return url;
  }
}

function parseMaxAge(cacheControl: string): number | null {
  const match = cacheControl.match(/\bmax-age=(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

export function detectCdnCacheStatus(headers: Record<string, string>): CdnCacheStatus {
  const vercel = headers["x-vercel-cache"]?.toLowerCase();
  if (vercel === "hit") return "hit";
  if (vercel === "miss") return "miss";
  if (vercel === "stale") return "stale";
  if (vercel === "bypass") return "bypass";

  const cf = headers["cf-cache-status"]?.toLowerCase();
  if (cf === "hit") return "hit";
  if (cf === "miss") return "miss";
  if (cf === "expired" || cf === "revalidated") return "stale";
  if (cf === "bypass" || cf === "dynamic") return "bypass";

  const xCache = headers["x-cache"]?.toLowerCase();
  if (xCache?.includes("hit")) return "hit";
  if (xCache?.includes("miss")) return "miss";

  const xCacheStatus = headers["x-cache-status"]?.toLowerCase();
  if (xCacheStatus === "hit") return "hit";
  if (xCacheStatus === "miss") return "miss";

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

function buildRecommendations(
  doc: ResourceCacheProfile,
  own: CacheReport["ownResources"],
  browser: CacheReport["browser"],
): CacheRecommendation[] {
  const recs: CacheRecommendation[] = [];

  // Document-level
  if (doc.noStore) {
    recs.push({
      label: "Document not cached",
      description: "The document uses no-store, preventing any caching. Consider public, max-age=0, must-revalidate so CDNs can serve it.",
      severity: "critical",
    });
  } else if (doc.cdnStatus === "miss") {
    recs.push({
      label: "CDN miss on document",
      description: "The HTML document was not served from CDN cache. Ensure the CDN is configured to cache HTML responses.",
      severity: "warning",
    });
  } else if (doc.cdnStatus === "bypass") {
    recs.push({
      label: "CDN bypassed for document",
      description: "The CDN is bypassing the cache for the HTML document. Review Vary headers and CDN cache rules.",
      severity: "warning",
    });
  } else if (doc.cdnStatus === "hit" && doc.maxAge === 0 && doc.mustRevalidate) {
    recs.push({
      label: "Document revalidates on every request",
      description: "The document uses max-age=0, must-revalidate — the browser cannot cache it between navigations. Consider adding stale-while-revalidate for faster perceived navigation.",
      severity: "info",
    });
  } else if (doc.cdnStatus === "hit") {
    recs.push({
      label: "Document served from CDN",
      description: "The HTML document is cached at the CDN edge, reducing origin load and improving latency.",
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
        description: "Less than half of own resources use immutable long-term caching. Consider max-age=31536000, immutable for versioned assets.",
        severity: "warning",
      });
    }

    if (own.cdnHitRatio >= 0.8) {
      recs.push({
        label: "CDN cache effective for static assets",
        description: `${Math.round(own.cdnHitRatio * 100)}% of own resources served from CDN cache.`,
        severity: "good",
      });
    } else if (own.cdnHits > 0 && own.cdnHitRatio < 0.5) {
      recs.push({
        label: "Low CDN hit rate for static assets",
        description: `Only ${Math.round(own.cdnHitRatio * 100)}% of own resources hit the CDN cache. Check Cache-Control headers and CDN configuration.`,
        severity: "warning",
      });
    }
  }

  // Browser cache
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
        description: "No resources were served from the browser cache. This may be a first visit or cache was disabled during recording.",
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

  const ownNonDoc = har.entries.filter(
    (e) => !e.isDocument && getRootDomain(e.url) === documentRoot,
  );

  const cdnHits = ownNonDoc.filter(
    (e) => detectCdnCacheStatus(e.responseHeaders) === "hit",
  ).length;

  const immutableCount = ownNonDoc.filter((e) =>
    (e.responseHeaders["cache-control"] ?? "").includes("immutable"),
  ).length;

  const ownTotal = ownNonDoc.length;

  const allNonDoc = har.entries.filter((e) => !e.isDocument);
  const fromDisk = allNonDoc.filter((e) => e.fromCache === "disk").length;
  const fromMemory = allNonDoc.filter((e) => e.fromCache === "memory").length;
  const browserTotal = allNonDoc.length;

  const ownResources: CacheReport["ownResources"] = {
    total: ownTotal,
    cdnHits,
    cdnHitRatio: ownTotal > 0 ? cdnHits / ownTotal : 0,
    immutableCount,
    immutableRatio: ownTotal > 0 ? immutableCount / ownTotal : 0,
  };

  const browser: CacheReport["browser"] = {
    total: browserTotal,
    fromDisk,
    fromMemory,
    hitRatio: browserTotal > 0 ? (fromDisk + fromMemory) / browserTotal : 0,
  };

  return {
    document: documentProfile,
    ownResources,
    browser,
    recommendations: buildRecommendations(documentProfile, ownResources, browser),
  };
}
