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
      expect.objectContaining({ message: GZIP_UNSUPPORTED, code: "gzip-unsupported", params: {} })
    );
    // Plain files need no decompression.
    await expect(readRecordingFile("har", file(harJson, "site.har"))).resolves.toBeDefined();
  });

  it("names a gzip file that cannot be decompressed, with the browser's detail", async () => {
    const bytes = gzipSync(harJson);
    const truncated = file(bytes.subarray(0, bytes.length - 20), "site.har.gz");

    const error = await readRecordingFile("har", truncated).catch((e) => e);

    expect(error).toMatchObject({ code: "gzip-invalid", params: { detail: expect.any(String) } });
    expect(error.message).toBe(
      `Could not decompress the file${error.params.detail ? ` (${error.params.detail})` : ""}. It may be truncated or not a gzip file.`
    );
  });

  it("does not take a file that decompresses but does not parse for a gzip failure", async () => {
    await expect(readRecordingFile("har", file("{ no", "site.har"))).rejects.toMatchObject({
      code: "not-json",
    });
    await expect(
      readRecordingFile("har", file(gzipSync("{ no"), "site.har.gz"))
    ).rejects.toMatchObject({ code: "not-json" });
  });
});
