/**
 * The rules that say what is a secret in a header or a URL, and how it is masked: one set,
 * shared by the parser (which masks the header lists it keeps) and the redaction of a HAR or a
 * flow (redact.ts), which adds bodies, cookie lists and hostnames.
 */

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

export const PLACEHOLDER = "[redacted]";
const EMAIL_PLACEHOLDER = "[email]";

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
// A raw header line, as WebPageTest lists them and flows keep them: "Cookie: a=1".
const HEADER_LINE = /^([!#$%&'*+.^_`|~0-9A-Za-z-]+):(\s*)(.*)$/s;

const isPlaceholder = (value: string) =>
  value === EMAIL_PLACEHOLDER || /^\[redacted(?:-\d+)?\]$/.test(value);

/**
 * Whether a header line's value went through a mask of these rules: every Cookie and Set-Cookie
 * (their values are masked, their names kept), and any value with a placeholder in it.
 */
export function isMaskedHeader(name: string, value: string): boolean {
  const lower = name.toLowerCase();
  if ((lower === "cookie" || lower === "set-cookie") && value.includes("=")) return true;
  return /\[redacted(?:-\d+)?\]|\[email\]/.test(value);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}

export type Context = "text" | "headers";

/**
 * Masks the secrets of header values and text, counting what it replaced in `report`. A
 * sensitive query value takes a numbered placeholder, the same number for the same value, unless
 * `numbered` is false.
 */
export class SecretRules {
  readonly report = emptyReport();
  private readonly placeholders = new Map<string, string>();

  constructor(private readonly numbered = true) {}

  /** Hostnames are kept here; the redaction of a report masks third-party ones. */
  protected hosts(value: string): string {
    return value;
  }

  headerValue(name: string, value: string): string {
    const lower = name.toLowerCase();
    if (lower === "cookie" || lower === "set-cookie") return this.cookieHeader(lower, value);
    if (SENSITIVE_HEADER.test(lower) && !lower.startsWith("access-control-")) {
      if (value === "" || value === PLACEHOLDER) return value;
      this.report.headers++;
      return PLACEHOLDER;
    }
    return this.text(value, "headers");
  }

  headerLine(line: string): string {
    const [, name, gap, value] = HEADER_LINE.exec(line) ?? [];
    if (name === undefined || gap === undefined || value === undefined) {
      return this.text(line, "headers");
    }
    return `${name}:${gap}${this.headerValue(name, value)}`;
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
  cookieValue(value: string): string {
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

  emails(value: string): string {
    return value.replace(EMAIL, (match, tld: string) => {
      if (FILE_EXTENSIONS.has(tld.toLowerCase())) return match;
      this.report.emails++;
      return EMAIL_PLACEHOLDER;
    });
  }

  // A query value: a numbered placeholder when sensitive, the same number for the same value,
  // so requests that differed only by it still differ and equal URLs stay equal.
  param(name: string, value: string): string {
    if (value === "" || isPlaceholder(value)) return this.hosts(value);
    const decoded = safeDecode(value);
    if (!isSensitiveParam(name, decoded)) return this.hosts(value);
    this.report.queryParams++;
    if (!this.numbered) return PLACEHOLDER;
    let placeholder = this.placeholders.get(decoded);
    if (placeholder === undefined) {
      placeholder = `[redacted-${this.placeholders.size + 1}]`;
      this.placeholders.set(decoded, placeholder);
    }
    return placeholder;
  }
}

interface Header {
  name: string;
  value: string;
}

/**
 * A HAR's headers in their order, repeated ones included, each value masked by the rules above.
 * Masked values say so: `[redacted]`, or a cookie's name with as many `*` as its value had
 * characters.
 */
export function maskHeaders(headers: readonly Header[]): Header[] {
  // Unnumbered: a report redacted later numbers its own placeholders, which these must not match.
  const rules = new SecretRules(false);
  return headers.map(({ name, value }) => ({ name, value: rules.headerValue(name, value) }));
}

/** A header as a line of HeaderLists: `Name: value`. */
export const headerLine = ({ name, value }: Header): string => `${name}: ${value}`;

/**
 * The name and value of each line of HeaderLists. A pseudo-header (`:authority`) keeps its
 * leading colon in its name.
 */
export function headerPairs(lines: readonly string[]): Header[] {
  return lines.map((line) => {
    const colon = line.indexOf(":", 1);
    if (colon === -1) return { name: line, value: "" };
    return { name: line.slice(0, colon), value: line.slice(colon + 1).replace(/^ /, "") };
  });
}
