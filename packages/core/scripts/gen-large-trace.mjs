// Builds a deterministic synthetic Chrome trace with `requests` network requests, for the
// benchmark. It writes the events the trace parsers read (navigationStart, paint metrics,
// layout shifts, event timing, the resource request events and nested main-thread tasks), plus
// noise on other threads, so a parse does real work on every scan.
//
// Usage: import { generateTrace } from "./gen-large-trace.mjs"
//
// `urls` are the request URLs to put in the ResourceSendRequest events (they cycle when there
// are fewer than `requests`); the first one is the document.

// mulberry32: a small seeded PRNG.
function prng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PID = 4242;
const MAIN_TID = 1;
const NAVIGATION_ID = "NAV-1";
const FRAME = "FRAME-MAIN";
const NAV_TS = 1_000_000_000; // µs
const RESOURCE_TYPES = ["Script", "Image", "Stylesheet", "Fetch", "Font"];
const PRIORITIES = ["VeryHigh", "High", "Medium", "Low"];

export function generateTrace({ requests = 10_000, urls = [], seed = 20260519 } = {}) {
  const rand = prng(seed);
  const int = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const events = [];
  const at = (ms) => NAV_TS + Math.round(ms * 1000);
  const documentUrl = urls[0] ?? "https://www.bigsite.example/";

  events.push({
    name: "thread_name",
    ph: "M",
    pid: PID,
    tid: MAIN_TID,
    ts: 0,
    args: { name: "CrRendererMain" },
  });
  events.push({
    name: "navigationStart",
    ph: "R",
    pid: PID,
    tid: MAIN_TID,
    ts: NAV_TS,
    args: {
      frame: FRAME,
      data: {
        isOutermostMainFrame: true,
        documentLoaderURL: documentUrl,
        navigationId: NAVIGATION_ID,
        frame: FRAME,
      },
    },
  });

  // Network: send, response and finish events of each request, spread over nine seconds.
  for (let i = 0; i < requests; i++) {
    const requestId = `REQ.${i}`;
    const url = urls.length > 0 ? urls[i % urls.length] : `https://cdn.example/r/${i}.js`;
    const sentMs = i === 0 ? 0 : int(20, 9000);
    const start = sentMs + int(1, 30);
    const base = {
      pid: PID,
      tid: MAIN_TID,
      ph: "I",
    };
    events.push({
      ...base,
      name: "ResourceSendRequest",
      ts: at(sentMs),
      args: {
        data: {
          requestId,
          url,
          frame: FRAME,
          resourceType: i === 0 ? "Document" : pick(RESOURCE_TYPES),
          priority: pick(PRIORITIES),
          renderBlocking: i % 11 === 0 ? "blocking" : "non_blocking",
          isLinkPreload: i % 7 === 0,
          initiator: { type: "parser", url: documentUrl },
        },
      },
    });
    if (i % 11 === 0) {
      events.push({
        ...base,
        name: "PreloadRenderBlockingStatusChange",
        ts: at(sentMs + 1),
        args: { data: { requestId, renderBlocking: "in_body_parser_blocking" } },
      });
    }
    const requestTimeSeconds = (NAV_TS + start * 1000) / 1_000_000;
    events.push({
      ...base,
      name: "ResourceReceiveResponse",
      ts: at(start + 40),
      args: {
        data: {
          requestId,
          fromCache: i % 13 === 0,
          timing: {
            requestTime: requestTimeSeconds,
            receiveHeadersStart: int(10, 80),
            receiveHeadersEnd: int(81, 140),
          },
        },
      },
    });
    events.push({
      ...base,
      name: "ResourceFinish",
      ts: at(start + 160),
      args: {
        data: {
          requestId,
          finishTime: requestTimeSeconds + int(150, 400) / 1000,
          encodedDataLength: int(300, 90_000),
        },
      },
    });
  }

  // Paint metrics: the LCP lands after the last request so none is dropped.
  events.push({
    name: "firstContentfulPaint",
    ph: "R",
    pid: PID,
    tid: MAIN_TID,
    ts: at(800),
    args: { frame: FRAME, data: { navigationId: NAVIGATION_ID } },
  });
  for (let c = 0; c < 4; c++) {
    const nodeId = 100 + c;
    const ts = at(9200 + c * 100);
    events.push({
      name: "largestContentfulPaint::Candidate",
      ph: "R",
      pid: PID,
      tid: MAIN_TID,
      ts,
      args: {
        frame: FRAME,
        data: {
          navigationId: NAVIGATION_ID,
          isOutermostMainFrame: true,
          nodeId,
          candidateIndex: c + 1,
          size: 50_000 + c * 1000,
          type: "image",
        },
      },
    });
    events.push({
      name: "LargestImagePaint::Candidate",
      ph: "R",
      pid: PID,
      tid: MAIN_TID,
      ts: ts - 500,
      args: {
        frame: FRAME,
        data: {
          DOMNodeId: nodeId,
          candidateIndex: c + 1,
          isOutermostMainFrame: true,
          nodeName: "IMG",
          imageUrl: urls[c + 1] ?? documentUrl,
          size: 50_000 + c * 1000,
        },
      },
    });
  }

  // Layout shifts (a few hundred, in bursts) and interactions after the LCP.
  const shifts = Math.max(50, Math.round(requests / 20));
  for (let s = 0; s < shifts; s++) {
    events.push({
      name: "LayoutShift",
      ph: "I",
      pid: PID,
      tid: MAIN_TID,
      ts: at(int(500, 9000)),
      args: {
        data: {
          score: int(1, 40) / 1000,
          had_recent_input: s % 17 === 0,
          is_main_frame: true,
          navigationId: NAVIGATION_ID,
        },
      },
    });
  }
  const interactions = Math.max(20, Math.round(requests / 50));
  for (let k = 0; k < interactions; k++) {
    const interactionId = k % 3 === 0 ? 0 : 1000 + Math.floor(k / 2);
    events.push({
      name: "EventTiming",
      ph: "b",
      pid: PID,
      tid: MAIN_TID,
      ts: at(10_000 + k * 40),
      args: { data: { interactionId, duration: int(8, 400), navigationId: NAVIGATION_ID } },
    });
  }

  // Main-thread work: RunTask with nested script, style, layout and paint events.
  const tasks = Math.round(requests / 2);
  let cursor = 0; // ms
  for (let t = 0; t < tasks; t++) {
    cursor += int(2, 40) / 10;
    const long = t % 100 === 0;
    const durMs = long ? int(60, 200) : int(5, 60) / 10;
    const url = urls.length > 0 ? urls[(t * 7) % urls.length] : `https://cdn.example/r/${t}.js`;
    const common = { ph: "X", pid: PID, tid: MAIN_TID };
    events.push({ ...common, name: "RunTask", ts: at(cursor), dur: Math.round(durMs * 1000) });
    const inner = Math.round(durMs * 1000);
    events.push({
      ...common,
      name: "FunctionCall",
      ts: at(cursor),
      dur: Math.round(inner * 0.6),
      args: { data: { url } },
    });
    events.push({
      ...common,
      name: "v8.compile",
      ts: at(cursor),
      dur: Math.round(inner * 0.2),
      args: { fileName: url },
    });
    events.push({
      ...common,
      name: pick(["Layout", "UpdateLayoutTree", "Paint", "ParseHTML", "MinorGC"]),
      ts: at(cursor) + Math.round(inner * 0.62),
      dur: Math.round(inner * 0.3),
    });
    cursor += durMs;
  }

  // Noise on other threads and processes: scans must skip it.
  const noise = requests * 2;
  for (let n = 0; n < noise; n++) {
    events.push({
      name: pick(["RunTask", "ThreadControllerImpl::RunTask", "Receive", "BeginFrame"]),
      ph: "X",
      pid: PID + (n % 3),
      tid: 2 + (n % 5),
      ts: at(int(0, 10_000)),
      dur: int(1, 5000),
    });
  }

  return { traceEvents: events };
}
