import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { generateInWorker, parseInWorker } from "../src/lib/parse-client.js";
import { expandPageFlows, generateFlow, parseHarPagesJson, parseTraceJson } from "@htv/core";
import { UNRECOGNIZED_JSON } from "@htv/core";
import type { WorkerRequest, ParseResponse } from "../src/lib/parse-protocol.js";
import { harJson, makeFile, traceJson } from "./fixtures.js";

type Handler = (event: { data: WorkerRequest }) => Promise<void>;

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
    postMessage(request: WorkerRequest): void {
      // The pages of a flow cross as copies; jsdom cannot clone Node's File, passed as it is.
      void handler({ data: request.kind === "flow" ? structuredClone(request) : request }).then(
        () => {
          for (const message of posted.splice(0)) this.onmessage?.({ data: message });
        }
      );
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
    ).rejects.toThrow(new Error("HAR contains no entries"));
  });

  it("brings the parsed pages back on success", async () => {
    const pages = await parseInWorker("har", makeFile(harJson, "site.har"));

    expect(pages[0].documentEntry.url).toBe("https://webperf-snippets.nucliweb.net/");
  });

  it("generates the flow in the worker, the same flow as on the main thread", async () => {
    const pages = expandPageFlows({
      name: "Home",
      har: parseHarPagesJson(harJson),
      trace: parseTraceJson(traceJson),
    });

    const flow = await generateInWorker(pages, { clientRegion: "cn" });

    const expected = generateFlow(pages, { clientRegion: "cn" });
    expect(flow).toEqual(expected);
    // Key for key, in the same order: an exported flow reads the same.
    expect(JSON.stringify(flow)).toBe(JSON.stringify(expected));
    // The pages do not travel back: the flow keeps the ones it was generated from.
    expect(flow.pages).toBe(pages);
  });

  it("brings a failed generation back as an error", async () => {
    await expect(generateInWorker([])).rejects.toThrow(
      new Error("Flow requires at least one page")
    );
  });
});
