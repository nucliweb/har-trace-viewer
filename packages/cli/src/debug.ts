// --debug: diagnostics on stderr, which never carries a report or a check result. Everything here
// does nothing until it is enabled, so that the output without the flag stays as it was.

import { closeSync, openSync, readSync, statSync } from "node:fs";

const PREFIX = "debug: ";
const KIND_NAME = { har: "HAR", trace: "Chrome trace" } as const;

const ms = (value: number) => `${Math.round(value)} ms`;

function describeFile(file: string): string {
  let fd: number | undefined;
  try {
    const { size } = statSync(file);
    fd = openSync(file, "r");
    const magic = Buffer.alloc(2);
    readSync(fd, magic, 0, 2, 0);
    const gzip = magic[0] === 0x1f && magic[1] === 0x8b;
    return `${gzip ? "gzip" : "plain JSON"}, ${size} B`;
  } catch {
    return "unreadable";
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** A debug log that writes lines with `write` and measures time with `clock`. */
export function createDebug(
  write: (text: string) => void,
  clock: () => number = () => performance.now()
) {
  let enabled = false;
  let started = 0;
  let phase: { name: string; from: number } | null = null;
  let parsed = 0;
  let ended = false;

  const log = (message: string) => {
    if (enabled) write(`${PREFIX}${message}\n`);
  };

  const closePhase = () => {
    if (!phase) return;
    const elapsed = clock() - phase.from;
    // The files are read and parsed inside the analysis; what is left of it is the generation.
    if (phase.name === "analyze" && parsed > 0) {
      log(`parse total: ${ms(parsed)}`);
      log(`generate: ${ms(Math.max(0, elapsed - parsed))}`);
    }
    log(`${phase.name}: ${ms(elapsed)}`);
    phase = null;
  };

  return {
    get enabled() {
      return enabled;
    },
    enable() {
      enabled = true;
      started = clock();
    },
    log,
    /** Ends the phase in progress, if any, and starts `name`. */
    phase(name: string) {
      if (!enabled) return;
      closePhase();
      phase = { name, from: clock() };
    },
    /** Ends the phase in progress and writes the total; only the first call does. */
    end() {
      if (!enabled || ended) return;
      ended = true;
      closePhase();
      log(`total: ${ms(clock() - started)}`);
    },
    /** Runs `step`, logs how long it took, and counts it in the parse total when `parse`. */
    async time<T>(label: string, step: () => Promise<T>, parse = false): Promise<T> {
      if (!enabled) return step();
      const from = clock();
      let failed = true;
      try {
        const result = await step();
        failed = false;
        return result;
      } finally {
        const elapsed = clock() - from;
        if (parse) parsed += elapsed;
        log(`${label}${failed ? " (failed)" : ""}: ${ms(elapsed)}`);
      }
    },
    /** What was detected about an input: its kind, gzip or plain, its size. */
    input(kind: keyof typeof KIND_NAME, file: string) {
      if (!enabled) return;
      log(
        file === "-"
          ? `input: ${KIND_NAME[kind]} from stdin`
          : `input: ${KIND_NAME[kind]} ${file}, ${describeFile(file)}`
      );
    },
    /** The full stack of an error and of the causes behind it. */
    error(error: unknown) {
      if (!enabled) return;
      let current: unknown = error;
      for (let depth = 0; current !== undefined && depth < 5; depth++) {
        const text =
          current instanceof Error ? (current.stack ?? String(current)) : String(current);
        log(depth === 0 ? text : `caused by: ${text}`);
        current = current instanceof Error ? current.cause : undefined;
      }
    },
  };
}

/** The debug log of the process, on stderr. */
export const debug = createDebug((text) => process.stderr.write(text));

/**
 * Turns the debug log of the process on when the arguments have --debug, and closes it with the
 * total when the process exits. It reads the raw arguments, so that it also covers a usage error.
 */
export function startDebug(argv: string[]) {
  if (!argv.includes("--debug")) return;
  debug.enable();
  process.once("exit", () => debug.end());
}
