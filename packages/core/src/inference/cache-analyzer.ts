import { WPT_REPEAT_VIEW_ID } from "../parsers/har-parser.js";
import { getRootDomain } from "../utils/domain.js";
import { isOwnNetworkResource, isOwnResource } from "../analysis/network-requests.js";
import { formatMs } from "../utils/format.js";
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

interface CdnCacheEvidence {
  status: CdnCacheStatus;
  header: string | null; // the header that decided the status, as "name: value"
}

// Header precedence: the platform-specific status headers first (x-vercel-cache,
// cf-cache-status, cdn-cache), then the standard Cache-Status, then the x-cache
// family. x-cache-remote reports the parent tier, so it is the last resort.
function detectCdnCacheEvidence(headers: Record<string, string>): CdnCacheEvidence {
  const found = (status: CdnCacheStatus, name: string) => ({
    status,
    header: `${name}: ${headers[name]}`,
  });

  for (const name of ["x-vercel-cache", "cf-cache-status", "cdn-cache"]) {
    const status = SIMPLE_STATUS[headers[name]?.trim().toLowerCase() ?? ""];
    if (status) return found(status, name);
  }

  const cacheStatus = headers["cache-status"];
  if (cacheStatus) {
    const status = parseCacheStatus(cacheStatus);
    if (status !== "unknown") return found(status, "cache-status");
  }

  for (const name of ["x-cache", "x-cache-status", "x-cache-remote"]) {
    const value = headers[name];
    if (value) {
      const status = parseXCache(value);
      if (status !== "unknown") return found(status, name);
    }
  }

  return { status: "unknown", header: null };
}

export function detectCdnCacheStatus(headers: Record<string, string>): CdnCacheStatus {
  return detectCdnCacheEvidence(headers).status;
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

const STATIC_EXTENSION = /\.(?:m?js|css|woff2?|ttf|otf|png|jpe?g|gif|webp|avif|svg)$/i;

// Query parameters that version a URL: lib.js?v=1.2.3, theme.css?ver=6.4.2, app.js?hash=9f8e7d6c.
const VERSION_PARAMS = ["v", "ver", "hash"];

// Runs of letters and digits that look like a hash but name something else.
const NOT_A_HASH = [
  /^\d+x\d+$/i, // dimensions: hero-1920x1080.jpg
  /^[a-z]*20\d{6}(?:t?\d{2,6})?$/i, // dates and builds: widget-v20240115.js, build-20260101.js
  /^v?\d+$/i, // version and build numbers: v12345678
  /^[a-z]{3,}\d{1,4}$/i, // a word and a number: fontawesome5, polyfills2020
];

// A content hash: a hex or base36 run of 8+ characters mixing letters and digits.
function isHashToken(token: string): boolean {
  return (
    /^[a-z0-9]{8,}$/i.test(token) &&
    /\d/.test(token) &&
    /[a-z]/i.test(token) &&
    !NOT_A_HASH.some((pattern) => pattern.test(token))
  );
}

// Vite and Rollup hashes are 8 base64url characters, mixed case, and may carry an "_".
function isBase64UrlHash(token: string): boolean {
  return (
    /^[A-Za-z0-9_]{8,12}$/.test(token) &&
    /\d/.test(token) &&
    /[a-z]/.test(token) &&
    /[A-Z]/.test(token)
  );
}

// A static asset whose URL changes with its content: a content hash in the file name
// (main.3f2a9c1b.js, chunk-47TTPNLV.js, index-BkD3x9_a.js, logo_a1b2c3d4e5.png) or a
// version query parameter. The hash is a run delimited by ".", "-" or "_", so versions
// (jquery-3.6.1.min.js), words (nuance-c2c-button.css), dimensions (hero-1920x1080.jpg)
// and dates (widget-v20240115.js) do not count.
function isVersionedAsset(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const name = parsed.pathname.slice(parsed.pathname.lastIndexOf("/") + 1);
  if (!STATIC_EXTENSION.test(name)) return false;
  if (VERSION_PARAMS.some((param) => parsed.searchParams.get(param))) return true;
  return name
    .replace(STATIC_EXTENSION, "")
    .split(/[.-]/)
    .some((segment) => isBase64UrlHash(segment) || segment.split("_").some(isHashToken));
}

// How Cache-Control lets the browser reuse a response: never (no-store), only after asking
// the server whether it changed (no-cache, max-age=0), or freely while it is fresh.
type Reuse = "never" | "after-revalidation" | "while-fresh";

function reuseOf(cacheControl: string): Reuse {
  if (/\bno-store\b/i.test(cacheControl)) return "never";
  if (/\bno-cache\b|\bmax-age=0\b/i.test(cacheControl)) return "after-revalidation";
  return "while-fresh";
}

interface VersionedAssetFindings {
  notCached: RecommendationResource[]; // no-store: downloaded again on every visit
  revalidating: RecommendationResource[]; // no-cache or max-age=0: a round trip before each use
  revalidatingWithoutValidators: number; // of those, the ones without ETag or Last-Modified
}

/** Versioned assets fetched over the network that the browser may not reuse freely, biggest first. */
function versionedAssetFindings(entries: HarEntry[]): VersionedAssetFindings {
  const fetched = entries.filter(
    (e) =>
      !e.isDocument &&
      e.fromCache === false &&
      (e.status === 200 || e.status === 304) &&
      isVersionedAsset(e.url)
  );
  const withReuse = (reuse: Reuse) =>
    fetched.filter((e) => reuseOf(e.responseHeaders["cache-control"] ?? "") === reuse);
  const asResources = (list: HarEntry[]): RecommendationResource[] =>
    list
      .map((e) => ({
        url: e.url,
        transferSize: e.transferSize,
        cacheControl: e.responseHeaders["cache-control"] ?? "",
      }))
      .sort((a, b) => b.transferSize - a.transferSize);

  const revalidating = withReuse("after-revalidation");
  return {
    notCached: asResources(withReuse("never")),
    revalidating: asResources(revalidating),
    revalidatingWithoutValidators: revalidating.filter(
      (e) => !e.responseHeaders["etag"] && !e.responseHeaders["last-modified"]
    ).length,
  };
}

// The words that agree with a count of assets: "1 versioned asset is", "2 versioned assets are".
function agreement(count: number) {
  const one = count === 1;
  return {
    assets: `${count} versioned ${one ? "asset is" : "assets are"}`,
    has: one ? "has" : "have",
    it: one ? "it" : "them",
    its: one ? "Its" : "Their",
    they: one ? "it" : "they",
  };
}

function versionedAssetRecommendations(findings: VersionedAssetFindings): CacheRecommendation[] {
  const recs: CacheRecommendation[] = [];
  const { notCached, revalidating, revalidatingWithoutValidators: unvalidated } = findings;
  if (notCached.length > 0) {
    const w = agreement(notCached.length);
    recs.push({
      label: "Versioned assets are not cached",
      description: `${w.assets} served with no-store, so the browser downloads ${w.it} again on every visit. ${w.its} URL changes whenever ${w.its.toLowerCase()} content does: serve ${w.it} with public, max-age=31536000, immutable.`,
      severity: "critical",
      resources: notCached,
    });
  }
  if (revalidating.length > 0) {
    const w = agreement(revalidating.length);
    const u = agreement(unvalidated);
    const withoutValidators =
      unvalidated > 0
        ? ` ${unvalidated} of them ${u.has} no ETag or Last-Modified, so the browser cannot revalidate ${u.it} and downloads ${u.it} again.`
        : "";
    recs.push({
      label: "Versioned assets revalidate on every use",
      description: `${w.assets} served with no-cache or max-age=0: the browser asks the server whether ${w.they} changed before each use, a round trip that ends in a 304 when ${w.they} did not.${withoutValidators} ${w.its} URL changes whenever ${w.its.toLowerCase()} content does: serve ${w.it} with public, max-age=31536000, immutable to skip the check.`,
      severity: "warning",
      resources: revalidating,
    });
  }
  return recs;
}

// "5.4 d", "3 h", "12 min", "40 s".
function formatAge(seconds: number): string {
  const units: [number, string][] = [
    [86400, "d"],
    [3600, "h"],
    [60, "min"],
  ];
  for (const [size, unit] of units) {
    if (seconds >= size) {
      const value = seconds / size;
      return `${value < 10 ? Number(value.toFixed(1)) : Math.round(value)} ${unit}`;
    }
  }
  return `${seconds} s`;
}

// What shows that the CDN served the document from its cache: the status header that says
// so, else an Age the CDN added. Null when nothing does.
function cdnHitEvidence(entry: HarEntry, doc: ResourceCacheProfile): string | null {
  const { status, header } = detectCdnCacheEvidence(entry.responseHeaders);
  const age = doc.age ?? 0;
  if (status !== "hit" && !(status === "unknown" && age > 0)) return null;
  return [header, age > 0 ? `Age ${formatAge(age)}` : null, `TTFB ${formatMs(entry.ttfb)}`]
    .filter(Boolean)
    .join(", ");
}

// Signs that the document was built for the user who asked for it.
function personalizationSignals(entry: HarEntry): string[] {
  const signals: string[] = [];
  if (entry.setsCookie) signals.push("sets a cookie");
  if (/\bcookie\b/i.test(entry.responseHeaders["vary"] ?? "")) signals.push("varies on Cookie");
  if (entry.sendsAuthorization) signals.push("was requested with an Authorization header");
  return signals;
}

function documentRecommendation(
  entry: HarEntry,
  doc: ResourceCacheProfile
): CacheRecommendation | null {
  const isPrivate = /\bprivate\b/i.test(entry.responseHeaders["cache-control"] ?? "");
  const signals = personalizationSignals(entry);

  // no-store and private are right for a personalized page: shared caches must not keep it.
  if ((doc.noStore || isPrivate) && signals.length > 0) {
    return {
      label: "Personalized document not cached",
      description: `The document ${signals.join(", ")}, so it looks personalized: ${doc.noStore ? "no-store" : "private"} is right, it keeps shared caches from serving it to other users. Cache its static assets instead.`,
      severity: "info",
    };
  }
  if (doc.noStore) {
    return {
      label: "Document not cached",
      description:
        "The document uses no-store and shows no sign of being personalized (no Set-Cookie, Vary: Cookie or Authorization). If it is the same for every visitor, let the CDN cache it and keep the browser copy short-lived, e.g. Cache-Control: public, max-age=60, s-maxage=3600, stale-while-revalidate=86400. HAR exports can strip cookies: keep no-store if the page is personalized.",
      severity: "warning",
    };
  }
  if (doc.cdnStatus === "miss") {
    return {
      label: "CDN miss on document",
      description:
        "The HTML document was not served from CDN cache. Ensure the CDN is configured to cache HTML responses.",
      severity: "warning",
    };
  }
  if (doc.cdnStatus === "bypass") {
    return {
      label: "CDN bypassed for document",
      description:
        "The CDN is bypassing the cache for the HTML document. Review Vary headers and CDN cache rules.",
      severity: "warning",
    };
  }
  const revalidates = doc.maxAge === 0 && doc.mustRevalidate;
  const evidence = cdnHitEvidence(entry, doc);
  if (evidence) {
    return {
      label: "Document served from CDN",
      description: `The HTML document came from the CDN cache (${evidence}), so it skipped the trip to the origin.${revalidates ? " Its max-age=0, must-revalidate makes the browser check it on every navigation, and the CDN answers that check from its cache." : ""}`,
      severity: "good",
    };
  }
  if (revalidates) {
    return {
      label: "Document revalidates on every request",
      description:
        "The document uses max-age=0, must-revalidate — the browser cannot cache it between navigations. Consider adding stale-while-revalidate for faster perceived navigation.",
      severity: "info",
    };
  }
  return null;
}

function buildRecommendations(
  documentEntry: HarEntry,
  doc: ResourceCacheProfile,
  own: CacheReport["ownResources"],
  browser: CacheReport["browser"],
  versionedAssets: VersionedAssetFindings,
  repeatView: boolean
): CacheRecommendation[] {
  const recs: CacheRecommendation[] = [];

  // Document-level
  const documentRec = documentRecommendation(documentEntry, doc);
  if (documentRec) recs.push(documentRec);

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

  recs.push(...versionedAssetRecommendations(versionedAssets));

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
      // A first view has nothing to reuse: only a repeat view without hits says something.
      if (repeatView) {
        recs.push({
          label: "No browser cache hits",
          description:
            "The page was loaded again with the browser cache in place, yet no resource came from it. Give static assets a freshness lifetime (max-age) so that repeat visits reuse them.",
          severity: "warning",
        });
      }
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

// A repeat view: a WebPageTest repeat view, or a load that found resources in the browser
// cache (hits, or cached copies it had to revalidate).
function isRepeatView(har: ParsedHar, browser: CacheReport["browser"]): boolean {
  return (
    har.inferredCacheHits !== undefined ||
    har.pages.some((page) => WPT_REPEAT_VIEW_ID.test(page.id)) ||
    browser.fromDisk + browser.fromMemory + (browser.revalidated ?? 0) > 0
  );
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
      doc,
      documentProfile,
      ownResources,
      browser,
      versionedAssetFindings(har.entries),
      isRepeatView(har, browser)
    ),
  };
}
