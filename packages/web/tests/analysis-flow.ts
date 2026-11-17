import { expandPageFlows, generateFlow, parseHarPages } from "@htv/core";
import type { Flow, ParsedHar, ParsedTrace, PageFlow } from "@htv/core";
import { makeEntry, makeTrace } from "../../core/tests/helpers/synthetic-har";
import { apiCaptureHar } from "./api-capture.js";

const DOCUMENT = "https://example.com/";
const CSS = "https://example.com/app.css";
const HERO = "https://static.example.com/hero.jpg";

/**
 * A page whose connections, compression and rendering each have something to show: the
 * document, a stylesheet and its font on one HTTP/2 connection with Server-Timing; a static host
 * on HTTP/1.1 over two connections with cookies; a render-blocking third-party script over
 * HTTP/3, gzip only. The stylesheet is sent uncompressed and the images as JPEG and PNG.
 */
function analysisHar(): ParsedHar {
  const doc = makeEntry({
    url: DOCUMENT,
    startTime: 0,
    duration: 80,
    mimeType: "text/html",
    isDocument: true,
    resourceType: "document",
    timing: { dns: 10, connect: 20, ssl: 15, send: 1, wait: 50, receive: 5, blocked: 0 },
    ttfb: 50,
    httpVersion: "h2",
    connectionId: "1",
    contentEncoding: "br",
    transferSize: 8_000,
    bodySize: 30_000,
    serverTiming: [
      { name: "db", dur: 53, desc: "Database" },
      { name: "cache", desc: "HIT" },
    ],
  });
  const css = makeEntry({
    url: CSS,
    startTime: 90,
    duration: 60,
    httpVersion: "h2",
    connectionId: "1",
    contentEncoding: "none",
    transferSize: 50_000,
    bodySize: 50_000,
    initiator: { type: "parser", url: DOCUMENT },
  });
  const font = makeEntry({
    url: "https://example.com/font.woff2",
    startTime: 160,
    duration: 40,
    mimeType: "font/woff2",
    resourceType: "font",
    initiator: { type: "parser", url: CSS },
    httpVersion: "h2",
    connectionId: "1",
    transferSize: 20_000,
    bodySize: 20_000,
  });
  const tag = makeEntry({
    url: "https://cdn.third.com/tag.js",
    startTime: 95,
    duration: 200,
    mimeType: "application/javascript",
    resourceType: "script",
    priority: "High",
    initiator: { type: "parser", url: DOCUMENT },
    timing: { dns: 5, connect: 10, ssl: 6, send: 1, wait: 100, receive: 50, blocked: 0 },
    httpVersion: "h3",
    connectionId: "9",
    contentEncoding: "gzip",
    advertisesHttp3: true,
    transferSize: 20_000,
    bodySize: 60_000,
  });
  const image = (url: string, mimeType: string, connectionId: string, bytes: number) =>
    makeEntry({
      url,
      startTime: 300,
      mimeType,
      resourceType: "image",
      priority: "Low",
      timing: { dns: 8, connect: 12, ssl: 6, send: 1, wait: 20, receive: 5, blocked: 0 },
      httpVersion: "h1",
      connectionId,
      requestCookieBytes: 1_500,
      transferSize: bytes,
      bodySize: bytes,
    });
  return {
    pages: [{ id: "p1", title: "Home", onContentLoad: 300, onLoad: 500 }],
    entries: [
      doc,
      css,
      tag,
      font,
      image(HERO, "image/jpeg", "2", 100_000),
      image("https://static.example.com/thumb.png", "image/png", "3", 30_000),
    ],
    documentEntry: doc,
    preconnectHints: {},
  };
}

/** A trace of the same load: FCP at 400 ms, and the LCP at 600 ms painted by the hero image. */
function analysisTrace(): ParsedTrace {
  return {
    ...makeTrace(400, 600),
    lcpCandidate: { timeMs: 600, type: "image", nodeName: "IMG", url: HERO, loadingAttr: "eager" },
  };
}

export const analysisPage = (trace = true): PageFlow => ({
  name: "Home",
  har: analysisHar(),
  ...(trace ? { trace: analysisTrace() } : {}),
});

/** The page above, then an API capture: a second page without an HTML document. */
export function analysisJourney(): Flow {
  return generateFlow([
    analysisPage(),
    ...expandPageFlows({ name: "API", har: parseHarPages(apiCaptureHar() as never) }),
  ]);
}
