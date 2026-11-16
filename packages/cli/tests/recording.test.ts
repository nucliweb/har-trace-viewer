import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import { readHarJson, readRecording } from "../src/recording";
import { secretHar } from "../../core/tests/helpers/secret-har";

const dirs: string[] = [];
function tempFile(name: string, content: string | Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), "htv-recording-"));
  dirs.push(dir);
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Replaces the standard input with a stream of the given bytes, or with a terminal for null. */
function stubStdin(input: Buffer | null) {
  const stream = Readable.from(input ? [input] : []) as Readable & { isTTY?: boolean };
  if (input === null) stream.isTTY = true;
  vi.spyOn(process, "stdin", "get").mockReturnValue(stream as unknown as typeof process.stdin);
}

const har = JSON.stringify(secretHar());

describe("readRecording", () => {
  it("parses a HAR file and a gzipped HAR file", async () => {
    const plain = await readRecording("har", tempFile("page.har", har));
    const zipped = await readRecording("har", tempFile("page.har.gz", gzipSync(har)));
    expect(plain.length).toBeGreaterThan(0);
    expect(zipped.length).toBe(plain.length);
  });

  it.each([
    ["is not JSON", "hello", "expected a HAR, but the file is not valid JSON"],
    [
      "is JSON that is no recording",
      '{"a":1}',
      "expected a HAR (log.entries) but found neither a HAR nor a Chrome trace",
    ],
    ["is a Chrome trace", '{"traceEvents":[]}', "expected a HAR but this is a Chrome trace"],
  ])("starts the error with the file when it %s", async (_case, content, message) => {
    const path = tempFile("page.har", content);
    await expect(readRecording("har", path)).rejects.toThrow(`${path}: ${message}`);
  });

  it("names a missing file", async () => {
    await expect(readRecording("har", "/nonexistent/page.har")).rejects.toThrow(
      "/nonexistent/page.har: no such file or directory"
    );
  });

  it("expects a trace when asked for one and given a HAR", async () => {
    const path = tempFile("page.json", har);
    await expect(readRecording("trace", path)).rejects.toThrow(
      `${path}: expected a Chrome trace but this is a HAR`
    );
  });

  it("reads the standard input for -, gunzipping a gzip stream", async () => {
    stubStdin(Buffer.from(har));
    const plain = await readRecording("har", "-");
    stubStdin(gzipSync(har));
    const zipped = await readRecording("har", "-");
    expect(plain.length).toBeGreaterThan(0);
    expect(zipped.length).toBe(plain.length);
  });

  it("names the standard input as stdin in its errors", async () => {
    stubStdin(Buffer.from("hello"));
    await expect(readRecording("har", "-")).rejects.toThrow(
      "stdin: expected a HAR, but the file is not valid JSON"
    );
  });

  it("asks for piped input when the standard input is a terminal", async () => {
    stubStdin(null);
    await expect(readRecording("har", "-")).rejects.toThrow(
      "stdin: this is a terminal, not a HAR; pipe one in"
    );
  });

  it("refuses an empty standard input", async () => {
    stubStdin(Buffer.alloc(0));
    await expect(readRecording("har", "-")).rejects.toThrow("stdin: no input; pipe a HAR in");
  });
});

describe("readHarJson", () => {
  it("returns the JSON the HAR holds, untouched by the parser", async () => {
    expect(await readHarJson(tempFile("page.har", har))).toEqual(JSON.parse(har));
  });

  it("starts the error with the file for a trace", async () => {
    const path = tempFile("trace.json", '{"traceEvents":[]}');
    await expect(readHarJson(path)).rejects.toThrow(
      `${path}: expected a HAR but this is a Chrome trace`
    );
  });
});
