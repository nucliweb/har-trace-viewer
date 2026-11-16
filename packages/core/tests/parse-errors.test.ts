import { describe, expect, it } from "vitest";
import {
  ParseError,
  UNRECOGNIZED_JSON,
  parseHarPagesJson,
  parseRecording,
  parseTraceJson,
} from "../src/index.js";

function thrown(run: () => unknown): ParseError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ParseError);
    return error as ParseError;
  }
  throw new Error("expected the parser to throw");
}

describe("parser errors carry a code and its parameters", () => {
  it("not-json: the detail of the JSON error", () => {
    const error = thrown(() => parseRecording("har", "{ not json"));
    expect(error.code).toBe("not-json");
    expect(error.params).toEqual({ kind: "har", detail: expect.any(String) });
    expect(error.message).toBe(`Not valid JSON: ${error.params.detail}`);
  });

  it("unrecognized-json: what was expected", () => {
    const error = thrown(() => parseRecording("trace", '{"foo":1}'));
    expect(error).toMatchObject({ code: "unrecognized-json", params: { kind: "trace" } });
    expect(error.message).toBe(UNRECOGNIZED_JSON);
  });

  it("wrong-kind: what was expected and what was found", () => {
    const asHar = thrown(() => parseRecording("har", "[]"));
    expect(asHar).toMatchObject({ code: "wrong-kind", params: { kind: "har", found: "trace" } });
    expect(asHar.message).toBe("This is a Chrome trace, not a HAR: load it with the Trace button.");

    const asTrace = thrown(() => parseRecording("trace", '{"log":{"entries":[]}}'));
    expect(asTrace).toMatchObject({
      code: "wrong-kind",
      params: { kind: "trace", found: "har" },
    });
    expect(asTrace.message).toBe("This is a HAR, not a Chrome trace: load it as the page's HAR.");
  });

  it("har-no-entries", () => {
    const error = thrown(() => parseHarPagesJson('{"log":{"pages":[],"entries":[]}}'));
    expect(error).toMatchObject({ code: "har-no-entries", params: {} });
    expect(error.message).toBe("HAR contains no entries");
  });

  it("har-no-usable-entries", () => {
    const error = thrown(() => parseHarPagesJson('{"log":{"entries":[{"foo":1}]}}'));
    expect(error).toMatchObject({ code: "har-no-usable-entries", params: {} });
    expect(error.message).toBe("No entry of the HAR has a request URL and a valid start time.");
  });

  it("trace-no-navigation", () => {
    const error = thrown(() => parseTraceJson('{"traceEvents":[]}'));
    expect(error).toMatchObject({ code: "trace-no-navigation", params: {} });
    expect(error.message).toBe("No navigationStart found in trace");
  });

  it("is still an Error with the name of its class", () => {
    const error = thrown(() => parseRecording("har", "x"));
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("RecordingFormatError");
  });
});
