import { generateFlow } from "@htv/core";
import type { Flow, FlowOptions, PageFlow } from "@htv/core";
import { en } from "../i18n/en.js";
import { readRecordingFile } from "./parse-recording.js";
import type {
  FlowRequest,
  ParseKind,
  ParseProgress,
  ParseRequest,
  ParseResponse,
  ParseResultFor,
  WorkerResult,
} from "./parse-protocol.js";

/**
 * One shared worker, created on first use, parses the dropped files and generates the flow.
 * It is terminated after IDLE_MS without pending work so a large parsed payload and the
 * worker heap are released, while consecutive drops (HAR then trace) reuse the same worker.
 */
const IDLE_MS = 30_000;

interface Pending {
  /** The same work on the main thread, for when the worker cannot load. */
  runHere: () => Promise<WorkerResult>;
  resolve: (value: WorkerResult) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: ParseProgress) => void;
}

let worker: Worker | null = null;
/**
 * Set once the worker script fails to load (for example in a `--bundle` report, where the
 * worker chunk is not inlined). Later calls run on the main thread directly.
 */
let workerBroken = false;
/**
 * Set once the worker has posted a message: it loaded and runs. An error after that is a
 * crash of the parse itself (the tab ran out of memory on a huge file), which parsing again
 * on the main thread would only repeat, freezing the page this time.
 */
let workerAlive = false;
let nextId = 1;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
const pending = new Map<number, Pending>();

function shutdown(reason: Error | null): void {
  clearTimeout(idleTimer);
  worker?.terminate();
  worker = null;
  if (reason) {
    for (const p of pending.values()) p.reject(reason);
    pending.clear();
  }
}

function scheduleIdleShutdown(): void {
  clearTimeout(idleTimer);
  if (pending.size === 0) idleTimer = setTimeout(() => shutdown(null), IDLE_MS);
}

async function parseOnMainThread(
  kind: ParseKind,
  file: File,
  onProgress?: (progress: ParseProgress) => void
): Promise<WorkerResult> {
  onProgress?.({ phase: "parsing", loaded: 0, total: 0 });
  // Let the "Parsing…" state paint before the synchronous parse blocks the thread.
  await new Promise((resolve) => setTimeout(resolve, 0));
  return readRecordingFile(kind, file);
}

/** The worker died mid-parse (out of memory, most likely); the interface words the message. */
export class ParserCrashError extends Error {
  constructor(readonly detail: string | undefined) {
    super(en.builder.parserCrash(detail));
    this.name = "ParserCrashError";
  }
}

function reportCrash(message: string | undefined): void {
  shutdown(new ParserCrashError(message));
}

function fallBackToMainThread(): void {
  workerBroken = true;
  shutdown(null);
  const stranded = [...pending.values()];
  pending.clear();
  for (const p of stranded) {
    p.runHere().then(p.resolve, p.reject);
  }
}

function getWorker(): Worker {
  if (worker) return worker;
  const created = new Worker(new URL("../workers/parse.worker.ts", import.meta.url), {
    type: "module",
  });
  workerAlive = false;
  created.onmessage = (event: MessageEvent<ParseResponse>) => {
    workerAlive = true;
    const message = event.data;
    const entry = pending.get(message.id);
    if (!entry) return;
    if ("progress" in message) {
      entry.onProgress?.(message.progress);
      return;
    }
    pending.delete(message.id);
    if (message.ok) entry.resolve(message.result);
    else entry.reject(new Error(message.error));
    scheduleIdleShutdown();
  };
  created.onerror = (event) => {
    event.preventDefault(); // keep the failure out of the console
    if (workerAlive) reportCrash(event.message);
    else fallBackToMainThread();
  };
  created.onmessageerror = fallBackToMainThread;
  worker = created;
  return created;
}

type Request = Omit<ParseRequest, "id"> | Omit<FlowRequest, "id">;

function send(
  request: Request,
  runHere: () => Promise<WorkerResult>,
  onProgress?: (progress: ParseProgress) => void
): Promise<WorkerResult> {
  clearTimeout(idleTimer);
  if (workerBroken) return runHere();
  const id = nextId++;
  return new Promise<WorkerResult>((resolve, reject) => {
    pending.set(id, { runHere, resolve, reject, onProgress });
    try {
      getWorker().postMessage({ ...request, id });
    } catch {
      // The Worker constructor can throw synchronously (for example SecurityError on file://).
      fallBackToMainThread();
    }
  });
}

export function parseInWorker<K extends ParseKind>(
  kind: K,
  file: File,
  onProgress?: (progress: ParseProgress) => void
): Promise<ParseResultFor<K>> {
  return send(
    { kind, file },
    () => parseOnMainThread(kind, file, onProgress),
    onProgress
  ) as Promise<ParseResultFor<K>>;
}

async function generateOnMainThread(pages: PageFlow[], options: FlowOptions): Promise<Flow> {
  // Let the "Generating…" state paint before the synchronous analysis blocks the thread.
  await new Promise((resolve) => setTimeout(resolve, 0));
  return generateFlow(pages, options);
}

/** generateFlow off the main thread: the same flow, its `pages` the very pages passed in. */
export async function generateInWorker(
  pages: PageFlow[],
  options: FlowOptions = {}
): Promise<Flow> {
  const flow = (await send({ kind: "flow", pages, options }, () =>
    generateOnMainThread(pages, options)
  )) as Flow;
  return { ...flow, pages };
}
