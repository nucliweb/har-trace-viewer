import { parseHarPagesJson, parseTraceJson } from "@htv/core";
import { readFileText } from "./read-file-text.js";
import type { ParsedHar, ParsedTrace } from "@htv/core";
import type {
  ParseKind,
  ParseProgress,
  ParseRequest,
  ParseResponse,
  ParseResultFor,
} from "./parse-protocol.js";

/**
 * One shared worker, created on first use. It is terminated after IDLE_MS without
 * pending work so a large parsed payload and the worker heap are released, while
 * consecutive drops (HAR then trace) reuse the same worker.
 */
const IDLE_MS = 30_000;

interface Pending {
  kind: ParseKind;
  file: File;
  resolve: (value: ParsedHar[] | ParsedTrace) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: ParseProgress) => void;
}

let worker: Worker | null = null;
/**
 * Set once the worker script fails to load (for example in a `--bundle` report, where the
 * worker chunk is not inlined). Later calls parse on the main thread directly.
 */
let workerBroken = false;
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
): Promise<ParsedHar[] | ParsedTrace> {
  onProgress?.({ phase: "parsing", loaded: 0, total: 0 });
  // Let the "Parsing…" state paint before the synchronous parse blocks the thread.
  await new Promise((resolve) => setTimeout(resolve, 0));
  const text = await readFileText(file, file.name.toLowerCase().endsWith(".gz"));
  return kind === "har" ? parseHarPagesJson(text) : parseTraceJson(text);
}

function fallBackToMainThread(): void {
  workerBroken = true;
  shutdown(null);
  const stranded = [...pending.values()];
  pending.clear();
  for (const p of stranded) {
    parseOnMainThread(p.kind, p.file, p.onProgress).then(p.resolve, p.reject);
  }
}

function getWorker(): Worker {
  if (worker) return worker;
  const created = new Worker(new URL("../workers/parse.worker.ts", import.meta.url), {
    type: "module",
  });
  created.onmessage = (event: MessageEvent<ParseResponse>) => {
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
    event.preventDefault(); // keep the load failure out of the console
    fallBackToMainThread();
  };
  created.onmessageerror = fallBackToMainThread;
  worker = created;
  return created;
}

export function parseInWorker<K extends ParseKind>(
  kind: K,
  file: File,
  onProgress?: (progress: ParseProgress) => void
): Promise<ParseResultFor<K>> {
  clearTimeout(idleTimer);
  if (workerBroken) return parseOnMainThread(kind, file, onProgress) as Promise<ParseResultFor<K>>;
  const id = nextId++;
  return new Promise<ParsedHar[] | ParsedTrace>((resolve, reject) => {
    pending.set(id, { kind, file, resolve, reject, onProgress });
    const request: ParseRequest = { id, kind, file };
    try {
      getWorker().postMessage(request);
    } catch {
      // The Worker constructor can throw synchronously (for example SecurityError on file://).
      fallBackToMainThread();
    }
  }) as Promise<ParseResultFor<K>>;
}
