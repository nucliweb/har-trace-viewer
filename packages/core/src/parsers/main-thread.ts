import type { LongTask, MainThreadProfile, ScriptTime, TaskCategory } from "../types.js";

export interface RawTraceEvent {
  name: string;
  ts: number;
  dur?: number;
  pid?: number;
  tid?: number;
  ph?: string;
  args?: Record<string, unknown>;
}

// A task past this keeps the page from answering input; the rest counts as blocking.
const LONG_TASK_MS = 50;
const MAX_SCRIPTS = 100;
const EXTENSION_SCHEME = "chrome-extension://";

// The category of an event by its name; an event not listed takes its parent's.
const CATEGORY_BY_NAME: Record<string, TaskCategory> = {
  FunctionCall: "scripting",
  EvaluateScript: "scripting",
  EvaluateModule: "scripting",
  "v8.compile": "scripting",
  "v8.compileModule": "scripting",
  "v8.run": "scripting",
  "v8.callFunction": "scripting",
  "v8.produceCache": "scripting",
  "v8.deserializeOnBackground": "scripting",
  ScriptCompiled: "scripting",
  RunMicrotasks: "scripting",
  TimerFire: "scripting",
  EventDispatch: "scripting",
  XHRLoad: "scripting",
  XHRReadyStateChange: "scripting",
  FireAnimationFrame: "scripting",
  FireIdleCallback: "scripting",
  HandlePostMessage: "scripting",
  Layout: "rendering",
  UpdateLayoutTree: "rendering",
  RecalculateStyles: "rendering",
  ScheduleStyleRecalculation: "rendering",
  InvalidateLayout: "rendering",
  PrePaint: "rendering",
  HitTest: "rendering",
  UpdateLayerTree: "rendering",
  Layerize: "rendering",
  "IntersectionObserverController::computeIntersections": "rendering",
  "PageAnimator::serviceScriptedAnimations": "rendering",
  Animation: "rendering",
  Paint: "painting",
  PaintImage: "painting",
  "Decode Image": "painting",
  "Decode LazyPixelRef": "painting",
  Commit: "painting",
  CompositeLayers: "painting",
  RasterTask: "painting",
  UpdateLayer: "painting",
  ParseHTML: "parsing",
  ParseAuthorStyleSheet: "parsing",
  MinorGC: "gc",
  MajorGC: "gc",
  BlinkGC: "gc",
};

function categoryOf(name: string): TaskCategory | undefined {
  const known = CATEGORY_BY_NAME[name];
  if (known) return known;
  if (/GC|GarbageCollect/.test(name)) return "gc";
  if (/^[vV]8[.:]/.test(name)) return "scripting";
  return undefined;
}

const stringOr = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

// The script URL an event names, on the events that carry one.
function urlOf(e: RawTraceEvent): string | undefined {
  const args = e.args ?? {};
  const data = (args.data ?? {}) as Record<string, unknown>;
  switch (e.name) {
    case "FunctionCall":
    case "EvaluateScript":
    case "EvaluateModule":
    case "v8.compile":
    case "v8.compileModule":
    case "v8.produceCache":
    case "ScriptCompiled":
      return stringOr(data.url) ?? stringOr(args.fileName);
    default:
      return undefined;
  }
}

interface Node {
  start: number; // µs
  end: number; // µs
  childrenUs: number;
  url: string | undefined; // its own or the nearest ancestor's
  category: TaskCategory | undefined; // its own or the nearest ancestor's
}

interface Task {
  startMs: number;
  durationMs: number;
  byUrl: Map<string, number>; // ms
  byCategory: Partial<Record<TaskCategory, number>>; // ms
}

const emptyCategories = (): Record<TaskCategory, number> => ({
  scripting: 0,
  rendering: 0,
  painting: 0,
  parsing: 0,
  gc: 0,
  other: 0,
});

/** The renderer's main thread: the navigation's thread, or CrRendererMain of its process. */
function mainThreadOf(events: RawTraceEvent[], nav: RawTraceEvent): { pid?: number; tid?: number } {
  const onNavThread = events.some(
    (e) => e.ph === "X" && e.pid === nav.pid && e.tid === nav.tid && e.name === "RunTask"
  );
  if (onNavThread) return { pid: nav.pid, tid: nav.tid };
  const named = events.find(
    (e) =>
      e.name === "thread_name" &&
      e.pid === nav.pid &&
      (e.args as { name?: unknown } | undefined)?.name === "CrRendererMain"
  );
  return named ? { pid: named.pid, tid: named.tid } : { pid: nav.pid, tid: nav.tid };
}

// The top-level tasks of the thread with the time under each script URL and category, from
// the nesting of its complete events: each event's self time goes to its own category (or
// its parent's) and to the nearest script URL around it.
function collectTasks(events: RawTraceEvent[], navigationStart: number): Task[] {
  const sorted = events
    .filter((e) => e.ph === "X" && typeof e.dur === "number" && e.dur >= 0)
    .sort((a, b) => a.ts - b.ts || b.dur! - a.dur!);
  const tasks: Task[] = [];
  const stack: Node[] = [];
  let current: Task | null = null;

  const close = (node: Node) => {
    const selfMs = Math.max(0, node.end - node.start - node.childrenUs) / 1000;
    if (selfMs === 0 || !current) return;
    const category = node.category ?? "other";
    current.byCategory[category] = (current.byCategory[category] ?? 0) + selfMs;
    if (node.url) current.byUrl.set(node.url, (current.byUrl.get(node.url) ?? 0) + selfMs);
  };

  for (const e of sorted) {
    const start = e.ts;
    const end = e.ts + e.dur!;
    for (let top = stack.at(-1); top && top.end <= start; top = stack.at(-1)) {
      stack.pop();
      close(top);
    }
    const parent = stack[stack.length - 1];
    if (parent) parent.childrenUs += Math.min(end, parent.end) - start;
    else {
      current = {
        startMs: (start - navigationStart) / 1000,
        durationMs: e.dur! / 1000,
        byUrl: new Map(),
        byCategory: {},
      };
      tasks.push(current);
    }
    stack.push({
      start,
      end: parent ? Math.min(end, parent.end) : end,
      childrenUs: 0,
      url: urlOf(e) ?? parent?.url,
      category: categoryOf(e.name) ?? parent?.category,
    });
  }
  while (stack.length > 0) close(stack.pop()!);
  return tasks;
}

const round = (ms: number) => Math.round(ms * 1000) / 1000;

/**
 * What the renderer's main thread did during the recording: its busy time by category and by
 * script URL, the long tasks (over 50 ms) and the Total Blocking Time between the first
 * contentful paint and the first interaction (the end of the recording without one). Null
 * when the trace has no main-thread tasks (a trace recorded without the timeline categories).
 */
export function profileMainThread(
  events: RawTraceEvent[],
  nav: RawTraceEvent,
  fcpMs: number | null,
  firstInputMs: number | null
): MainThreadProfile | null {
  const thread = mainThreadOf(events, nav);
  const own = events.filter((e) => e.pid === thread.pid && e.tid === thread.tid);
  const tasks = collectTasks(own, nav.ts);
  if (tasks.length === 0) return null;

  const recordingEndMs = Math.max(...tasks.map((t) => t.startMs + t.durationMs));
  const tbtToMs = firstInputMs ?? recordingEndMs;
  const inWindow = (t: Task) => fcpMs !== null && t.startMs >= fcpMs && t.startMs < tbtToMs;

  const byCategory = emptyCategories();
  const scripts = new Map<string, ScriptTime>();
  const longTasks: LongTask[] = [];
  let tbtMs = 0;
  let extensionMs = 0;

  for (const task of tasks) {
    for (const [category, ms] of Object.entries(task.byCategory)) {
      byCategory[category as TaskCategory] += ms;
    }
    const blockingMs = Math.max(0, task.durationMs - LONG_TASK_MS);
    const counted = blockingMs > 0 && inWindow(task);
    if (counted) tbtMs += blockingMs;
    for (const [url, ms] of task.byUrl) {
      if (url.startsWith(EXTENSION_SCHEME)) extensionMs += ms;
      const script = scripts.get(url) ?? { url, ms: 0, blockingMs: 0, tasks: 0 };
      script.ms += ms;
      script.tasks += 1;
      if (counted) script.blockingMs += (blockingMs * ms) / task.durationMs;
      scripts.set(url, script);
    }
    if (blockingMs > 0) {
      const [topUrl] = [...task.byUrl].sort((a, b) => b[1] - a[1])[0] ?? [null];
      const [topCategory] = (Object.entries(task.byCategory) as [TaskCategory, number][]).sort(
        (a, b) => b[1] - a[1]
      )[0] ?? ["other"];
      longTasks.push({
        startMs: round(task.startMs),
        durationMs: round(task.durationMs),
        blockingMs: round(blockingMs),
        url: topUrl,
        category: topCategory,
      });
    }
  }

  for (const key of Object.keys(byCategory) as TaskCategory[]) {
    byCategory[key] = round(byCategory[key]);
  }
  return {
    busyMs: round(tasks.reduce((sum, t) => sum + t.durationMs, 0)),
    byCategory,
    scripts: [...scripts.values()]
      .sort((a, b) => b.ms - a.ms)
      .slice(0, MAX_SCRIPTS)
      .map((s) => ({ ...s, ms: round(s.ms), blockingMs: round(s.blockingMs) })),
    longTasks,
    tbtMs: fcpMs === null ? null : round(tbtMs),
    tbtFromMs: fcpMs,
    tbtToMs: round(tbtToMs),
    tbtEndedBy: firstInputMs === null ? "recording" : "interaction",
    extensionMs: round(extensionMs),
  };
}
