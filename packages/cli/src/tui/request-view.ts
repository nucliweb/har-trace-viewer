import { formatBytes, formatMs } from "@htv/core";
import type { HarEntry, WaterfallPhases, WaterfallRow } from "@htv/core";
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
function facts(row: WaterfallRow): Line[] {
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
    kv("Content", formatBytes(row.bodySize)),
    kv("Encoding", row.contentEncoding ?? NONE),
    kv("Start", formatMs(row.startMs)),
    kv("Duration", formatMs(row.endMs - row.startMs)),
    kv("LCP resource", yesNo(row.isLcpResource), row.isLcpResource ? { bold: true } : {}),
    kv("Render blocking", yesNo(row.renderBlocking), row.renderBlocking ? { bold: true } : {}),
  ];
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
  return pairs.flatMap(([label, value]) => {
    if (!value) return [];
    const [first, ...rest] = breakText(value, Math.max(1, width - LABEL));
    return [kv(label, first), ...rest.map((part) => [seg(" ".repeat(LABEL)), seg(part)])];
  });
}

function entryFacts(entry: HarEntry): [string, string | null | undefined][] {
  const initiator = entry.initiator
    ? [entry.initiator.type, entry.initiator.url].filter(Boolean).join(" · ")
    : null;
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
    entry.bypassesCache ? "bypasses the cache" : null,
  ].filter(Boolean);
  return [
    ["Initiator", initiator],
    ["Connection", entry.connectionId],
    ["Server-Timing", serverTiming],
    ["Notes", flags.length > 0 ? flags.join(", ") : null],
  ];
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
    return [
      head,
      seg(formatMs(ms).padStart(PHASE_MS)),
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

function headerLines(headers: Record<string, string>, width: number): Line[] {
  const names = Object.keys(headers).sort();
  const lines: Line[] = names.flatMap((name) =>
    breakText(`${name}: ${headers[name]}`, width).map((part, i): Line =>
      i === 0 && part.startsWith(`${name}:`)
        ? [seg(`${name}:`, { bold: true }), seg(part.slice(name.length + 1))]
        : [seg(part)]
    )
  );
  if (names.length === 0) lines.push([seg("No response header kept", { dim: true })]);
  return [
    ...lines,
    BLANK,
    ...wrap(
      "The report keeps an allow-list of response headers (caching, content, protocol, server and CDN) and no request headers.",
      width
    ).map((l) => l.map((s) => ({ ...s, dim: true }))),
  ];
}

/**
 * One request in full: its whole URL, what the report knows about it (method, status, type,
 * priority, protocol, host, party, cache, sizes, encoding, start, duration, whether it is the
 * LCP resource or render-blocking), its timing phases each with a bar in the waterfall's
 * characters, and the response headers the report keeps. `position` is its place in the list.
 */
export function requestRegion(
  row: WaterfallRow,
  entry: HarEntry | undefined,
  position: { index: number; count: number },
  width: number
): Line[] {
  const inner = width - 4;
  const url = breakText(row.url, inner).map((part): Line => [seg(part, { bold: true })]);
  const redirect = row.redirectURL
    ? breakText(`→ ${row.redirectURL}`, inner).map((part): Line => [seg(part, { dim: true })])
    : [];
  const all = facts(row);
  let grid: Line[] = all;
  if (inner >= TWO_COLUMNS) {
    const half = Math.ceil(all.length / 2);
    const left = Math.floor((inner - 2) / 2);
    grid = hstack(
      [
        { lines: all.slice(0, half), width: left },
        { lines: all.slice(half), width: inner - left - 2 },
      ],
      2
    );
  }
  const headers = entry?.responseHeaders ?? {};
  return [
    ...panel(
      `Request ${position.index + 1} of ${position.count}`,
      [...url, ...redirect, BLANK, ...grid, ...longFacts(row, entry, inner)],
      width
    ),
    ...panel("Timing", [...cacheNote(row), ...phaseLines(row, inner)], width),
    ...panel(
      `Response headers · ${Object.keys(headers).length}`,
      headerLines(headers, inner),
      width
    ),
  ];
}
