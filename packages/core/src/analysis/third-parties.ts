import { renderBlockingUrls } from "./critical-path.js";
import { medianTtfbByLoad } from "./host-ttfb.js";
import { isBrowserCacheHit, networkRequests } from "./network-requests.js";
import { identifyThirdParty, THIRD_PARTY_CATEGORY_LABEL } from "./third-party-entities.js";
import { getHostname, getRootDomain } from "../utils/domain.js";
import { formatBytes } from "../utils/format.js";
import type {
  HarEntry,
  ParsedHar,
  ParsedTrace,
  Recommendation,
  RecommendationResource,
  ThirdPartyCost,
  ThirdPartyEntity,
  ThirdPartyReport,
  ThirdPartyTotals,
} from "../types.js";

// Third parties this big a share of the page's bytes are its main weight; past the second
// threshold the page is mostly third parties.
const DOMINANT_BYTE_SHARE = 0.4;
const CRITICAL_BYTE_SHARE = 0.6;
// Below this, a high share says little: a repeat view serves the page from the cache and a
// few hundred third-party bytes would "dominate" what little reached the network.
const MIN_DOMINANT_BYTES = 100_000;
// Below both, third parties are a light load.
const LIGHT_BYTE_SHARE = 0.1;
const LIGHT_REQUEST_SHARE = 0.2;
// Third-party requests before onLoad worth a note, and worth a warning.
const BEFORE_LOAD_NOTE_REQUESTS = 3;
const BEFORE_LOAD_WARNING_REQUESTS = 10;
const BEFORE_LOAD_WARNING_BYTES = 300_000;
// A consent manager this heavy is a warning even when it does not hold the first paint.
const CONSENT_WARNING_BYTES = 100_000;

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;
const pct = (share: number) => `${Math.round(share * 100)}%`;
const NO_COST: ThirdPartyCost = { requests: 0, bytes: 0 };

function cost(entries: HarEntry[]): ThirdPartyCost {
  return {
    requests: entries.length,
    bytes: entries.reduce((sum, e) => sum + e.transferSize, 0),
  };
}

// Hostnames by request count, busiest first (first request on a tie).
function hostsByRequests(entries: HarEntry[]): string[] {
  const counts = new Map<string, number>();
  for (const e of entries) {
    const host = getHostname(e.url) ?? e.url;
    counts.set(host, (counts.get(host) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).map(([host]) => host);
}

function describeEntity(
  identity: ReturnType<typeof identifyThirdParty>,
  entries: HarEntry[],
  onLoad: number | null,
  blocking: Set<string>
): ThirdPartyEntity {
  const network = entries.filter((e) => !isBrowserCacheHit(e));
  const afterLoad = (e: HarEntry) => onLoad !== null && e.startTime > onLoad;
  return {
    ...identity,
    hosts: hostsByRequests(entries),
    ...cost(network),
    cacheHits: entries.length - network.length,
    beforeLoad: cost(network.filter((e) => !afterLoad(e))),
    afterLoad: cost(network.filter(afterLoad)),
    renderBlocking: network.filter((e) => blocking.has(e.url)).length,
    medianTtfbMs: medianTtfbByLoad(network, onLoad).beforeLoad,
  };
}

const byWeight = (a: ThirdPartyEntity, b: ThirdPartyEntity) =>
  b.bytes - a.bytes || b.requests - a.requests;

function sumCosts(costs: ThirdPartyCost[]): ThirdPartyCost {
  return costs.reduce(
    (sum, c) => ({ requests: sum.requests + c.requests, bytes: sum.bytes + c.bytes }),
    NO_COST
  );
}

function totalsOf(entities: ThirdPartyEntity[]): ThirdPartyTotals {
  return {
    ...sumCosts(entities),
    entities: entities.length,
    cacheHits: entities.reduce((sum, e) => sum + e.cacheHits, 0),
    beforeLoad: sumCosts(entities.map((e) => e.beforeLoad)),
    afterLoad: sumCosts(entities.map((e) => e.afterLoad)),
    renderBlocking: entities.reduce((sum, e) => sum + e.renderBlocking, 0),
  };
}

// ── Recommendations ──────────────────────────────────────────────────────────

/** An entity as a recommendation resource: its busiest host's origin and its bytes. */
function entityResource(entity: ThirdPartyEntity, detail = ""): RecommendationResource {
  const category = THIRD_PARTY_CATEGORY_LABEL[entity.category].toLowerCase();
  return {
    url: `https://${entity.hosts[0]}/`,
    transferSize: entity.bytes,
    detail: [entity.name, category, plural(entity.requests, "request"), detail]
      .filter(Boolean)
      .join(" · "),
  };
}

function noThirdParties(): Recommendation {
  return {
    label: "No third-party requests",
    description:
      "Every request of the page went to its own domain: no connection to another server, no script and no tracker outside the page's control weighs on it.",
    severity: "good",
  };
}

function weightRecommendation(report: Omit<ThirdPartyReport, "recommendations">) {
  const { totals, page, entities } = report;
  if (report.byteShare < DOMINANT_BYTE_SHARE || totals.bytes < MIN_DOMINANT_BYTES) return null;
  return {
    label: "Third parties dominate the page weight",
    description: `Third parties account for ${pct(report.byteShare)} of the bytes the page downloaded (${formatBytes(totals.bytes)} of ${formatBytes(page.bytes)}), over ${plural(totals.requests, "request")} to ${plural(entities.length, "service")}. Each one is a connection to another server, a script the page has to run and a dependency outside its control: load the ones that matter once the page is usable, drop the ones nobody reads, and self-host what the page's own CDN could serve.`,
    severity: report.byteShare >= CRITICAL_BYTE_SHARE ? "critical" : "warning",
    resources: entities.map((e) => entityResource(e)),
  } satisfies Recommendation;
}

function beforeLoadRecommendation(report: Omit<ThirdPartyReport, "recommendations">) {
  const { beforeLoad } = report.totals;
  if (beforeLoad.requests < BEFORE_LOAD_NOTE_REQUESTS) return null;
  const warning =
    beforeLoad.requests >= BEFORE_LOAD_WARNING_REQUESTS ||
    beforeLoad.bytes >= BEFORE_LOAD_WARNING_BYTES;
  const early = report.entities.filter((e) => e.beforeLoad.requests > 0);
  return {
    label: "Third-party requests before the load event",
    description: `${plural(beforeLoad.requests, "third-party request")} (${formatBytes(beforeLoad.bytes)}) ran before onLoad: the browser spent connections, bandwidth and main-thread time on them while it was still loading the page. Load analytics, ads and widgets after the load event, or once the visitor consents, and keep before it only what the first paint needs.`,
    severity: warning ? "warning" : "info",
    resources: early.map((e) =>
      entityResource(e, `${plural(e.beforeLoad.requests, "request")} before onLoad`)
    ),
  } satisfies Recommendation;
}

function consentRecommendation(report: Omit<ThirdPartyReport, "recommendations">) {
  const cmp = report.entities.find((e) => e.category === "consent");
  if (!cmp) return null;
  const held = cmp.renderBlocking > 0;
  const before =
    cmp.afterLoad.requests > 0
      ? `, ${plural(cmp.beforeLoad.requests, "request")} before onLoad`
      : "";
  const blocking = held
    ? `, and ${plural(cmp.renderBlocking, "request")} held the first paint`
    : "";
  return {
    label: "Consent manager on the page",
    description: `${cmp.name} loaded ${plural(cmp.requests, "request")} (${formatBytes(cmp.bytes)})${before}${blocking}. A consent manager is the first third party on every visit from the EU, and the visitor's answer decides which other third parties load: load it async from a preconnected host so it never holds the first paint, and record the page before and after accepting (htv before.har --compare-with after.har) to see what consent adds.`,
    severity: held || cmp.bytes >= CONSENT_WARNING_BYTES ? "warning" : "info",
    resources: [entityResource(cmp, held ? "held the first paint" : "")],
  } satisfies Recommendation;
}

function lightRecommendation(report: Omit<ThirdPartyReport, "recommendations">) {
  const { totals, entities } = report;
  const light =
    report.byteShare < LIGHT_BYTE_SHARE &&
    report.requestShare < LIGHT_REQUEST_SHARE &&
    totals.renderBlocking === 0;
  if (!light) return null;
  return {
    label: "Third parties are light",
    description: `${plural(entities.length, "third party", "third parties")} took ${pct(report.byteShare)} of the bytes and ${pct(report.requestShare)} of the requests, and none held the first paint.`,
    severity: "good",
  } satisfies Recommendation;
}

/**
 * The third parties of a page by entity (the known service, else the registrable domain):
 * their requests, bytes and browser-cache hits, how much of it ran before the load event, the
 * requests that held the first paint and their share of the whole page, plus the consent
 * manager it loads, with a recommendation for each finding.
 */
export function analyzeThirdParties(
  har: ParsedHar,
  trace: ParsedTrace | undefined
): ThirdPartyReport {
  const documentRoot = getRootDomain(har.documentEntry.url);
  const documentChain = new Set<HarEntry>([har.documentEntry, ...(har.documentRedirects ?? [])]);
  const thirdParty = har.entries.filter(
    (e) => !documentChain.has(e) && getRootDomain(e.url) !== documentRoot
  );
  const onLoad = har.pages[0]?.onLoad ?? null;
  const blocking = thirdParty.length === 0 ? new Set<string>() : renderBlockingUrls(har, trace);

  const groups = new Map<
    string,
    { identity: ReturnType<typeof identifyThirdParty>; entries: HarEntry[] }
  >();
  for (const entry of thirdParty) {
    const identity = identifyThirdParty(entry.url);
    const key = `${identity.category}:${identity.name}`;
    const group = groups.get(key) ?? { identity, entries: [] };
    group.entries.push(entry);
    groups.set(key, group);
  }
  const entities = [...groups.values()]
    .map(({ identity, entries }) => describeEntity(identity, entries, onLoad, blocking))
    .sort(byWeight);

  const totals = totalsOf(entities);
  const page = cost(networkRequests(har));
  const share = (part: number, whole: number) => (whole === 0 ? 0 : part / whole);
  const partial = {
    entities,
    totals,
    page,
    byteShare: share(totals.bytes, page.bytes),
    requestShare: share(totals.requests, page.requests),
    consentManager: entities.find((e) => e.category === "consent")?.name ?? null,
  };

  if (thirdParty.length === 0) return { ...partial, recommendations: [noThirdParties()] };
  const findings = [
    weightRecommendation(partial),
    beforeLoadRecommendation(partial),
    consentRecommendation(partial),
  ].filter((rec): rec is NonNullable<typeof rec> => rec !== null);
  const good = findings.length === 0 ? lightRecommendation(partial) : null;
  return { ...partial, recommendations: good ? [good] : findings };
}
