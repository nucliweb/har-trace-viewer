import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { generateFlow } from "@htv/core";
import type { Flow } from "@htv/core";
import { TuiApp } from "../src/tui/App";
import {
  criticalCss,
  makeEntry,
  makeHar,
  makeTrace,
  secondaryImage,
  thirdPartyScript,
} from "../../core/tests/helpers/synthetic-har";

const ESC = "\u001B";
const KEYS = { right: `${ESC}[C`, left: `${ESC}[D`, down: `${ESC}[B`, tab: "\t" };

// First view: everything from the network, a versioned bundle that forbids caching.
function firstView(): Flow {
  const har = makeHar(
    [
      criticalCss(100),
      secondaryImage(200),
      thirdPartyScript(300),
      makeEntry({
        url: "https://example.com/app/chunk-47TTPNLV.js",
        startTime: 150,
        transferSize: 20_000,
        responseHeaders: { "cache-control": "no-cache, no-store" },
      }),
    ],
    { onContentLoad: 300, onLoad: 500 }
  );
  return generateFlow([{ name: "First view", har, trace: makeTrace(150, 400) }]);
}

// Repeat view: the stylesheet and the image come from the browser cache.
function repeatView(): Flow {
  const har = makeHar(
    [
      { ...criticalCss(100), fromCache: "disk" as const },
      { ...secondaryImage(200), fromCache: "memory" as const },
    ],
    { onContentLoad: 150, onLoad: 200 }
  );
  return generateFlow([{ name: "Repeat view", har, trace: makeTrace(110, 250) }]);
}

// Lets Ink process input and re-render before the next assertion.
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

async function press(stdin: { write: (data: string) => void }, ...keys: string[]) {
  // Ink subscribes to input in an effect, after the first frame.
  await tick();
  for (const key of keys) {
    stdin.write(key);
    await tick();
  }
}

describe("TuiApp — a flow", () => {
  it("opens on the overview with the version, the tabs and the rated metrics", () => {
    const { lastFrame } = render(<TuiApp flow={firstView()} version="9.9.9" rows={40} />);
    const frame = lastFrame()!;

    expect(frame).toContain("htv v9.9.9");
    expect(frame).toContain("First view");
    expect(frame).toMatch(/1 Overview.*2 Steps.*3 Hosts.*4 Cache/);
    // TTFB from the navigation start (dns 10 + connect 20 + send 1 + wait 50) and the wait alone.
    expect(frame).toMatch(/TTFB \(from navigation\)\s+81 ms/);
    expect(frame).toMatch(/Server wait\s+50 ms/);
    expect(frame).toMatch(/LCP\s+400 ms/);
    expect(frame).toMatch(/onLoad\s+500 ms/);
  });

  it("walks the steps with the arrow keys, showing the route and the step metrics", async () => {
    const flow = firstView();
    const { lastFrame, stdin } = render(<TuiApp flow={flow} version="1.0.0" rows={40} />);

    await press(stdin, "2");
    expect(lastFrame()).toContain(`Step 1 / ${flow.steps.length}`);
    expect(lastFrame()).toContain(flow.steps[0].title);

    await press(stdin, KEYS.right, KEYS.right);
    expect(lastFrame()).toContain(`Step 3 / ${flow.steps.length}`);
    expect(lastFrame()).toContain(flow.steps[2].title);
    expect(lastFrame()).toContain("Browser →");

    await press(stdin, KEYS.left);
    expect(lastFrame()).toContain(`Step 2 / ${flow.steps.length}`);
  });

  it("windows the step list around the selected step on a short terminal", async () => {
    const flow = firstView();
    const { lastFrame, stdin } = render(<TuiApp flow={flow} version="1.0.0" rows={12} />);

    await press(stdin, "2");
    expect(lastFrame()).toContain("▸  1  DNS + initial connection");
    expect(lastFrame()).not.toContain("Page loaded");

    await press(stdin, ...Array(flow.steps.length).fill(KEYS.right));
    expect(lastFrame()).toContain(`▸  ${flow.steps.length}  Page loaded`);
    expect(lastFrame()).not.toContain("1  DNS + initial connection");
  });

  it("lists the hosts with their requests, TTFB and provider", async () => {
    const { lastFrame, stdin } = render(<TuiApp flow={firstView()} version="1.0.0" rows={40} />);

    await press(stdin, "3");
    expect(lastFrame()).toMatch(/example\.com\s+4\s/);
    expect(lastFrame()).toContain("cdn.third.com");
  });

  it("shows the median TTFB per host, before and after onLoad, and the connection cost", async () => {
    const har = makeHar([
      criticalCss(100),
      makeEntry({
        url: "http://plain.example.org/a.js",
        timing: { dns: 5, connect: 15, ssl: 0, send: 1, wait: 30, receive: 5, blocked: 0 },
        ttfb: 30,
      }),
      makeEntry({ url: "http://plain.example.org/b.js", startTime: 900, ttfb: 70 }),
    ]);
    har.entries[2].timing.notApplicable = ["ssl"];
    const flow = generateFlow([{ name: "Hosts", har }]);
    const { lastFrame, stdin } = render(
      <TuiApp flow={flow} version="1.0.0" rows={40} columns={200} />
    );

    await press(stdin, "3");
    const frame = lastFrame()!;
    expect(frame).toMatch(/Median TTFB\s+After onLoad\s+DNS \/ TCP \/ TLS/);
    expect(frame).toMatch(
      /plain\.example\.org\s+2\s+0\s+\S+ \S+\s+30 ms\s+70 ms\s+5 ms \/ 15 ms \/ n\/a/
    );
  });

  it("says when every request to a host reused a connection", async () => {
    const { lastFrame, stdin } = render(
      <TuiApp flow={firstView()} version="1.0.0" rows={40} columns={200} />
    );

    await press(stdin, "3");
    expect(lastFrame()).toMatch(/cdn\.third\.com.*reused/);
  });

  it("captions the third parties with their median TTFB", () => {
    const { lastFrame } = render(<TuiApp flow={firstView()} version="1.0.0" rows={40} />);

    expect(lastFrame()).toMatch(/3rd Parties\s+1 · median TTFB 10 ms/);
  });

  it("counts browser-cache hits apart from the requests that reached each host", async () => {
    const { lastFrame, stdin } = render(<TuiApp flow={repeatView()} version="1.0.0" rows={40} />);

    await press(stdin, "3");
    expect(lastFrame()).toMatch(/Host\s+Requests\s+Cached/);
    expect(lastFrame()).toMatch(/example\.com\s+1\s+2\s+/);
  });

  it("shows the cache recommendations with the resources they name", async () => {
    const { lastFrame, stdin } = render(<TuiApp flow={firstView()} version="1.0.0" rows={60} />);

    await press(stdin, "4");
    const frame = lastFrame()!;
    expect(frame).toContain("Versioned assets are not cached");
    expect(frame).toMatch(/chunk-47TTPNLV\.js\s+20 KB\s+no-cache, no-store/);
  });

  it("lists the network findings next to the cache report, with what went wrong", async () => {
    const har = makeHar([
      makeEntry({ url: "https://example.com/missing.js", status: 404, transferSize: 450 }),
      makeEntry({ url: "https://example.com/app.js", startTime: 120, transferSize: 9_000 }),
      makeEntry({ url: "https://example.com/app.js", startTime: 240, transferSize: 9_000 }),
    ]);
    const flow = generateFlow([{ name: "Broken", har }]);
    const { lastFrame, stdin } = render(
      <TuiApp flow={flow} version="1.0.0" rows={80} columns={120} />
    );

    await press(stdin, "4");
    const frame = lastFrame()!;
    expect(frame).toMatch(/4 Cache & network/);
    expect(frame).toContain("Network");
    expect(frame).toContain("1 request failed (4xx)");
    expect(frame).toContain("1 resource · 450 B");
    expect(frame).toMatch(/missing\.js\s+450 B\s+404/);
    expect(frame).toContain("1 resource downloaded more than once");
    expect(frame).toMatch(/app\.js\s+9\.0 KB\s+fetched 2×/);
  });

  it("says when the network report found nothing", async () => {
    const { lastFrame, stdin } = render(
      <TuiApp flow={repeatView()} version="1.0.0" rows={80} columns={120} />
    );

    await press(stdin, "4");
    expect(lastFrame()).toContain("No duplicate requests, redirects, errors or mixed content");
  });

  it("cycles the tabs with Tab", async () => {
    const { lastFrame, stdin } = render(<TuiApp flow={firstView()} version="1.0.0" rows={40} />);

    await press(stdin, KEYS.tab);
    expect(lastFrame()).toContain("Step 1 /");
  });

  it("scrolls a tab taller than the terminal", async () => {
    const { lastFrame, stdin } = render(<TuiApp flow={firstView()} version="1.0.0" rows={10} />);

    await press(stdin, "4");
    expect(lastFrame()).toContain("Document");
    await press(stdin, ...Array(60).fill(KEYS.down));
    expect(lastFrame()).not.toContain("Document");
    expect(lastFrame()).toContain("chunk-47TTPNLV.js");
  });
});

describe("TuiApp — a comparison", () => {
  it("compares the metrics of A and B with the deltas and their notes", () => {
    const { lastFrame } = render(
      <TuiApp flow={firstView()} compare={repeatView()} version="1.0.0" rows={50} />
    );
    const frame = lastFrame()!;

    expect(frame).toContain("A First view");
    expect(frame).toContain("B Repeat view");
    expect(frame).toMatch(/onLoad\s+500 ms\s+200 ms\s+−300 ms\s+−60%/);
    expect(frame).toMatch(/Requests\s+5\s+1\s+−4/);
    expect(frame).toMatch(/Browser cache hits\s+0\s+2\s+\+2/);
    expect(frame).toContain("B made 4 fewer network requests than A (5 → 1)");
  });

  it("pairs the steps of both flows by kind", async () => {
    const { lastFrame, stdin } = render(
      <TuiApp flow={firstView()} compare={repeatView()} version="1.0.0" rows={50} />
    );

    await press(stdin, "2");
    expect(lastFrame()).toMatch(/A\s+DNS \+ initial connection/);
    expect(lastFrame()).toMatch(/B\s+DNS \+ initial connection/);
  });

  it("joins the hosts with the TTFB delta over the same URLs", async () => {
    const { lastFrame, stdin } = render(
      <TuiApp flow={firstView()} compare={repeatView()} version="1.0.0" rows={50} />
    );

    await press(stdin, "3");
    expect(lastFrame()).toContain("Same URLs");
    expect(lastFrame()).toMatch(/cdn\.third\.com\s+1\s+0\s+−1/);
  });

  it("switches the cache report between A and B", async () => {
    const { lastFrame, stdin } = render(
      <TuiApp flow={firstView()} compare={repeatView()} version="1.0.0" rows={60} />
    );

    await press(stdin, "4");
    expect(lastFrame()).toContain("Cache · A First view");
    expect(lastFrame()).toContain("Versioned assets are not cached");
    await press(stdin, "b");
    expect(lastFrame()).toContain("Cache · B Repeat view");
    expect(lastFrame()).toMatch(/Hit ratio\s+100% \(2\/2\)/);
  });
});

describe("TuiApp — a flow of several pages", () => {
  it("moves the steps, hosts and cache to the next page with p", async () => {
    const first = makeHar([criticalCss(100)]);
    const second = {
      ...makeHar([makeEntry({ url: "https://shop.example.com/cart.css" })]),
    };
    second.documentEntry.url = "https://shop.example.com/cart";
    const flow = generateFlow([
      { name: "Home", har: first },
      { name: "Cart", har: second },
    ]);
    const { lastFrame, stdin } = render(<TuiApp flow={flow} version="1.0.0" rows={40} />);

    expect(lastFrame()).toMatch(/Home\s+Cart/);
    await press(stdin, "3");
    expect(lastFrame()).toContain("Page 1 / 2 · Home");
    await press(stdin, "p");
    expect(lastFrame()).toContain("Page 2 / 2 · Cart");
  });
});
