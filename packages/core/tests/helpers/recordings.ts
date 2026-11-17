import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { gunzipSync } from "zlib";

const ROOT_FIXTURES = fileURLToPath(new URL("../../../../fixtures/", import.meta.url));

/**
 * The real Chrome recordings in the repository's `fixtures/`: webperf-snippets recorded with the
 * browser cache disabled (cold) and enabled (warm).
 */
export const RECORDINGS = {
  cold: "webperf-snippets.nucliweb.net_Disable-Cache-20260519T123602.har",
  warm: "webperf-snippets.nucliweb.net_Cache-20260519T123746.har",
} as const;

export type Recording = keyof typeof RECORDINGS;

export function recordingPath(name: Recording): string {
  return join(ROOT_FIXTURES, RECORDINGS[name]);
}

/** The recording's HAR as JSON text, gunzipped when the file is. */
export function readRecording(name: Recording): string {
  const path = recordingPath(name);
  const data = readFileSync(path);
  return (path.endsWith(".gz") ? gunzipSync(data) : data).toString("utf8");
}
