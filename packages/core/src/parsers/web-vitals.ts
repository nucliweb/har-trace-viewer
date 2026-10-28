export interface VitalsEvent {
  name: string;
  ts: number; // microseconds
  ph?: string;
  args?: Record<string, unknown>;
}

type EventData = Record<string, unknown>;

const dataOf = (e: VitalsEvent): EventData => (e.args?.data as EventData | undefined) ?? {};

const GAP_US = 1_000_000;
const WINDOW_US = 5_000_000;
const INP_PERCENTILE_STEP = 50; // one interaction is dropped from the top per 50 interactions

/**
 * Cumulative Layout Shift: the largest session window of layout shifts.
 * Shifts with recent input and shifts outside the main frame are ignored; a window ends after a
 * gap above 1 s between consecutive shifts or once it spans more than 5 s. Null without LayoutShift
 * events; 0 when every shift is excluded.
 */
export function computeCls(events: VitalsEvent[]): number | null {
  const layoutShifts = events.filter((e) => e.name === "LayoutShift");
  if (layoutShifts.length === 0) return null;

  const shifts = layoutShifts
    .map((e) => ({ ts: e.ts, data: dataOf(e) }))
    .filter(
      ({ data }) =>
        typeof data.score === "number" &&
        data.had_recent_input !== true &&
        data.is_main_frame !== false
    )
    .sort((a, b) => a.ts - b.ts);

  let best = 0;
  let current = 0;
  let windowStart = 0;
  let previous = 0;
  shifts.forEach(({ ts, data }, i) => {
    if (i === 0 || ts - previous > GAP_US || ts - windowStart > WINDOW_US) {
      current = 0;
      windowStart = ts;
    }
    current += data.score as number;
    previous = ts;
    best = Math.max(best, current);
  });
  return best;
}

/**
 * Interaction to Next Paint, in ms: the longest duration per interactionId (> 0), then the
 * 98th percentile of those (the maximum up to 50 interactions). Null without interactions.
 */
export function computeInp(events: VitalsEvent[]): number | null {
  const longest = new Map<number, number>();
  for (const e of events) {
    if (e.name !== "EventTiming") continue;
    const { interactionId, duration } = dataOf(e);
    if (typeof interactionId !== "number" || interactionId <= 0) continue;
    if (typeof duration !== "number") continue;
    longest.set(interactionId, Math.max(longest.get(interactionId) ?? 0, duration));
  }
  if (longest.size === 0) return null;
  const sorted = [...longest.values()].sort((a, b) => b - a);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length / INP_PERCENTILE_STEP))];
}
