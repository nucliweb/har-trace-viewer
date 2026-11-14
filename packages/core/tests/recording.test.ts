import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RecordingFormatError, UNRECOGNIZED_JSON, parseRecording } from "../src/index.js";

const dir = resolve(import.meta.dirname, "fixtures");
const harJson = readFileSync(resolve(dir, "webperf-snippets.har.fixture.json"), "utf8");
const traceJson = readFileSync(resolve(dir, "webperf-snippets.trace.fixture.json"), "utf8");
const traceEvents = (JSON.parse(traceJson) as { traceEvents: unknown[] }).traceEvents;

function formatError(run: () => unknown): RecordingFormatError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(RecordingFormatError);
    return error as RecordingFormatError;
  }
  throw new Error("expected parseRecording to throw");
}

describe("parseRecording", () => {
  it("parses a HAR into its pages", () => {
    const pages = parseRecording("har", harJson);

    expect(pages[0].documentEntry.url).toBe("https://webperf-snippets.nucliweb.net/");
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
        const error = formatError(() => parseRecording(kind, json));
        expect(error.message, `${kind} ${json}`).toBe(UNRECOGNIZED_JSON);
        expect(error).toMatchObject({ reason: "unrecognized", expected: kind });
      }
    }
  });

  it("says when the text is not JSON at all", () => {
    const error = formatError(() => parseRecording("har", "{ not json"));

    expect(error.message).toMatch(/^Not valid JSON: /);
    expect(error).toMatchObject({ reason: "not-json", expected: "har" });
  });

  it("says when a trace was given as a HAR and the other way round", () => {
    const asHar = formatError(() => parseRecording("har", traceJson));
    const asTrace = formatError(() => parseRecording("trace", harJson));

    expect(asHar.message).toBe("This is a Chrome trace, not a HAR: load it with the Trace button.");
    expect(asHar).toMatchObject({ reason: "wrong-kind", expected: "har", found: "trace" });
    expect(asTrace.message).toBe("This is a HAR, not a Chrome trace: load it as the page's HAR.");
    expect(asTrace).toMatchObject({ reason: "wrong-kind", expected: "trace", found: "har" });
  });

  it("passes on the messages of the parsers verbatim", () => {
    expect(() => parseRecording("har", '{"log":{"pages":[],"entries":[]}}')).toThrow(
      new Error("HAR contains no entries")
    );
    expect(() => parseRecording("trace", '{"traceEvents":[]}')).toThrow(
      new Error("No navigationStart found in trace")
    );
  });
});
