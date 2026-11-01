import type { HarTiming, OptionalTimingPhase } from "../types.js";

/** The duration of a timing phase, or null when the HAR marked it -1: it did not happen. */
export function phaseMs(timing: HarTiming, phase: OptionalTimingPhase): number | null {
  return timing.notApplicable?.includes(phase) ? null : timing[phase];
}

/** Whether a request went over a connection the browser already had open (TCP connect -1). */
export function reusesConnection(timing: HarTiming): boolean {
  return phaseMs(timing, "connect") === null;
}

/**
 * Time spent on the TCP handshake alone. HAR 1.2 counts TLS (`ssl`) inside `connect`, so
 * TCP is the difference; a value the HAR leaves out (-1, or 0 once parsed) counts as none.
 */
export function tcpConnectMs({ connect, ssl }: Pick<HarTiming, "connect" | "ssl">): number {
  return Math.max(0, Math.max(0, connect) - Math.max(0, ssl));
}
