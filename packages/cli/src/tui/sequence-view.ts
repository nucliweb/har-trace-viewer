import { formatBytes, formatMs, shortUrl } from "@htv/core";
import type {
  HarEntry,
  ParsedHar,
  RequestSequence,
  SequenceStep,
  SequenceStepKind,
} from "@htv/core";
import { seg, textWidth, wrap } from "./lines.js";
import type { Line, Segment } from "./lines.js";
import { BLOCKED, CONNECT, RECEIVE, WAIT } from "./waterfall-view.js";

type Actor = "browser" | "resolver" | "server";

// Who each step goes between (a dot on one lane for a wait), and the waterfall colour it takes.
const SHAPES: Record<SequenceStepKind, { from: Actor; to?: Actor; both?: true; color: string }> = {
  queue: { from: "browser", color: BLOCKED.color },
  dns: { from: "browser", to: "resolver", both: true, color: CONNECT.color },
  tcp: { from: "browser", to: "server", both: true, color: CONNECT.color },
  tls: { from: "browser", to: "server", both: true, color: CONNECT.color },
  quic: { from: "browser", to: "server", both: true, color: CONNECT.color },
  request: { from: "browser", to: "server", color: WAIT.color },
  wait: { from: "server", color: WAIT.color },
  response: { from: "server", to: "browser", color: RECEIVE.color },
};

const LABEL: Record<Exclude<SequenceStepKind, "request" | "response">, string> = {
  queue: "Queued",
  dns: "DNS lookup",
  tcp: "TCP handshake",
  tls: "TLS handshake",
  quic: "QUIC handshake",
  wait: "Server works",
};

const EXPLAIN: Record<Exclude<SequenceStepKind, "dns" | "wait">, string> = {
  queue:
    "Waits in the browser before it goes out: other requests go first, or no connection is free yet.",
  tcp: "SYN, SYN-ACK, ACK: the connection is ready after one round trip.",
  tls: "Agrees on the encryption keys and checks the server's certificate.",
  quic: "HTTP/3 sets up the connection and the encryption together, in one round trip.",
  request: "The request leaves the browser.",
  response: "The response arrives, from its first byte to its last.",
};

const NO_SETUP = "no DNS lookup or handshakes.";
// The start column, right-aligned: "103 ms".
const AT = 7;
const GAP = 2;

function connectionNote(sequence: RequestSequence, har: ParsedHar): string | null {
  const { connection } = sequence;
  if (connection.kind === "new") {
    const more = connection.requests - 1;
    return more === 0
      ? "Opens a new connection."
      : `Opens a new connection; ${more} more ${more === 1 ? "request reuses" : "requests reuse"} it.`;
  }
  if (connection.kind !== "reused") return null;
  const opener = connection.openedBy === null ? undefined : har.entries[connection.openedBy];
  const reused = opener
    ? `Reuses the connection ${shortUrl(opener.url)} opened: ${NO_SETUP}`
    : connection.id !== null
      ? `Reuses a connection opened before the recording started: ${NO_SETUP}`
      : `Reuses an open connection: ${NO_SETUP}`;
  return connection.requests > 1 ? `${reused} ${connection.requests} requests share it.` : reused;
}

function notesOf(sequence: RequestSequence, har: ParsedHar): string[] {
  const { outcome, roundTripMs, host } = sequence;
  return [
    outcome === "browserCache"
      ? "Served from the browser cache: it never reached the network."
      : null,
    outcome === "revalidated"
      ? "The server answers 304 Not Modified: the browser's copy is still good, so no body comes back."
      : null,
    outcome === "redirect" && sequence.redirectTo
      ? `The server answers with a redirect to ${sequence.redirectTo}: the browser requests it next.`
      : null,
    connectionNote(sequence, har),
    roundTripMs === null ? null : `About ${formatMs(roundTripMs)} per round trip to ${host}.`,
  ].filter((note): note is string => note !== null);
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function labelOf(step: SequenceStep, sequence: RequestSequence, entry: HarEntry): string {
  if (step.kind === "request") return `${entry.method ?? "GET"} ${pathOf(entry.url)}`;
  if (step.kind === "response") {
    const { status, transferSize, encoding } = sequence.response;
    return [
      String(status),
      formatBytes(transferSize),
      ...(encoding && encoding !== "none" ? [encoding] : []),
    ].join(" · ");
  }
  return LABEL[step.kind];
}

function explainOf(step: SequenceStep, sequence: RequestSequence): string {
  if (step.kind === "dns") return `Asks for the IP address of ${sequence.host}.`;
  if (step.kind === "wait") {
    const { roundTripMs, serverMs } = sequence;
    return roundTripMs === null || serverMs === null
      ? "Time to first byte: the trip to the server and back, plus the time the server takes to answer."
      : `Time to first byte: about ${formatMs(roundTripMs)} are the round trip and ${formatMs(serverMs)} the server.`;
  }
  return EXPLAIN[step.kind];
}

// One cell of the drawing: a character, dim for a lane, coloured for the step's mark.
interface Cell {
  char: string;
  color?: string;
  dim?: boolean;
}

/** Merges the cells into segments, one per run of the same style. */
function toSegments(cells: Cell[]): Segment[] {
  const out: Segment[] = [];
  for (const { char, color, dim } of cells) {
    const last = out.at(-1);
    if (last && last.color === color && last.dim === dim) last.text += char;
    else out.push(seg(char, { ...(color && { color }), ...(dim && { dim }) }));
  }
  return out;
}

/** The step's mark across the lanes: ◀═══▶ for a handshake, │───▶ and ◀───│ for one way, ●. */
function drawing(step: SequenceStep, lanes: Record<Actor, number>, width: number): Cell[] {
  const cells: Cell[] = Array.from({ length: width }, () => ({ char: " " }));
  for (const x of Object.values(lanes)) if (x >= 0) cells[x] = { char: "│", dim: true };
  const shape = SHAPES[step.kind];
  const mark = (x: number, char: string) => (cells[x] = { char, color: shape.color });
  const from = lanes[shape.from];
  if (!shape.to) {
    mark(from, "●");
    return cells;
  }
  const to = lanes[shape.to];
  const [left, right] = [Math.min(from, to), Math.max(from, to)];
  for (let x = left + 1; x < right; x++) mark(x, shape.both ? "═" : "─");
  if (shape.both || from > to) mark(left, "◀");
  if (shape.both || from < to) mark(right, "▶");
  return cells;
}

/** The lane names over the drawing, each from its lane, pushed right when the one before is long. */
function header(actors: Actor[], lanes: Record<Actor, number>, names: Record<Actor, string>) {
  let text = "";
  for (const actor of actors) {
    const at = Math.max(lanes[actor], text.length === 0 ? 0 : textWidth(text) + 2);
    text = text.padEnd(at) + names[actor];
  }
  return text;
}

// A phase under a millisecond still took time: it says so instead of "0 ms".
const stepMs = (ms: number) => (ms > 0 && Math.round(ms) === 0 ? "<1 ms" : formatMs(ms));

/**
 * One request as a sequence between the browser, the DNS resolver and the server, for the
 * request view: notes on how it went and its connection, the lane names, then a line per step
 * with when it starts, its mark across the lanes, its name and time, and what happens in it.
 */
export function sequenceLines(
  sequence: RequestSequence,
  entry: HarEntry,
  har: ParsedHar,
  width: number
): Line[] {
  const notes = notesOf(sequence, har).flatMap((note) =>
    wrap(note, width).map((line): Line => line.map((s) => ({ ...s, dim: true })))
  );
  const { steps } = sequence;
  if (steps.length === 0) return notes;

  const actors: Actor[] = steps.some((s) => s.kind === "dns")
    ? ["browser", "resolver", "server"]
    : ["browser", "server"];
  const room = Math.max(12, Math.min(30, Math.floor((width - AT - GAP) * 0.4)));
  const lanes: Record<Actor, number> = { browser: -1, resolver: -1, server: -1 };
  actors.forEach((actor, i) => (lanes[actor] = Math.round((i / (actors.length - 1)) * (room - 1))));
  const names: Record<Actor, string> = {
    browser: "Browser",
    resolver: "DNS resolver",
    server: sequence.host,
  };
  const indent = " ".repeat(AT + GAP);
  const explainIndent = " ".repeat(AT + GAP + room + GAP);
  const explainWidth = width - explainIndent.length;

  return [
    ...notes,
    [seg(indent + header(actors, lanes, names), { dim: true })],
    ...steps.flatMap((step): Line[] => [
      [
        seg(formatMs(step.atMs).padStart(AT), { dim: true }),
        seg(" ".repeat(GAP)),
        ...toSegments(drawing(step, lanes, room)),
        seg(" ".repeat(GAP)),
        seg(labelOf(step, sequence, entry), { bold: true }),
        seg(` ${stepMs(step.ms)}`),
      ],
      ...(explainWidth >= 20
        ? wrap(explainOf(step, sequence), width, explainIndent)
        : wrap(explainOf(step, sequence), width, indent)
      ).map((line): Line => line.map((s) => ({ ...s, dim: true }))),
    ]),
  ];
}
