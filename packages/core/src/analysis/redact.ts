import type { Flow } from "../types.js";
import { parseHarPages } from "../parsers/har-parser.js";
import { getHostname, getRootDomain } from "../utils/domain.js";

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

/** How many values each rule replaced. */
export interface RedactionReport {
  /** Cookie values, in cookie lists and in Cookie and Set-Cookie headers. */
  cookies: number;
  /** Values of credential headers (Cookie, Authorization, *token*...) and JWTs in other headers. */
  headers: number;
  /** Query and fragment values, and credentials in URLs. */
  queryParams: number;
  /** Response bodies, request bodies and WebSocket messages. */
  bodies: number;
  /** Distinct hostnames masked. */
  hosts: number;
  /** Email addresses. */
  emails: number;
  /** JWTs outside query strings and headers (in paths, titles, descriptions). */
  tokens: number;
}

const PLACEHOLDER = "[redacted]";
const EMAIL_PLACEHOLDER = "[email]";
const MASKED_HOST_SUFFIX = ".redacted";

const emptyReport = (): RedactionReport => ({
  cookies: 0,
  headers: 0,
  queryParams: 0,
  bodies: 0,
  hosts: 0,
  emails: 0,
  tokens: 0,
});

// ── What is sensitive ─────────────────────────────────────────────────────────

// Credential headers; Cookie and Set-Cookie keep their cookie names (see cookieHeader).
const SENSITIVE_HEADER =
  /^(?:proxy-)?authorization$|^x-auth(?:-|$)|token|secret|session|passw|api-?key|credential/i;

// Query parameter names whose value identifies or authenticates someone.
const SENSITIVE_PARAMS = new Set([
  "token",
  "auth",
  "key",
  "apikey",
  "api_key",
  "api-key",
  "session",
  "sid",
  "password",
  "passwd",
  "pwd",
  "secret",
  "access_token",
  "id_token",
  "code",
  "state",
  "email",
  "user",
  "username",
  "user_id",
  "userid",
  "uid",
  "cid",
  "signature",
  "sig",
  "jwt",
]);
const SENSITIVE_PARAM_PATTERN = /token|secret|passw|session|signature|credential|api[-_]?key|auth/;

// A JWT: base64url header (always `{"` → eyJ), payload and signature (empty for alg "none").
const JWT = /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g;
const HEX_RUN = /[0-9a-f]{32,}/i;
const BASE64_RUN = /[A-Za-z0-9+/_-]{32,}/g;

// A run of base64 long enough to be a secret: mixed case and digits, unlike a slug or a word.
function looksLikeToken(value: string): boolean {
  if (new RegExp(JWT.source).test(value) || HEX_RUN.test(value)) return true;
  return (value.match(BASE64_RUN) ?? []).some(
    (run) => /[a-z]/.test(run) && /[A-Z]/.test(run) && /\d/.test(run)
  );
}

function isSensitiveParam(name: string, decodedValue: string): boolean {
  const key = safeDecode(name.slice(name.lastIndexOf(";") + 1)).toLowerCase();
  return (
    SENSITIVE_PARAMS.has(key) || SENSITIVE_PARAM_PATTERN.test(key) || looksLikeToken(decodedValue)
  );
}

// File extensions that follow an @ in asset names (logo@2x.png) and are no top-level domain.
const FILE_EXTENSIONS = new Set(
  "png jpg jpeg gif webp avif svg ico bmp js mjs cjs css json html htm xml txt woff woff2 ttf otf eot map mp4 webm mp3 wasm pdf zip gz br php asp aspx jsp".split(
    " "
  )
);
// A raw or percent-encoded (%40) @ between a local part and a domain.
const EMAIL = /[A-Za-z0-9._%+-]+(?:@|%40)(?:[A-Za-z0-9-]+\.)+([A-Za-z]{2,})(?![A-Za-z0-9-])/g;
const URL_CREDENTIALS = /(\b[a-z][a-z0-9+.-]*:\/\/)([^/\s?#@]+)@/gi;
// A query or fragment parameter: name=value after ?, # or &.
const QUERY_PAIR = /([?#&])([^=&#?\s"'<>]+)=([^&#\s"'<>)]*)/g;
// A raw header line, as WebPageTest lists them: "Cookie: a=1".
const HEADER_LINE = /^([!#$%&'*+.^_`|~0-9A-Za-z-]+):(\s*)(.*)$/s;

const SHORTENED_HOST = /…([A-Za-z0-9.-]+)/g;

const isPlaceholder = (value: string) =>
  value === EMAIL_PLACEHOLDER || /^\[redacted(?:-\d+)?\]$/.test(value);

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}

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

type Context = "text" | "headers";

class Redactor {
  readonly report = emptyReport();
  private readonly placeholders = new Map<string, string>();
  private readonly maskedHosts = new Map<string, string>();
  private hostPattern: RegExp | null = null;
  private readonly visited = new WeakSet<object>();

  constructor(private readonly options: RedactOptions) {}

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
      // A header record, as flows keep the response headers: name → value.
      // WebPageTest groups raw header lines instead: { request: ["Cookie: a=1"], response: [...] }.
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
    const renamed = entries.map(([k, v]) => [this.text(k, "text"), v] as const);
    if (renamed.every(([k], i) => k === entries[i][0])) return;
    for (const [k] of entries) Reflect.deleteProperty(node, k);
    for (const [k, v] of renamed) node[k] = v;
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

  private headerValue(name: string, value: string): string {
    const lower = name.toLowerCase();
    if (lower === "cookie" || lower === "set-cookie") return this.cookieHeader(lower, value);
    if (SENSITIVE_HEADER.test(lower) && !lower.startsWith("access-control-")) {
      if (value === "" || value === PLACEHOLDER) return value;
      this.report.headers++;
      return PLACEHOLDER;
    }
    return this.text(value, "headers");
  }

  private headerLine(line: string): string {
    const match = HEADER_LINE.exec(line);
    if (!match) return this.text(line, "headers");
    return `${match[1]}:${match[2]}${this.headerValue(match[1], match[3])}`;
  }

  // Cookie: every name=value pair. Set-Cookie: the first pair of each line; attributes stay.
  private cookieHeader(name: "cookie" | "set-cookie", value: string): string {
    const before = this.report.cookies;
    const pair = name === "cookie" ? /(^|;\s*)([^=;]+=)([^;]*)/g : /^(\s*)([^=;]+=)([^;\n]*)/gm;
    const result = value.replace(
      pair,
      (_, separator: string, prefix: string, cookie: string) =>
        `${separator}${prefix}${this.cookieValue(cookie)}`
    );
    if (this.report.cookies > before) this.report.headers++;
    return result;
  }

  // As many characters as the value had: the cookie sizes the analysis reports stay the same.
  private cookieValue(value: string): string {
    if (value === "" || /^(?:\[redacted\])?\**$/.test(value)) return value;
    this.report.cookies++;
    return value.length >= PLACEHOLDER.length
      ? PLACEHOLDER + "*".repeat(value.length - PLACEHOLDER.length)
      : "*".repeat(value.length);
  }

  /** Redacts URLs and text: credentials, emails, query values, JWTs and masked hosts. */
  text(value: string, context: Context): string {
    let result = value.replace(URL_CREDENTIALS, (match, scheme: string, credentials: string) => {
      if (credentials === PLACEHOLDER) return match;
      this.report.queryParams++;
      return `${scheme}${PLACEHOLDER}@`;
    });
    result = this.emails(result);
    result = result.replace(
      QUERY_PAIR,
      (_, separator: string, name: string, paramValue: string) =>
        `${separator}${name}=${this.param(name, paramValue)}`
    );
    result = result.replace(JWT, () => {
      if (context === "headers") this.report.headers++;
      else this.report.tokens++;
      return PLACEHOLDER;
    });
    return this.hosts(result);
  }

  private emails(value: string): string {
    return value.replace(EMAIL, (match, tld: string) => {
      if (FILE_EXTENSIONS.has(tld.toLowerCase())) return match;
      this.report.emails++;
      return EMAIL_PLACEHOLDER;
    });
  }

  // A query value: a numbered placeholder when sensitive, the same number for the same value,
  // so requests that differed only by it still differ and equal URLs stay equal.
  private param(name: string, value: string): string {
    if (value === "" || isPlaceholder(value)) return this.hosts(value);
    const decoded = safeDecode(value);
    if (!isSensitiveParam(name, decoded)) return this.hosts(value);
    let placeholder = this.placeholders.get(decoded);
    if (placeholder === undefined) {
      placeholder = `[redacted-${this.placeholders.size + 1}]`;
      this.placeholders.set(decoded, placeholder);
    }
    this.report.queryParams++;
    return placeholder;
  }

  private hosts(value: string): string {
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
  log?: { entries?: { request?: { url?: unknown } }[] };
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
  const urls = ((har as RawHarShape).log?.entries ?? [])
    .map((e) => e.request?.url)
    .filter((url): url is string => typeof url === "string");
  if (options.hosts === "mask") redactor.planHosts(urls, documentUrls(har, urls));
  redactor.value(har, "", "text");
  return { har, report: redactor.report };
}

// ── Flow ──────────────────────────────────────────────────────────────────────

/**
 * Redacts flows already generated, for reports to share: the URL, query, email and JWT rules
 * over every string (entries, redirects, initiators, evidence, titles, step descriptions, page
 * names) and, with `hosts: "mask"`, third-party hostnames. The flows share placeholders and
 * masked hosts, so the two sides of a comparison still match.
 */
export function redactFlows(
  flows: Flow[],
  options: RedactOptions = {}
): { flows: Flow[]; report: RedactionReport } {
  const copies = structuredClone(flows);
  const redactor = new Redactor(options);
  if (options.hosts === "mask") {
    const pages = copies.flatMap((flow) => flow.pages);
    const urls = pages.flatMap((page) => [
      ...page.har.entries.map((e) => e.url),
      ...(page.trace?.requests ?? []).map((r) => r.url),
    ]);
    redactor.planHosts(
      urls,
      pages.map((page) => page.har.documentEntry.url)
    );
  }
  for (const flow of copies) redactor.value(flow, "", "text");
  return { flows: copies, report: redactor.report };
}

/** Redacts one flow; see redactFlows. */
export function redactFlow(
  flow: Flow,
  options: RedactOptions = {}
): { flow: Flow; report: RedactionReport } {
  const { flows, report } = redactFlows([flow], options);
  return { flow: flows[0], report };
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** The counts of a redaction in one line: "5 cookie values, 12 query values, 2 hosts masked". */
export function describeRedaction(report: RedactionReport): string {
  const parts = [
    report.cookies && plural(report.cookies, "cookie value", "cookie values"),
    report.headers && plural(report.headers, "header value", "header values"),
    report.queryParams && plural(report.queryParams, "query value", "query values"),
    report.bodies && plural(report.bodies, "body", "bodies"),
    report.emails && plural(report.emails, "email", "emails"),
    report.tokens && plural(report.tokens, "token", "tokens"),
    report.hosts && plural(report.hosts, "host masked", "hosts masked"),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "nothing to redact";
}
