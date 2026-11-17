import { formatBytes, formatMs, requestDetail } from "@htv/core";
import type {
  HarEntry,
  HeaderField,
  ParsedHar,
  RequestDetail,
  WaterfallPhases,
  WaterfallRow,
} from "@htv/core";
import { BLANK, breakText, hstack, panel, seg, wrap } from "./lines.js";
import type { Line } from "./lines.js";
import { BLOCKED, CONNECT, RECEIVE, WAIT } from "./waterfall-view.js";

const NONE = "—";
const LABEL = 16;
// Room for two columns of facts side by side.
const TWO_COLUMNS = 72;

const PHASES: {
  key: keyof WaterfallPhases;
  label: string;
  style: { char: string; color: string };
}[] = [
  { key: "blocked", label: "Blocked", style: BLOCKED },
  { key: "dns", label: "DNS", style: CONNECT },
  { key: "connect", label: "Connect", style: CONNECT },
  { key: "ssl", label: "TLS", style: CONNECT },
  { key: "send", label: "Send", style: WAIT },
  { key: "wait", label: "Wait (TTFB)", style: WAIT },
  { key: "receive", label: "Receive", style: RECEIVE },
];
const PHASE_LABEL = 12;
const PHASE_MS = 7;
const MIN_BAR = 10;
// Said after a masked header value; a word, so that it reads without colour.
const MASKED = "masked";
// The type column of the initiator chain.
const LINK_TYPE = 10;

const CACHE: Record<Exclude<HarEntry["fromCache"], false>, string> = {
  disk: "disk cache",
  memory: "memory cache",
  unknown: "browser cache",
};

const yesNo = (value: boolean | undefined) => (value ? "yes" : "no");

const kv = (label: string, value: string, style: Omit<Line[number], "text"> = {}): Line => [
  seg(label.padEnd(LABEL), { dim: true }),
  seg(value, style),
];

/** The short facts of a request, which can share a line two by two. */
function facts(row: WaterfallRow, sizes: RequestDetail["sizes"]): Line[] {
  const statusColor = row.status >= 400 ? "red" : row.status >= 300 ? "yellow" : undefined;
  return [
    kv("Method", row.method ?? NONE),
    kv("Status", row.status > 0 ? String(row.status) : NONE, { color: statusColor }),
    kv("Priority", row.priority ?? NONE),
    kv(
      "Protocol",
      row.httpVersion === null || row.httpVersion === "unknown" ? NONE : row.httpVersion
    ),
    kv("Party", row.party),
    kv("Cache", row.fromCache ? CACHE[row.fromCache] : "network"),
    kv("Transfer", formatBytes(row.transferSize)),
    kv("Compressed", sizes.compressedBody === null ? NONE : formatBytes(sizes.compressedBody)),
    kv("Content", formatBytes(row.bodySize)),
    kv("Encoding", row.contentEncoding ?? NONE),
    kv("Start", formatMs(row.startMs)),
    kv("Duration", formatMs(row.endMs - row.startMs)),
    kv("LCP resource", yesNo(row.isLcpResource), row.isLcpResource ? { bold: true } : {}),
    kv("Render blocking", yesNo(row.renderBlocking), row.renderBlocking ? { bold: true } : {}),
  ];
}

/** Facts two by two when the panel is wide enough, else one per line. */
function grid(all: Line[], inner: number): Line[] {
  if (inner < TWO_COLUMNS) return all;
  const half = Math.ceil(all.length / 2);
  const left = Math.floor((inner - 2) / 2);
  return hstack(
    [
      { lines: all.slice(0, half), width: left },
      { lines: all.slice(half), width: inner - left - 2 },
    ],
    2
  );
}

/** Label and value, the value broken over full lines when it is long. */
function longFact(label: string, value: string, width: number): Line[] {
  const [first, ...rest] = breakText(value, Math.max(1, width - LABEL));
  return [kv(label, first), ...rest.map((part) => [seg(" ".repeat(LABEL)), seg(part)])];
}

/**
 * The facts that can be long, broken over full lines: the type, the host and what the HAR
 * entry has beyond the row.
 */
function longFacts(row: WaterfallRow, entry: HarEntry | undefined, width: number): Line[] {
  const pairs: [string, string | null | undefined][] = [
    ["Type", `${row.resourceType} · ${row.mimeType || NONE}`],
    ["Host", row.host],
    ...(entry ? entryFacts(entry) : []),
  ];
  return pairs.flatMap(([label, value]) => (value ? longFact(label, value, width) : []));
}

function entryFacts(entry: HarEntry): [string, string | null | undefined][] {
  const serverTiming = entry.serverTiming?.length
    ? entry.serverTiming
        .map((m) =>
          [m.name, m.dur === undefined ? null : formatMs(m.dur), m.desc].filter(Boolean).join(" ")
        )
        .join(", ")
    : null;
  const flags = [
    entry.setsCookie ? "sets a cookie" : null,
    entry.sendsAuthorization ? "sends Authorization" : null,
    entry.requestCookieBytes ? `sends ${formatBytes(entry.requestCookieBytes)} of cookies` : null,
    entry.advertisesHttp3 ? "advertises HTTP/3" : null,
  ].filter(Boolean);
  return [
    ["Connection", entry.connectionId],
    ["Server-Timing", serverTiming],
    ["Notes", flags.length > 0 ? flags.join(", ") : null],
  ];
}

/**
 * What requested it, then what requested that, up to the document: one line per link with its
 * type and URL, the line number 1-based as DevTools shows it.
 */
function initiatorLines(initiator: NonNullable<RequestDetail["initiator"]>, width: number): Line[] {
  if (initiator.chain.length === 0) {
    return [[seg("The HAR names no URL for this initiator.", { dim: true })]];
  }
  return initiator.chain.flatMap((link, i) => {
    const at = link.lineNumber === undefined ? link.url : `${link.url}:${link.lineNumber + 1}`;
    const [first, ...rest] = breakText(at, Math.max(1, width - LINK_TYPE - 2));
    const indent = seg(" ".repeat(LINK_TYPE + 2));
    return [
      [seg(`${i === 0 ? "" : "← "}${link.type}`.padEnd(LINK_TYPE + 2), { dim: true }), seg(first)],
      ...rest.map((part): Line => [indent, seg(part)]),
    ];
  });
}

/** One line per phase: its duration and a bar placed where it falls within the request. */
function phaseLines(row: WaterfallRow, width: number): Line[] {
  const bar = Math.max(MIN_BAR, width - PHASE_LABEL - PHASE_MS - 2);
  const total = PHASES.reduce((sum, p) => sum + (row.phases[p.key] ?? 0), 0);
  let elapsed = 0;
  const lines = PHASES.map(({ key, label, style }): Line => {
    const ms = row.phases[key];
    const head = seg(label.padEnd(PHASE_LABEL), { dim: true });
    if (ms === null) return [head, seg("n/a".padStart(PHASE_MS), { dim: true })];
    const from = total > 0 ? Math.round((elapsed / total) * bar) : 0;
    let to = total > 0 ? Math.round(((elapsed + ms) / total) * bar) : 0;
    if (ms > 0 && to === from) to = Math.min(bar, from + 1);
    elapsed += ms;
    // A phase that rounds to 0 ms still draws its cell, so its text says that it is not nothing.
    const shown = ms > 0 && Math.round(ms) === 0 ? "<1 ms" : formatMs(ms);
    return [
      head,
      seg(shown.padStart(PHASE_MS)),
      seg(`  ${" ".repeat(Math.max(0, Math.min(from, bar - 1)))}`),
      seg(style.char.repeat(Math.max(0, to - from)), { color: style.color }),
    ];
  });
  return [
    ...lines,
    [
      seg("Total".padEnd(PHASE_LABEL), { bold: true }),
      seg(formatMs(row.endMs - row.startMs).padStart(PHASE_MS), { bold: true }),
    ],
  ];
}

function cacheNote(row: WaterfallRow): Line[] {
  if (!row.fromCache) return [];
  const text =
    row.fromCache === "unknown"
      ? "Served from the browser cache; the HAR does not say which store."
      : `Served from the browser's ${CACHE[row.fromCache]}.`;
  return [[seg(text, { color: "cyan" })], BLANK];
}

function cacheLines(cache: RequestDetail["cache"], width: number): Line[] {
  return grid(
    [
      kv("Browser", cache.browser ? CACHE[cache.browser] : "network"),
      kv("Revalidated", cache.revalidated ? "yes (304)" : "no"),
      kv("Bypassed", yesNo(cache.bypassed)),
      kv("CDN", cache.cdn),
      kv("Age", cache.age === null ? NONE : `${cache.age} s`),
    ],
    width
  ).concat(cache.cacheControl ? longFact("Cache-Control", cache.cacheControl, width) : []);
}

/** `name: value` per header, wrapped to the panel, a masked value followed by the word. */
function headerFieldLines(fields: HeaderField[], width: number, empty: string): Line[] {
  if (fields.length === 0) return [[seg(empty, { dim: true })]];
  return fields.flatMap(({ name, value, masked }) => {
    const suffix = masked ? `  ${MASKED}` : "";
    const parts = breakText(`${name}: ${value}${suffix}`, width);
    return parts.map((part, i): Line => {
      const head = i === 0 && part.startsWith(`${name}:`) ? name.length + 1 : 0;
      const last = i === parts.length - 1 && masked && part.endsWith(MASKED);
      const body = part.slice(head, last ? part.length - MASKED.length : undefined);
      return [
        ...(head > 0 ? [seg(`${name}:`, { bold: true })] : []),
        seg(body),
        ...(last ? [seg(MASKED, { color: "yellow", dim: true })] : []),
      ];
    });
  });
}

const dimmed = (lines: Line[]): Line[] => lines.map((l) => l.map((s) => ({ ...s, dim: true })));

/** The headers panels: both lists in full, or the allow-list of a report that kept no lists. */
function headerPanels(
  headers: RequestDetail["headers"],
  entry: HarEntry | undefined,
  width: number
): Line[] {
  const inner = width - 4;
  if (headers === null) {
    const kept = entry?.responseHeaders ?? {};
    const fields = Object.keys(kept)
      .sort()
      .map((name) => ({ name, value: kept[name], masked: false }));
    return panel(
      `Response headers · ${fields.length}`,
      [
        ...headerFieldLines(fields, inner, "No response header kept"),
        BLANK,
        ...dimmed(
          wrap(
            "This report keeps an allow-list of response headers (caching, content, protocol, server and CDN) and no request headers.",
            inner
          )
        ),
      ],
      width
    );
  }
  return [
    ...panel(
      `Request headers · ${headers.request.length}`,
      headerFieldLines(headers.request, inner, "No request header recorded"),
      width
    ),
    ...panel(
      `Response headers · ${headers.response.length}`,
      [
        ...headerFieldLines(headers.response, inner, "No response header recorded"),
        BLANK,
        ...dimmed(
          wrap(
            "Masked values hide secrets (cookies, credentials, tokens): the report never holds them.",
            inner
          )
        ),
      ],
      width
    ),
  ];
}

/**
 * One request in full: its whole URL, what the report knows about it (method, status, type,
 * priority, protocol, host, party, cache, sizes, encoding, start, duration, whether it is the
 * LCP resource or render-blocking), what requested it, its timing phases each with a bar in the
 * waterfall's characters, its cache status, and its request and response headers with the
 * values of sensitive ones masked. `position` is its place in the list.
 */
export function requestRegion(
  row: WaterfallRow,
  har: ParsedHar,
  position: { index: number; count: number },
  width: number
): Line[] {
  const inner = width - 4;
  const entry = har.entries[row.entryIndex];
  const detail = entry ? requestDetail(har, entry) : null;
  const url = breakText(row.url, inner).map((part): Line => [seg(part, { bold: true })]);
  const redirect = row.redirectURL
    ? breakText(`→ ${row.redirectURL}`, inner).map((part): Line => [seg(part, { dim: true })])
    : [];
  const sizes = detail?.sizes ?? {
    transfer: row.transferSize,
    compressedBody: null,
    body: row.bodySize,
    encoding: row.contentEncoding,
  };
  return [
    ...panel(
      `Request ${position.index + 1} of ${position.count}`,
      [
        ...url,
        ...redirect,
        BLANK,
        ...grid(facts(row, sizes), inner),
        ...longFacts(row, entry, inner),
      ],
      width
    ),
    ...(detail?.initiator
      ? panel(
          `Initiator · ${detail.initiator.type}`,
          initiatorLines(detail.initiator, inner),
          width
        )
      : []),
    ...panel("Timing", [...cacheNote(row), ...phaseLines(row, inner)], width),
    ...(detail ? panel("Cache", cacheLines(detail.cache, inner), width) : []),
    ...headerPanels(detail?.headers ?? null, entry, width),
  ];
}
