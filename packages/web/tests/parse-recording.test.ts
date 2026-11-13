import { gzipSync } from "node:zlib";
import { File as NodeFile } from "node:buffer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseRecording } from "@htv/core";
import { GZIP_UNSUPPORTED, readRecordingFile } from "../src/lib/parse-recording.js";
import { harJson, traceJson } from "./fixtures.js";

describe("readRecordingFile", () => {
  const file = (content: string | ReturnType<typeof gzipSync>, name: string) =>
    new NodeFile([content], name) as unknown as File;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads a gzipped HAR and a gzipped trace", async () => {
    const har = await readRecordingFile("har", file(gzipSync(harJson), "site.har.gz"));
    const trace = await readRecordingFile("trace", file(gzipSync(traceJson), "trace.json.gz"));

    expect(har).toEqual(parseRecording("har", harJson));
    expect(trace).toEqual(parseRecording("trace", traceJson));
  });

  it("explains that the browser cannot decompress when DecompressionStream is missing", async () => {
    vi.stubGlobal("DecompressionStream", undefined);

    await expect(readRecordingFile("har", file(gzipSync(harJson), "site.har.gz"))).rejects.toThrow(
      new Error(GZIP_UNSUPPORTED)
    );
    // Plain files need no decompression.
    await expect(readRecordingFile("har", file(harJson, "site.har"))).resolves.toBeDefined();
  });
});
