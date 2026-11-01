import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseInWorker } from "../src/lib/parse-client.js";
import { UNRECOGNIZED_JSON } from "../src/lib/parse-recording.js";
import type { ParseRequest, ParseResponse } from "../src/lib/parse-protocol.js";
import { harJson, makeFile } from "./fixtures.js";

type Handler = (event: { data: ParseRequest }) => Promise<void>;

/**
 * Runs the real worker script on this thread: what the page posts reaches the worker's
 * onmessage, and what the worker posts comes back to the page, both through structuredClone
 * as across a real worker boundary.
 */
async function installWorker(): Promise<void> {
  const posted: ParseResponse[] = [];
  vi.spyOn(window, "postMessage").mockImplementation((message: unknown) => {
    posted.push(structuredClone(message) as ParseResponse);
  });
  await import("../src/workers/parse.worker.js");
  const handler = self.onmessage as unknown as Handler;

  class InlineWorker {
    onmessage: ((event: { data: ParseResponse }) => void) | null = null;
    onerror: unknown = null;
    onmessageerror: unknown = null;
    postMessage(request: ParseRequest): void {
      void handler({ data: request }).then(() => {
        for (const message of posted.splice(0)) this.onmessage?.({ data: message });
      });
    }
    terminate(): void {
      // Nothing runs in the background to stop.
    }
  }
  vi.stubGlobal("Worker", InlineWorker);
}

describe("parsing in the worker", () => {
  // parse-client keeps one worker for every call.
  beforeAll(installWorker);
  afterAll(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("brings the parser's message back across the worker boundary", async () => {
    await expect(parseInWorker("har", makeFile('{"foo":1}', "site.har"))).rejects.toThrow(
      new Error(UNRECOGNIZED_JSON)
    );
    await expect(
      parseInWorker("har", makeFile('{"log":{"pages":[],"entries":[]}}', "site.har"))
    ).rejects.toThrow(new Error("HAR contains no pages"));
  });

  it("brings the parsed pages back on success", async () => {
    const pages = await parseInWorker("har", makeFile(harJson, "site.har"));

    expect(pages[0].documentEntry.url).toBe("https://webperf-snippets.nucliweb.net/");
  });
});
