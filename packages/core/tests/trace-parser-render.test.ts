import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { parseTraceJson } from "../src/parsers/trace-parser.js";
import { parseTraceFile } from "../src/parsers/trace-parser-node.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
// The disable-cache trace trimmed to the paint, LCP and network events.
const renderFixture = join(__dirname, "fixtures/webperf-snippets-render.trace.fixture.json");
const cacheTracePath = join(
  __dirname,
  "../../../fixtures/WebPerf-Snippets-Cache_Trace-20260519T123746.json.gz"
);

const LCP_IMAGE =
  "https://res.cloudinary.com/nucliweb/image/upload/c_scale,f_auto,q_auto,w_1200/v1685735993/webperf-snippets/DevTools-Snippets.png";
const DOCUMENT = "https://webperf-snippets.nucliweb.net/";
const MAIN_CSS = "https://webperf-snippets.nucliweb.net/_next/static/css/4f18b1ac3f22924b.css";

describe("parseTrace — LCP candidate and network requests", () => {
  const trace = parseTraceJson(readFileSync(renderFixture, "utf8"));

  it("describes the final LCP candidate: the image, its node and its load times", () => {
    expect(trace.lcpCandidate).toMatchObject({
      type: "image",
      nodeId: 285,
      nodeName: "IMG",
      url: LCP_IMAGE,
      size: 192932,
      loadingAttr: "eager",
      imageDiscoveryMs: 58.9,
      imageLoadStartMs: 69.3,
      imageLoadEndMs: 121.8,
    });
    expect(trace.lcpCandidate!.timeMs).toBeCloseTo(181.487, 3);
    expect(trace.lcp).toBeCloseTo(181.487, 3);
    expect(trace.firstInputMs).toBeNull();
  });

  it("times the document request from navigationStart with the network timing", () => {
    const document = trace.requests!.find((r) => r.url === DOCUMENT)!;

    expect(document.resourceType).toBe("Document");
    expect(document.startMs).toBeCloseTo(4.275, 2);
    expect(document.responseStartMs).toBeCloseTo(42.92, 1);
    expect(document.responseEndMs).toBeCloseTo(53.92, 1);
    expect(document.endMs).toBeCloseTo(55.57, 1);
    expect(document.encodedDataLength).toBe(15663);
  });

  it("keeps the final render-blocking status after a preload is used as a stylesheet", () => {
    const css = trace.requests!.find((r) => r.url === MAIN_CSS)!;

    expect(css).toMatchObject({
      resourceType: "Stylesheet",
      renderBlocking: "blocking",
      isLinkPreload: true,
      priority: "VeryHigh",
      initiator: { type: "parser", url: DOCUMENT },
      fromCache: false,
    });
    expect(css.sentAtMs).toBeCloseTo(58.678, 2);
    expect(css.endMs).toBeCloseTo(116.9, 1);
  });

  it("keeps the fetch priority hint and the priority of the LCP image request", () => {
    const image = trace.requests!.find((r) => r.url === LCP_IMAGE)!;

    expect(image).toMatchObject({
      resourceType: "Image",
      priority: "High",
      fetchPriorityHint: "high",
      isLinkPreload: false,
      initiator: { type: "parser", url: DOCUMENT },
    });
    expect(image.endMs).toBeCloseTo(121.8, 1);
  });

  it("leaves out browser-extension requests and requests sent after the last paint metric", () => {
    const urls = trace.requests!.map((r) => r.url);

    expect(urls.some((url) => url.startsWith("chrome-extension://"))).toBe(false);
    expect(urls.some((url) => url.includes("google-analytics.com"))).toBe(false);
    expect(urls).toHaveLength(13);
  });

  it("reads the cached run from the gzipped trace", async () => {
    const cached = await parseTraceFile(cacheTracePath);

    expect(cached.lcpCandidate).toMatchObject({ type: "image", nodeId: 283, url: LCP_IMAGE });
    expect(cached.lcpCandidate!.timeMs).toBeCloseTo(215.4, 1);
    const image = cached.requests!.find((r) => r.url === LCP_IMAGE)!;
    expect(image.fromCache).toBe(true);
  });
});

describe("parseTrace — synthetic render events", () => {
  const nav = {
    name: "navigationStart",
    ts: 1_000_000,
    args: {
      frame: "F1",
      data: { isOutermostMainFrame: true, documentLoaderURL: "https://a.test/", navigationId: "N" },
    },
  };
  const lcp = (ts: number, nodeId: number, candidateIndex: number, extra = {}) => ({
    name: "largestContentfulPaint::Candidate",
    ts,
    args: {
      frame: "F1",
      data: {
        navigationId: "N",
        isOutermostMainFrame: true,
        nodeId,
        candidateIndex,
        type: "text",
        size: 100 * candidateIndex,
        ...extra,
      },
    },
  });
  const textPaint = (ts: number, nodeId: number, candidateIndex: number, nodeName: string) => ({
    name: "LargestTextPaint::Candidate",
    ts,
    args: {
      frame: "F1",
      data: { DOMNodeId: nodeId, candidateIndex, nodeName, isOutermostMainFrame: true },
    },
  });
  const input = (ts: number) => ({
    name: "EventTiming",
    ts,
    ph: "b",
    args: { data: { interactionId: 7, duration: 40, type: "pointerdown" } },
  });

  it("names the LCP image from the paint candidate closest in time when the node painted twice", () => {
    const imagePaint = (ts: number, candidateIndex: number, imageUrl: string) => ({
      name: "LargestImagePaint::Candidate",
      ts,
      args: {
        frame: "F1",
        data: {
          DOMNodeId: 10,
          candidateIndex,
          imageUrl,
          nodeName: "IMG",
          isOutermostMainFrame: true,
        },
      },
    });
    const trace = parseTraceJson(
      JSON.stringify({
        traceEvents: [
          nav,
          imagePaint(1_200_000, 1, "https://a.test/placeholder.jpg"),
          lcp(1_400_000, 10, 1, { type: "image" }),
          imagePaint(1_410_000, 1, "https://a.test/hero.jpg"),
        ],
      })
    );

    expect(trace.lcpCandidate).toMatchObject({ nodeId: 10, url: "https://a.test/hero.jpg" });
  });

  it("ignores LCP candidates after the first interaction", () => {
    const trace = parseTraceJson(
      JSON.stringify({
        traceEvents: [
          nav,
          lcp(1_400_000, 10, 1),
          textPaint(1_400_000, 10, 1, "H1 class='title'"),
          input(1_500_000),
          lcp(1_900_000, 11, 2),
        ],
      })
    );

    expect(trace.firstInputMs).toBeCloseTo(500, 6);
    expect(trace.lcp).toBeCloseTo(400, 6);
    expect(trace.lcpCandidate).toMatchObject({
      timeMs: 400,
      type: "text",
      nodeId: 10,
      nodeName: "H1 class='title'",
    });
    expect(trace.lcpCandidate!.url).toBeUndefined();
  });

  it("takes a script initiator's URL from the top frame of its stack", () => {
    const trace = parseTraceJson(
      JSON.stringify({
        traceEvents: [
          nav,
          {
            name: "ResourceSendRequest",
            ts: 1_050_000,
            args: {
              data: {
                requestId: "r1",
                frame: "F1",
                url: "https://a.test/late.js",
                resourceType: "Script",
                renderBlocking: "non_blocking",
                initiator: {
                  type: "script",
                  stack: { callFrames: [{ url: "https://a.test/app.js", lineNumber: 0 }] },
                },
              },
            },
          },
          lcp(1_100_000, 10, 1),
        ],
      })
    );

    expect(trace.requests).toEqual([
      {
        url: "https://a.test/late.js",
        resourceType: "Script",
        renderBlocking: "non_blocking",
        initiator: { type: "script", url: "https://a.test/app.js" },
        sentAtMs: 50,
      },
    ]);
  });

  it("leaves requests of other frames out", () => {
    const trace = parseTraceJson(
      JSON.stringify({
        traceEvents: [
          nav,
          {
            name: "ResourceSendRequest",
            ts: 1_050_000,
            args: {
              data: { requestId: "r1", frame: "IFRAME", url: "https://ads.test/a.js" },
            },
          },
          lcp(1_100_000, 10, 1),
        ],
      })
    );

    expect(trace.requests).toEqual([]);
  });

  it("has no LCP candidate, input or requests without the events", () => {
    const trace = parseTraceJson(JSON.stringify({ traceEvents: [nav] }));

    expect(trace.lcpCandidate).toBeNull();
    expect(trace.firstInputMs).toBeNull();
    expect(trace.requests).toEqual([]);
  });
});
