import type { CSSProperties } from "react";
import { formatBytes, formatMs, shortUrl } from "@htv/core";
import type {
  HarEntry,
  ParsedHar,
  RequestSequence as Sequence,
  SequenceStep,
  SequenceStepKind,
  WaterfallPhases,
} from "@htv/core";
import { useMessages } from "../i18n/context.js";
import styles from "./RequestSequence.module.css";

type Actor = "browser" | "resolver" | "server";

// Who each step goes between (a dot on one lane for a wait), and the waterfall phase whose
// color it takes.
const SHAPES: Record<
  SequenceStepKind,
  { from: Actor; to?: Actor; both?: true; phase: keyof WaterfallPhases }
> = {
  queue: { from: "browser", phase: "blocked" },
  dns: { from: "browser", to: "resolver", both: true, phase: "dns" },
  tcp: { from: "browser", to: "server", both: true, phase: "connect" },
  tls: { from: "browser", to: "server", both: true, phase: "ssl" },
  quic: { from: "browser", to: "server", both: true, phase: "connect" },
  request: { from: "browser", to: "server", phase: "send" },
  wait: { from: "server", phase: "wait" },
  response: { from: "server", to: "browser", phase: "receive" },
};

// A phase under a millisecond still took time: it says so instead of "0 ms".
const stepMs = (ms: number) => (ms > 0 && Math.round(ms) === 0 ? "<1 ms" : formatMs(ms));

type Messages = ReturnType<typeof useMessages>["waterfall"]["detail"]["sequence"];

/** What the connection was, in a sentence; null when the recording does not say. */
function connectionNote(sequence: Sequence, har: ParsedHar, s: Messages): string | null {
  const { connection } = sequence;
  if (connection.kind === "new") return s.connection.new(connection.requests - 1);
  if (connection.kind !== "reused") return null;
  const opener = connection.openedBy === null ? undefined : har.entries[connection.openedBy];
  const reused = opener
    ? s.connection.reusedFrom(shortUrl(opener.url))
    : connection.id !== null
      ? s.connection.reusedBefore
      : s.connection.reused;
  return connection.requests > 1 ? `${reused} ${s.connection.shared(connection.requests)}` : reused;
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function labelOf(step: SequenceStep, sequence: Sequence, entry: HarEntry, s: Messages): string {
  if (step.kind === "request") return `${entry.method ?? "GET"} ${pathOf(entry.url)}`;
  if (step.kind === "response") {
    const { status, transferSize, encoding } = sequence.response;
    return [
      String(status),
      formatBytes(transferSize),
      ...(encoding && encoding !== "none" ? [encoding] : []),
    ].join(" · ");
  }
  return s.label[step.kind];
}

function explainOf(step: SequenceStep, sequence: Sequence, s: Messages): string {
  if (step.kind === "dns") return s.explain.dns(sequence.host);
  if (step.kind === "wait") {
    const { roundTripMs, serverMs } = sequence;
    return s.explain.wait(
      roundTripMs === null ? null : formatMs(roundTripMs),
      serverMs === null ? null : formatMs(serverMs)
    );
  }
  return s.explain[step.kind];
}

/**
 * One request as a sequence between the browser, the DNS resolver and the server: each step
 * with when it starts, how long it took and what happens in it, drawn as an arrow between the
 * lanes. The HAR gives phases, not packets: a handshake is one step with its whole time.
 */
export function RequestSequence({
  sequence,
  entry,
  har,
}: {
  sequence: Sequence;
  entry: HarEntry;
  har: ParsedHar;
}) {
  const s = useMessages().waterfall.detail.sequence;
  const { outcome, steps, host, roundTripMs } = sequence;
  const actors: Actor[] = steps.some((step) => step.kind === "dns")
    ? ["browser", "resolver", "server"]
    : ["browser", "server"];
  // Where each lane runs, in % from the left edge of the drawing to its right edge.
  const at = (actor: Actor) => (actors.indexOf(actor) / (actors.length - 1)) * 100;
  const names: Record<Actor, string> = { browser: s.browser, resolver: s.resolver, server: host };
  const notes = [
    ...(outcome === "browserCache" ? [s.outcome.browserCache] : []),
    ...(outcome === "revalidated" ? [s.outcome.revalidated] : []),
    ...(outcome === "redirect" && sequence.redirectTo
      ? [s.outcome.redirect(sequence.redirectTo)]
      : []),
    connectionNote(sequence, har, s),
    roundTripMs === null ? null : s.roundTrip(formatMs(roundTripMs), host),
  ].filter((note): note is string => note !== null);

  return (
    <>
      {notes.map((note) => (
        <p key={note} className={styles.note}>
          {note}
        </p>
      ))}
      {steps.length > 0 && (
        <>
          <div className={styles.head} aria-hidden="true">
            <span className={styles.lanes}>
              {actors.map((actor) => (
                <span key={actor} className={styles.actor}>
                  {names[actor]}
                </span>
              ))}
            </span>
          </div>
          <ol className={styles.steps} aria-label={s.steps}>
            {steps.map((step) => {
              const shape = SHAPES[step.kind];
              const from = at(shape.from);
              const to = shape.to ? at(shape.to) : from;
              const style = {
                "--color": `var(--phase-${shape.phase})`,
                "--left": `${Math.min(from, to)}%`,
                "--right": `${Math.max(from, to)}%`,
              } as CSSProperties;
              const kind = !shape.to
                ? styles.dot
                : shape.both
                  ? styles.both
                  : shape.from === "server"
                    ? styles.left
                    : styles.right;
              return (
                <li key={step.kind} className={styles.step}>
                  <span className={styles.at}>{formatMs(step.atMs)}</span>
                  <span className={styles.drawing} aria-hidden="true">
                    {actors.map((actor) => (
                      <span
                        key={actor}
                        className={styles.lane}
                        style={{ "--x": `${at(actor)}%` } as CSSProperties}
                      />
                    ))}
                    <span className={`${styles.mark} ${kind}`} style={style} />
                  </span>
                  <span className={styles.what}>
                    <span className={styles.label}>{labelOf(step, sequence, entry, s)}</span>{" "}
                    <span className={styles.ms}>{stepMs(step.ms)}</span>{" "}
                    <span className={styles.explain}>{explainOf(step, sequence, s)}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </>
  );
}
