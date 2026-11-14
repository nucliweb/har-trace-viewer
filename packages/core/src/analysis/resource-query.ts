import type {
  ContentEncoding,
  HttpVersion,
  ResourcePriority,
  ResourceType,
  WaterfallParty,
  WaterfallRow,
} from "../types.js";

/**
 * A resource query, after DevTools' network filter: terms separated by spaces, all of which
 * a request must match. A bare word matches the URL; `field:value` narrows by a field; a
 * leading `-` negates a term; double quotes keep spaces in a value. An unknown field reads as
 * text, a value the field cannot read matches nothing and is reported in `problems`.
 */
export interface ResourceQuery {
  terms: ResourceQueryTerm[];
  problems: string[];
}

export type NumericField = "size" | "body" | "time" | "ttfb" | "start";
export type ComparisonOp = ">" | ">=" | "<" | "<=" | "=";
export type RequestFlag = "cached" | "blocking" | "lcp" | "redirect" | "error" | "document";

export type ResourceQueryTerm = TermBody & { negate: boolean };

type TermBody =
  | { kind: "text"; value: string }
  | { kind: "host"; pattern: RegExp }
  | { kind: "status"; min: number; max: number }
  | { kind: "type"; value: ResourceType }
  | { kind: "mime"; value: string }
  | { kind: "method"; value: string }
  | { kind: "number"; field: NumericField; op: ComparisonOp; value: number }
  | { kind: "priority"; value: ResourcePriority }
  | { kind: "protocol"; value: HttpVersion }
  | { kind: "encoding"; value: ContentEncoding }
  | { kind: "party"; value: WaterfallParty }
  | { kind: "is"; flag: RequestFlag }
  | { kind: "none" };

/** One field of the query language, for a help screen. */
export interface ResourceQueryHelp {
  field: string;
  values: string;
  example: string;
}

export const RESOURCE_QUERY_HELP: readonly ResourceQueryHelp[] = [
  { field: "text", values: "part of the URL (quote it to keep spaces)", example: "hero.avif" },
  { field: "domain", values: "a host, its subdomains, or a * pattern", example: "domain:cdn.*" },
  { field: "status", values: "a code, a class or a range", example: "status:4xx" },
  { field: "type", values: "document css js font image fetch other", example: "type:js" },
  { field: "mime", values: "part of the MIME type", example: "mime:image/" },
  { field: "method", values: "GET POST …", example: "method:post" },
  { field: "larger-than", values: "bytes, k or M (smaller-than too)", example: "larger-than:100k" },
  { field: "slower-than", values: "ms or s (faster-than too)", example: "slower-than:500ms" },
  {
    field: "size body time ttfb start",
    values: "> >= < <= = and a value",
    example: "ttfb:>300ms",
  },
  { field: "priority", values: "highest high medium low lowest", example: "priority:highest" },
  { field: "protocol", values: "h1 h2 h3", example: "protocol:h1" },
  { field: "encoding", values: "br gzip zstd deflate identity none", example: "encoding:none" },
  { field: "party", values: "first third", example: "party:third" },
  {
    field: "is",
    values: "cached blocking lcp redirect error document",
    example: "is:blocking",
  },
  { field: "-", values: "before a term, keeps what does not match", example: "-is:cached" },
];

const TYPE_ALIASES: Record<string, ResourceType> = {
  document: "document",
  doc: "document",
  html: "document",
  stylesheet: "stylesheet",
  css: "stylesheet",
  script: "script",
  js: "script",
  font: "font",
  image: "image",
  img: "image",
  fetch: "fetch",
  xhr: "fetch",
  other: "other",
};

const PRIORITY_ALIASES: Record<string, ResourcePriority> = {
  veryhigh: "VeryHigh",
  "very-high": "VeryHigh",
  highest: "VeryHigh",
  high: "High",
  medium: "Medium",
  low: "Low",
  verylow: "VeryLow",
  "very-low": "VeryLow",
  lowest: "VeryLow",
};

const PROTOCOL_ALIASES: Record<string, HttpVersion> = {
  h1: "h1",
  "http/1": "h1",
  "http/1.0": "h1",
  "http/1.1": "h1",
  h2: "h2",
  "http/2": "h2",
  "http/2.0": "h2",
  h3: "h3",
  "http/3": "h3",
  quic: "h3",
  unknown: "unknown",
};

const ENCODINGS = new Set<ContentEncoding>(["br", "gzip", "zstd", "deflate", "identity", "none"]);

const PARTY_ALIASES: Record<string, WaterfallParty> = {
  first: "first",
  "first-party": "first",
  "1p": "first",
  third: "third",
  "third-party": "third",
  "3p": "third",
};

const FLAG_ALIASES: Record<string, RequestFlag> = {
  cached: "cached",
  "from-cache": "cached",
  blocking: "blocking",
  "render-blocking": "blocking",
  lcp: "lcp",
  redirect: "redirect",
  error: "error",
  failed: "error",
  document: "document",
};

const SIZE_UNITS: Record<string, number> = { "": 1, b: 1, k: 1e3, kb: 1e3, m: 1e6, mb: 1e6 };
const TIME_UNITS: Record<string, number> = { "": 1, ms: 1, s: 1e3 };

interface Problem {
  problem: string;
}
type Parsed<T> = T | Problem;
const isProblem = <T>(value: Parsed<T>): value is Problem =>
  typeof value === "object" && value !== null && "problem" in value;

function parseQuantity(text: string, units: Record<string, number>): number | null {
  const [, amount, unit] = /^(\d+(?:\.\d+)?)\s*([a-z]*)$/i.exec(text.trim()) ?? [];
  if (amount === undefined || unit === undefined) return null;
  const scale = units[unit.toLowerCase()];
  return scale === undefined ? null : Number(amount) * scale;
}

const parseSize = (text: string): Parsed<number> =>
  parseQuantity(text, SIZE_UNITS) ?? {
    problem: `expected a size such as 100k or 2M, got "${text}"`,
  };
const parseTime = (text: string): Parsed<number> =>
  parseQuantity(text, TIME_UNITS) ?? {
    problem: `expected a time such as 500ms or 1.5s, got "${text}"`,
  };

/** `>=300`, `<1.5s`, `=0` or a bare value, which compares as equal. */
function parseComparison(
  text: string,
  units: Record<string, number>
): Parsed<{ op: ComparisonOp; value: number }> {
  const [, operator, amount] = /^(>=|<=|>|<|=)?\s*(.+)$/.exec(text.trim()) ?? [];
  const op = (operator ?? "=") as ComparisonOp;
  const value = amount === undefined ? null : parseQuantity(amount, units);
  if (value === null)
    return { problem: `expected an operator and a value such as >100k, got "${text}"` };
  return { op, value };
}

function parseStatus(text: string): Parsed<{ min: number; max: number }> {
  const value = text.trim().toLowerCase();
  const cls = /^([1-5])xx$/.exec(value);
  if (cls) return { min: Number(cls[1]) * 100, max: Number(cls[1]) * 100 + 99 };
  const range = /^(\d{3})-(\d{3})$/.exec(value);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  const compared = /^(>=|<=|>|<|=)?(\d{3})$/.exec(value);
  if (compared) {
    const code = Number(compared[2]);
    switch (compared[1] ?? "=") {
      case ">":
        return { min: code + 1, max: 999 };
      case ">=":
        return { min: code, max: 999 };
      case "<":
        return { min: 0, max: code - 1 };
      case "<=":
        return { min: 0, max: code };
      default:
        return { min: code, max: code };
    }
  }
  return { problem: `expected a code, a class such as 4xx or a range, got "${text}"` };
}

/** A host pattern: `*` matches any run of characters; without one, the host or a subdomain. */
function hostPattern(text: string): RegExp {
  const value = text.trim().toLowerCase();
  const escaped = value.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return value.includes("*") ? new RegExp(`^${escaped}$`) : new RegExp(`(^|\\.)${escaped}$`);
}

const lookup = <T>(table: Record<string, T>, text: string, what: string): Parsed<T> => {
  const value = table[text.trim().toLowerCase()];
  return value === undefined ? { problem: `unknown ${what} "${text}"` } : value;
};

const NUMERIC_FIELDS: Record<string, { field: NumericField; units: Record<string, number> }> = {
  size: { field: "size", units: SIZE_UNITS },
  body: { field: "body", units: SIZE_UNITS },
  time: { field: "time", units: TIME_UNITS },
  duration: { field: "time", units: TIME_UNITS },
  ttfb: { field: "ttfb", units: TIME_UNITS },
  start: { field: "start", units: TIME_UNITS },
};

/** The term of one `field:value`, or null when the field is not one of the language. */
function fieldTerm(field: string, value: string): Parsed<TermBody> | null {
  const numeric = NUMERIC_FIELDS[field];
  if (numeric) {
    const parsed = parseComparison(value, numeric.units);
    return isProblem(parsed) ? parsed : { kind: "number", field: numeric.field, ...parsed };
  }
  const map = <T>(parsed: Parsed<T>, make: (v: T) => TermBody): Parsed<TermBody> =>
    isProblem(parsed) ? parsed : make(parsed);
  switch (field) {
    case "domain":
    case "host":
      return { kind: "host", pattern: hostPattern(value) };
    case "status":
    case "status-code":
    case "code":
      return map(parseStatus(value), (range) => ({ kind: "status", ...range }));
    case "type":
      return map(lookup(TYPE_ALIASES, value, "type"), (v) => ({ kind: "type", value: v }));
    case "mime":
    case "mime-type":
      return { kind: "mime", value: value.trim().toLowerCase() };
    case "method":
      return { kind: "method", value: value.trim().toUpperCase() };
    case "larger-than":
      return map(parseSize(value), (v) => ({ kind: "number", field: "size", op: ">", value: v }));
    case "smaller-than":
      return map(parseSize(value), (v) => ({ kind: "number", field: "size", op: "<", value: v }));
    case "slower-than":
      return map(parseTime(value), (v) => ({ kind: "number", field: "time", op: ">", value: v }));
    case "faster-than":
      return map(parseTime(value), (v) => ({ kind: "number", field: "time", op: "<", value: v }));
    case "priority":
      return map(lookup(PRIORITY_ALIASES, value, "priority"), (v) => ({
        kind: "priority",
        value: v,
      }));
    case "protocol":
      return map(lookup(PROTOCOL_ALIASES, value, "protocol"), (v) => ({
        kind: "protocol",
        value: v,
      }));
    case "encoding": {
      const encoding = value.trim().toLowerCase() as ContentEncoding;
      return ENCODINGS.has(encoding)
        ? { kind: "encoding", value: encoding }
        : { problem: `unknown encoding "${value}"` };
    }
    case "party":
      return map(lookup(PARTY_ALIASES, value, "party"), (v) => ({ kind: "party", value: v }));
    case "is":
      return map(lookup(FLAG_ALIASES, value, "flag"), (v) => ({ kind: "is", flag: v }));
    default:
      return null;
  }
}

interface Token {
  negate: boolean;
  field: string | null;
  value: string;
  raw: string;
}

/** Splits the text on spaces, keeping a double-quoted value together. */
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const re = /(-?)(?:([a-z][a-z-]*):)?(?:"([^"]*)"?|(\S+))/gi;
  for (const match of text.matchAll(re)) {
    const [raw, dash, field, quoted, bare] = match;
    const value = quoted ?? bare ?? "";
    if (!field && !value) continue;
    tokens.push({ negate: dash === "-", field: field?.toLowerCase() ?? null, value, raw });
  }
  return tokens;
}

/** Parses a resource query; see ResourceQuery for the language. */
export function parseResourceQuery(text: string): ResourceQuery {
  const terms: ResourceQueryTerm[] = [];
  const problems: string[] = [];
  for (const token of tokenize(text)) {
    const parsed = token.field === null ? null : fieldTerm(token.field, token.value);
    if (parsed === null) {
      // Not a field of the language: the whole token is URL text, dash aside.
      const value = token.raw
        .slice(token.negate ? 1 : 0)
        .replace(/^"|"$/g, "")
        .toLowerCase();
      if (value) terms.push({ kind: "text", value, negate: token.negate });
    } else if (isProblem(parsed)) {
      problems.push(`${token.field}: ${parsed.problem}`);
      terms.push({ kind: "none", negate: token.negate });
    } else {
      terms.push({ ...parsed, negate: token.negate });
    }
  }
  return { terms, problems };
}

const compare = (op: ComparisonOp, actual: number, expected: number): boolean => {
  switch (op) {
    case ">":
      return actual > expected;
    case ">=":
      return actual >= expected;
    case "<":
      return actual < expected;
    case "<=":
      return actual <= expected;
    default:
      return actual === expected;
  }
};

const numberOf = (row: WaterfallRow, field: NumericField): number => {
  switch (field) {
    case "size":
      return row.transferSize;
    case "body":
      return row.bodySize;
    case "time":
      return row.endMs - row.startMs;
    case "ttfb":
      return row.ttfbMs;
    default:
      return row.startMs;
  }
};

const hasFlag = (row: WaterfallRow, flag: RequestFlag): boolean => {
  switch (flag) {
    case "cached":
      return row.fromCache !== false;
    case "blocking":
      return row.renderBlocking === true;
    case "lcp":
      return row.isLcpResource === true;
    case "redirect":
      return row.status >= 300 && row.status < 400;
    case "error":
      return row.status >= 400;
    default:
      return row.resourceType === "document";
  }
};

function matchesTerm(row: WaterfallRow, term: ResourceQueryTerm): boolean {
  switch (term.kind) {
    case "text":
      return (
        row.url.toLowerCase().includes(term.value) ||
        row.shortName.toLowerCase().includes(term.value)
      );
    case "host":
      return term.pattern.test(row.host.toLowerCase());
    case "status":
      return row.status >= term.min && row.status <= term.max;
    case "type":
      return row.resourceType === term.value;
    case "mime":
      return row.mimeType.toLowerCase().includes(term.value);
    case "method":
      return (row.method ?? "GET").toUpperCase() === term.value;
    case "number":
      return compare(term.op, numberOf(row, term.field), term.value);
    case "priority":
      return row.priority === term.value;
    case "protocol":
      return row.httpVersion === term.value;
    case "encoding":
      return row.contentEncoding === term.value;
    case "party":
      return row.party === term.value;
    case "is":
      return hasFlag(row, term.flag);
    default:
      return false;
  }
}

/** Whether the row matches every term of the query; every row matches an empty one. */
export function matchesResourceQuery(row: WaterfallRow, query: ResourceQuery): boolean {
  return query.terms.every((term) => matchesTerm(row, term) !== term.negate);
}
