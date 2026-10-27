import { parseHarPagesJson, parseTraceJson } from "@htv/core";
import { readFileText } from "../lib/read-file-text.js";
import type { ParseProgress, ParseRequest, ParseResponse } from "../lib/parse-protocol.js";

const PROGRESS_INTERVAL_MS = 100;

const post = (message: ParseResponse): void =>
  (self as unknown as { postMessage(m: ParseResponse): void }).postMessage(message);

self.onmessage = async (event: MessageEvent<ParseRequest>) => {
  const { id, kind, file } = event.data;
  let last = 0;
  const report = (progress: ParseProgress, force = false) => {
    const now = performance.now();
    if (!force && now - last < PROGRESS_INTERVAL_MS) return;
    last = now;
    post({ id, progress });
  };
  try {
    const text = await readFileText(file, file.name.toLowerCase().endsWith(".gz"), report);
    report({ phase: "parsing", loaded: 0, total: 0 }, true);
    const result = kind === "har" ? parseHarPagesJson(text) : parseTraceJson(text);
    post({ id, ok: true, result });
  } catch (error) {
    post({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
