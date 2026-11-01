import { readRecordingFile } from "../lib/parse-recording.js";
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
    const result = await readRecordingFile(kind, file, report);
    post({ id, ok: true, result });
  } catch (error) {
    // An Error does not cross postMessage as such: its message does.
    post({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
