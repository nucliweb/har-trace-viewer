import { detectCdnCacheStatus } from "../inference/cache-analyzer.js";
import { detectCdnPopCity, detectNode } from "../inference/node-detector.js";
import { getRootDomain } from "../utils/domain.js";
import { clusterThirdParties } from "./third-party-clusters.js";
import type {
  CdnCacheStatus,
  HarEntry,
  HarPage,
  NodeDetectionResult,
  PageFlow,
  ParsedHar,
  ParsedTrace,
  ThirdPartyCluster,
} from "../types.js";

/**
 * What a page's document and entries say about its network topology, computed once per page
 * and shared by its steps and its analysis.
 */
export interface PageContext {
  har: ParsedHar;
  trace?: ParsedTrace;
  // The client sits behind the Great Firewall (--region cn).
  hasGfw: boolean;
  document: HarEntry;
  // The page the load belongs to: its onLoad and onContentLoad.
  page: HarPage;
  cdnResult: NodeDetectionResult;
  hasCdn: boolean;
  // The city of the PoP that served the document, when a CDN serves it and the headers say.
  popCity: string | null;
  documentRoot: string;
  // Entries of the document's registrable domain, the document included.
  ownEntries: HarEntry[];
  // Entries of other domains. Third-party iframes are HTML documents too; only the main
  // document is not a resource.
  thirdPartyEntries: HarEntry[];
  // Third-party network requests grouped by CDN provider and region.
  thirdPartyClusters: ThirdPartyCluster[];
  // Every entry but the main document that the browser cache served.
  cacheEntries: HarEntry[];
  // The CDN cache status of an entry of the page, read from its headers once.
  cdnStatus: (entry: HarEntry) => CdnCacheStatus;
}

function isThirdParty(entry: HarEntry, documentRoot: string): boolean {
  return getRootDomain(entry.url) !== documentRoot;
}

export function describePage(pageFlow: PageFlow, hasGfw: boolean): PageContext {
  const { har, trace } = pageFlow;
  const document = har.documentEntry;
  const page = har.pages[0];
  const cdnResult = detectNode(document.responseHeaders);
  const hasCdn = cdnResult.type === "edge";
  const documentRoot = getRootDomain(document.url);
  const thirdPartyEntries = har.entries.filter(
    (e) => e !== document && isThirdParty(e, documentRoot)
  );
  const statuses = new Map<HarEntry, CdnCacheStatus>();
  const cdnStatus = (entry: HarEntry): CdnCacheStatus => {
    let status = statuses.get(entry);
    if (status === undefined) {
      status = detectCdnCacheStatus(entry.responseHeaders);
      statuses.set(entry, status);
    }
    return status;
  };
  return {
    har,
    trace,
    hasGfw,
    document,
    page,
    cdnResult,
    hasCdn,
    popCity: hasCdn
      ? detectCdnPopCity(document.responseHeaders, cdnResult.cdnProvider, hasGfw)
      : null,
    documentRoot,
    ownEntries: har.entries.filter((e) => !isThirdParty(e, documentRoot)),
    thirdPartyEntries,
    thirdPartyClusters: clusterThirdParties(
      thirdPartyEntries.filter((e) => e.fromCache === false),
      page?.onLoad ?? null
    ),
    cacheEntries: har.entries.filter((e) => e !== document && e.fromCache !== false),
    cdnStatus,
  };
}

// Whether requests sent through the CDN went on to the origin: only a CDN cache hit stops at
// the edge (a miss, a stale or bypassed response, or no cache status at all reaches it).
// Without a CDN every request reaches the origin.
export function reachesOrigin(ctx: PageContext, requests: HarEntry[]): boolean {
  return !ctx.hasCdn || requests.some((e) => ctx.cdnStatus(e) !== "hit");
}

// Mean duration of the entries, 0 for none.
export function avgMs(entries: HarEntry[]): number {
  if (entries.length === 0) return 0;
  return entries.reduce((s, e) => s + e.duration, 0) / entries.length;
}
