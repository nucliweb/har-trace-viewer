import { afterEach, describe, expect, it, vi } from "vitest";
import { expandPageFlows, generateFlow, parseHarPagesJson } from "@htv/core";
import type { ParseResponse, WorkerRequest } from "../src/lib/parse-protocol.js";
import { harJson, makeFile } from "./fixtures.js";

/** A worker the test drives by hand: it records the requests and fails or reports on demand. */
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: { data: ParseResponse }) => void) | null = null;
  onerror: ((event: { message?: string; preventDefault(): void }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  requests: WorkerRequest[] = [];
  terminate = vi.fn();
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(request: WorkerRequest): void {
    this.requests.push(request);
  }
  progress(): void {
    const { id } = this.requests[0];
    this.onmessage?.({ data: { id, progress: { phase: "reading", loaded: 1, total: 2 } } });
  }
  fail(message: string): void {
    this.onerror?.({ message, preventDefault: () => undefined });
  }
}

// parse-client keeps its worker in module state: every test starts from a fresh module.
async function load() {
  vi.resetModules();
  vi.stubGlobal("Worker", FakeWorker);
  return import("../src/lib/parse-client.js");
}

describe("parse-client when the worker fails", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeWorker.instances = [];
  });

  it("parses on the main thread when the worker script does not load", async () => {
    const { parseInWorker } = await load();
    const promise = parseInWorker("har", makeFile(harJson, "site.har"));
    FakeWorker.instances[0].fail("Failed to fetch a worker script");

    const pages = await promise;
    expect(pages[0].documentEntry.url).toBe("https://webperf-snippets.nucliweb.net/");
    // Later parses go straight to the main thread.
    await parseInWorker("har", makeFile(harJson, "site.har"));
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it("reports a crash of a running worker instead of parsing again on the main thread", async () => {
    const { parseInWorker } = await load();
    const onProgress = vi.fn();
    const promise = parseInWorker("har", makeFile(harJson, "site.har"), onProgress);
    const worker = FakeWorker.instances[0];
    worker.progress();
    expect(onProgress).toHaveBeenCalledWith({ phase: "reading", loaded: 1, total: 2 });

    worker.fail("Out of memory");
    await expect(promise).rejects.toThrow(
      "The parser crashed in the browser (Out of memory). The file may be too large for this tab: try the htv command line, or a HAR without response bodies."
    );
    expect(worker.terminate).toHaveBeenCalled();

    // The next parse gets a fresh worker: the crash does not turn the worker off for good.
    void parseInWorker("har", makeFile(harJson, "site.har"));
    expect(FakeWorker.instances).toHaveLength(2);
  });

  it("generates on the main thread when the worker script does not load", async () => {
    const { generateInWorker } = await load();
    const pages = expandPageFlows({ name: "Home", har: parseHarPagesJson(harJson) });
    const promise = generateInWorker(pages, { clientRegion: "default" });
    expect(FakeWorker.instances[0].requests[0]).toMatchObject({ kind: "flow", pages });
    FakeWorker.instances[0].fail("Failed to fetch a worker script");

    const flow = await promise;
    expect(flow).toEqual(generateFlow(pages, { clientRegion: "default" }));
    expect(flow.pages).toBe(pages);
    // Later generations go straight to the main thread.
    expect(await generateInWorker(pages)).toEqual(generateFlow(pages));
    expect(FakeWorker.instances).toHaveLength(1);
  });
});
