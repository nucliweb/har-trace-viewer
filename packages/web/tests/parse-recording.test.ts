import { gzipSync } from "node:zlib";
import { File as NodeFile } from "node:buffer";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GZIP_UNSUPPORTED,
  UNRECOGNIZED_JSON,
  parseRecording,
  readRecordingFile,
} from "../src/lib/parse-recording.js";
import { harJson, traceJson } from "./fixtures.js";

const traceEvents = (JSON.parse(traceJson) as { traceEvents: unknown[] }).traceEvents;

describe("parseRecording", () => {
  it("parses a HAR into its pages", () => {
    const pages = parseRecording("har", harJson);

    expect(Array.isArray(pages) && pages[0].documentEntry.url).toBe(
      "https://webperf-snippets.nucliweb.net/"
    );
  });

  it("parses a trace object and a bare event array alike", () => {
    const fromObject = parseRecording("trace", traceJson);
    const fromArray = parseRecording("trace", JSON.stringify(traceEvents));

    expect(fromArray).toEqual(fromObject);
    expect(fromObject).toMatchObject({ fcp: expect.any(Number) });
  });

  it("names JSON that is neither a HAR nor a trace instead of throwing a TypeError", () => {
    for (const kind of ["har", "trace"] as const) {
      for (const json of ['{"foo":1}', '"text"', "42", "null", '{"log":{}}']) {
        expect(() => parseRecording(kind, json), `${kind} ${json}`).toThrow(
          new Error(UNRECOGNIZED_JSON)
        );
      }
    }
  });

  it("says when the file is not JSON at all", () => {
    expect(() => parseRecording("har", "{ not json")).toThrow(/^Not valid JSON: /);
  });

  it("says when a trace was given as a HAR and the other way round", () => {
    expect(() => parseRecording("har", traceJson)).toThrow(
      "This is a Chrome trace, not a HAR: load it with the Trace button."
    );
    expect(() => parseRecording("trace", harJson)).toThrow(
      "This is a HAR, not a Chrome trace: load it as the page's HAR."
    );
  });

  it("passes on the messages of the core parsers verbatim", () => {
    expect(() => parseRecording("har", '{"log":{"pages":[],"entries":[]}}')).toThrow(
      new Error("HAR contains no pages")
    );
    expect(() => parseRecording("trace", '{"traceEvents":[]}')).toThrow(
      new Error("No navigationStart found in trace")
    );
  });
});

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
