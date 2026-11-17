import type { Flow } from "../types.js";
import { parseHarPages } from "../parsers/har-parser.js";
import { getHostname, getRootDomain } from "../utils/domain.js";
import { pluralCount } from "../utils/format.js";
import { PLACEHOLDER, SecretRules } from "./secret-rules.js";
import type { Context, RedactionReport } from "./secret-rules.js";

export type { RedactionReport } from "./secret-rules.js";

/**
 * Redaction of a HAR, or of a flow already generated from one, before sharing it.
 *
 * Both levels apply the same rules to URLs and text: query and fragment values with a sensitive
 * name or that look like a token, credentials in URLs, emails and JWTs. A raw HAR also loses its
 * bodies, cookie values and credential headers. Optionally, third-party hostnames are masked.
 * Timings, sizes, statuses and the cache and CDN headers stay, so the analysis still works.
 */

export interface RedactOptions {
  /**
   * "mask" replaces hostnames other than the first party (the registrable domain of each page's
   * document) and well-known third parties with `host-N.redacted`, the same host always with
   * the same N. Default: "keep".
   */
  hosts?: "keep" | "mask";
}

const MASKED_HOST_SUFFIX = ".redacted";

const SHORTENED_HOST = /…([A-Za-z0-9.-]+)/g;

// Shared services whose hostnames say nothing about the site that loaded them. Hosts under
// per-customer domains (*.vercel.app, *.cloudfront.net, *.azureedge.net) name their customer
// and are masked.
const WELL_KNOWN_ROOTS = new Set([
  "google.com",
  "googleapis.com",
  "gstatic.com",
  "google-analytics.com",
  "googletagmanager.com",
  "googlesyndication.com",
  "googleadservices.com",
  "doubleclick.net",
  "googlevideo.com",
  "youtube.com",
  "youtube-nocookie.com",
  "ytimg.com",
  "recaptcha.net",
  "facebook.com",
  "facebook.net",
  "fbcdn.net",
  "instagram.com",
  "twitter.com",
  "twimg.com",
  "x.com",
  "linkedin.com",
  "licdn.com",
  "tiktok.com",
  "pinterest.com",
  "bing.com",
  "clarity.ms",
  "microsoft.com",
  "cloudflare.com",
  "cloudflareinsights.com",
  "jsdelivr.net",
  "unpkg.com",
  "bootstrapcdn.com",
  "jquery.com",
  "fontawesome.com",
  "typekit.net",
  "adobedtm.com",
  "cloudinary.com",
  "imgix.net",
  "gravatar.com",
  "wp.com",
  "hotjar.com",
  "segment.com",
  "segment.io",
  "sentry.io",
  "sentry-cdn.com",
  "newrelic.com",
  "nr-data.net",
  "go-mpulse.net",
  "amazon-adsystem.com",
  "criteo.com",
  "criteo.net",
  "stripe.com",
  "paypal.com",
  "vimeo.com",
  "vimeocdn.com",
  "intercom.io",
  "intercomcdn.com",
  "onetrust.com",
  "cookielaw.org",
  "cookiebot.com",
  "hcaptcha.com",
  "optimizely.com",
  "tiqcdn.com",
  "mixpanel.com",
  "amplitude.com",
  "fullstory.com",
  "plausible.io",
  "vercel-insights.com",
  "vercel-scripts.com",
  "debugbear.com",
  "speedcurve.com",
]);

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ── The redactor ──────────────────────────────────────────────────────────────

class Redactor extends SecretRules {
  private readonly maskedHosts = new Map<string, string>();
  private hostPattern: RegExp | null = null;
  private readonly visited = new WeakSet<object>();

  constructor(private readonly options: RedactOptions) {
    super();
  }

  /** Plans which hostnames to mask: every host requested outside the first party. */
  planHosts(urls: string[], firstPartyUrls: string[]): void {
    if (this.options.hosts !== "mask") return;
    const firstParty = new Set(firstPartyUrls.map((url) => getRootDomain(url).toLowerCase()));
    for (const url of urls) {
      const host = getHostname(url)?.toLowerCase();
      if (!host || this.maskedHosts.has(host) || host.endsWith(MASKED_HOST_SUFFIX)) continue;
      const root = getRootDomain(url).toLowerCase();
      if (firstParty.has(root) || WELL_KNOWN_ROOTS.has(root)) continue;
      this.maskedHosts.set(host, `host-${this.maskedHosts.size + 1}${MASKED_HOST_SUFFIX}`);
      this.report.hosts++;
    }
    // A masked host's registrable domain names it too (the third-party report calls an unknown
    // service by its domain): it takes the placeholder of the first host under it.
    for (const [host, masked] of [...this.maskedHosts]) {
      const root = getRootDomain(`https://${host}/`).toLowerCase();
      if (!this.maskedHosts.has(root)) this.maskedHosts.set(root, masked);
    }
    const alternatives = [...this.maskedHosts.keys()]
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp);
    this.hostPattern =
      alternatives.length === 0
        ? null
        : new RegExp(
            // A whole hostname: not inside a longer one, though it may follow %2F or a wildcard "*.".
            `(?:(?<![A-Za-z0-9.-])|(?<=%2[Ff])|(?<=\\*\\.))(?:${alternatives.join("|")})(?![A-Za-z0-9-]|\\.[A-Za-z0-9])`,
            "gi"
          );
  }

  /** Walks any JSON value in place, redacting by the key each value sits under. */
  value(node: unknown, key: string, context: Context): unknown {
    if (typeof node === "string") {
      return context === "headers" ? this.headerLine(node) : this.text(node, "text");
    }
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) node[i] = this.value(node[i], key, context);
      return node;
    }
    if (node !== null && typeof node === "object")
      this.object(node as Record<string, unknown>, key, context);
    return node;
  }

  private object(node: Record<string, unknown>, key: string, context: Context): void {
    if (this.visited.has(node)) return;
    this.visited.add(node);
    const handled = new Set<string>();

    if (typeof node.name === "string" && typeof node.value === "string") {
      if (context === "headers") node.value = this.headerValue(node.name, node.value);
      else if (key === "cookies") node.value = this.cookieValue(node.value);
      else if (key === "queryString" || key === "params") {
        node.value = this.param(node.name, this.emails(node.value));
      } else node.value = this.text(node.value, "text");
      handled.add("name").add("value");
    } else if (context === "headers") {
      // A header record, as flows keep the allow-listed response headers: name → value.
      // WebPageTest and the header lists of flows group raw lines instead:
      // { request: ["Cookie: a=1"], response: [...] }.
      for (const [name, value] of Object.entries(node)) {
        node[name] =
          typeof value === "string"
            ? this.headerValue(name, value)
            : this.value(value, name, context);
      }
      return;
    }

    for (const [childKey, child] of Object.entries(node)) {
      if (handled.has(childKey)) continue;
      if (childKey === "postData" && isRecord(child)) this.postData(child);
      else if (childKey === "content" && isRecord(child)) this.content(child);
      else if (childKey === "_webSocketMessages" && Array.isArray(child)) this.messages(child);
      node[childKey] = this.value(
        child,
        childKey,
        /headers$/i.test(childKey) ? "headers" : context
      );
    }
    if (context === "text") this.renameKeys(node);
  }

  // Keys may hold hostnames or URLs too (the preconnect hints of a flow).
  private renameKeys(node: Record<string, unknown>): void {
    const entries = Object.entries(node);
    const renamed = entries.map(([key, v]) => [key, this.text(key, "text"), v] as const);
    if (renamed.every(([key, newKey]) => key === newKey)) return;
    for (const [key] of renamed) Reflect.deleteProperty(node, key);
    for (const [, newKey, v] of renamed) node[newKey] = v;
  }

  private postData(postData: Record<string, unknown>): void {
    let redacted = false;
    if (
      typeof postData.text === "string" &&
      postData.text !== "" &&
      postData.text !== PLACEHOLDER
    ) {
      postData.text = PLACEHOLDER;
      redacted = true;
    }
    if (Array.isArray(postData.params)) {
      for (const param of postData.params) {
        if (
          isRecord(param) &&
          typeof param.value === "string" &&
          param.value !== "" &&
          param.value !== PLACEHOLDER
        ) {
          param.value = PLACEHOLDER;
          redacted = true;
        }
      }
    }
    if (redacted) this.report.bodies++;
  }

  // The response body goes; its size, which the analysis reads, stays.
  private content(content: Record<string, unknown>): void {
    if (typeof content.text !== "string") return;
    if (content.text !== "") this.report.bodies++;
    delete content.text;
    delete content.encoding;
  }

  private messages(messages: unknown[]): void {
    for (const message of messages) {
      if (isRecord(message) && typeof message.data === "string" && message.data !== PLACEHOLDER) {
        message.data = PLACEHOLDER;
        this.report.bodies++;
      }
    }
  }

  protected override hosts(value: string): string {
    if (!this.hostPattern) return value;
    return value
      .replace(this.hostPattern, (host) => this.maskedHosts.get(host.toLowerCase()) ?? host)
      .replace(SHORTENED_HOST, (match, tail: string) => {
        // Diagram captions shorten long hosts to their end: "…vendor.example.com".
        const lower = tail.toLowerCase();
        for (const [host, masked] of this.maskedHosts) if (host.endsWith(lower)) return masked;
        return match;
      });
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// ── HAR ───────────────────────────────────────────────────────────────────────

interface RawHarShape {
  log?: {
    entries?: {
      request?: { url?: unknown; headers?: unknown };
      response?: { headers?: unknown };
    }[];
  };
}

// The absolute URLs header values name (Referer, Origin, Location, Link...): a host that only a
// header names, such as the site a navigation came from, is masked like a requested one.
const HEADER_URL = /\bhttps?:\/\/[^\s,;"'<>]+/gi;

function urlsInHeaders(headers: unknown): string[] {
  if (!Array.isArray(headers)) return [];
  return headers.flatMap((header: unknown) => {
    const text = isRecord(header) ? header.value : header;
    return typeof text === "string" ? (text.match(HEADER_URL) ?? []) : [];
  });
}

// The documents of the HAR's pages, which make the first party; the first request without one.
function documentUrls(har: unknown, requestUrls: string[]): string[] {
  try {
    return parseHarPages(har as Parameters<typeof parseHarPages>[0]).map(
      (p) => p.documentEntry.url
    );
  } catch {
    return requestUrls.slice(0, 1);
  }
}

/**
 * Redacts a raw HAR (its JSON, as exported) so it can be shared, and returns a copy that is
 * still a valid HAR: bodies dropped (their sizes kept), cookie values masked, credential header
 * values replaced, sensitive query values, URL credentials, emails and JWTs replaced, and with
 * `hosts: "mask"` third-party hostnames masked. Applying it twice changes nothing more.
 */
export function redactHar<T>(
  rawHar: T,
  options: RedactOptions = {}
): { har: T; report: RedactionReport } {
  const har = structuredClone(rawHar);
  const redactor = new Redactor(options);
  const entries = (har as RawHarShape).log?.entries ?? [];
  const urls = entries
    .map((e) => e.request?.url)
    .filter((url): url is string => typeof url === "string");
  if (options.hosts === "mask") {
    const named = entries.flatMap((e) => [
      ...urlsInHeaders(e.request?.headers),
      ...urlsInHeaders(e.response?.headers),
    ]);
    redactor.planHosts([...urls, ...named], documentUrls(har, urls));
  }
  redactor.value(har, "", "text");
  return { har, report: redactor.report };
}

// ── Flow ──────────────────────────────────────────────────────────────────────

/**
 * Redacts flows already generated, for reports to share: the URL, query, email and JWT rules
 * over every string (entries, their header lists, redirects, initiators, evidence, titles, step
 * descriptions, page names) and, with `hosts: "mask"`, third-party hostnames, those that only a
 * header names included. The flows share placeholders and
 * masked hosts, so the two sides of a comparison still match.
 */
export function redactFlows(
  flows: Flow[],
  options: RedactOptions = {}
): { flows: Flow[]; report: RedactionReport } {
  const copies = structuredClone(flows);
  return { flows: copies, report: redactCopies(copies, options) };
}

function redactCopies(copies: Flow[], options: RedactOptions): RedactionReport {
  const redactor = new Redactor(options);
  if (options.hosts === "mask") {
    const pages = copies.flatMap((flow) => flow.pages);
    const urls = pages.flatMap((page) => [
      ...page.har.entries.map((e) => e.url),
      ...(page.trace?.requests ?? []).map((r) => r.url),
    ]);
    const named = pages.flatMap((page) =>
      page.har.entries.flatMap((e) => [
        ...urlsInHeaders(e.headers?.request),
        ...urlsInHeaders(e.headers?.response),
      ])
    );
    redactor.planHosts(
      [...urls, ...named],
      pages.map((page) => page.har.documentEntry.url)
    );
  }
  for (const flow of copies) redactor.value(flow, "", "text");
  return redactor.report;
}

/** Redacts one flow; see redactFlows. */
export function redactFlow(
  flow: Flow,
  options: RedactOptions = {}
): { flow: Flow; report: RedactionReport } {
  const copy = structuredClone(flow);
  return { flow: copy, report: redactCopies([copy], options) };
}

/** The counts of a redaction in one line: "5 cookie values, 12 query values, 2 hosts masked". */
export function describeRedaction(report: RedactionReport): string {
  const parts = [
    report.cookies && pluralCount(report.cookies, "cookie value", "cookie values"),
    report.headers && pluralCount(report.headers, "header value", "header values"),
    report.queryParams && pluralCount(report.queryParams, "query value", "query values"),
    report.bodies && pluralCount(report.bodies, "body", "bodies"),
    report.emails && pluralCount(report.emails, "email", "emails"),
    report.tokens && pluralCount(report.tokens, "token", "tokens"),
    report.hosts && pluralCount(report.hosts, "host masked", "hosts masked"),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "nothing to redact";
}
