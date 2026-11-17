import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { generateFlow, pageDocument } from "@htv/core";
import { makeEntry, makeHar, makeTrace } from "../../core/tests/helpers/synthetic-har";
import type { Flow, PageAnalysis } from "@htv/core";
import { AnalysisPanel } from "../src/components/AnalysisPanel.js";
import type { AnalysisView } from "../src/lib/view-state.js";
import { analysisJourney, analysisPage } from "./analysis-flow.js";
import { makeFirefoxFlow } from "./firefox-flow.js";

const journey = analysisJourney();

function panel(
  view: AnalysisView,
  {
    flow = journey,
    page = 0,
    analysis,
  }: { flow?: Flow; page?: number; analysis?: PageAnalysis } = {}
) {
  const onViewChange = vi.fn();
  const { har, trace } = flow.pages[page];
  const { unmount } = render(
    <AnalysisPanel
      view={view}
      onViewChange={onViewChange}
      analysis={analysis ?? flow.pageAnalyses[page]}
      hasDocument={pageDocument(har) !== null}
      hasTrace={trace !== undefined}
      pageLabel={`Page ${page + 1} · ${flow.pages[page].name}`}
      onClose={() => undefined}
    />
  );
  return { onViewChange, unmount };
}

const rowsOf = (name: string | RegExp) =>
  within(screen.getByRole("table", { name }))
    .getAllByRole("row")
    .slice(1)
    .map((row) => row.textContent);

const details = () => screen.getByRole("region", { name: "Analysis details" });

describe("AnalysisPanel: the drawer", () => {
  it("names the analysis and the page, and switches between its four views", async () => {
    const user = userEvent.setup();
    const { onViewChange } = panel("connections");
    expect(
      screen.getByRole("heading", { level: 2, name: "Analysis Page 1 · Home" })
    ).toBeInTheDocument();
    const views = screen.getByRole("group", { name: "Analysis views" });
    const buttons = within(views).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual([
      "Connections",
      "Compression",
      "Render",
      "Critical path",
    ]);
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual([
      "true",
      "false",
      "false",
      "false",
    ]);
    await user.click(buttons[3]);
    expect(onViewChange).toHaveBeenCalledWith("critical-path");
  });

  it("says a report generated before a view existed lacks it, instead of showing it empty", () => {
    const analysis = { ...journey.pageAnalyses[0] };
    delete analysis.connectionsReport;
    panel("connections", { analysis });
    expect(details()).toHaveTextContent(/generated before HTV measured this/);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("AnalysisPanel: connections", () => {
  it("lists each host's protocol, connections, handshakes, HTTP/3 and cookies", () => {
    panel("connections");
    expect(details()).toHaveTextContent("3 hosts · 6 network requests");
    expect(rowsOf("Connections per host")).toEqual([
      "example.comh2313111——",
      "static.example.comh1221222—3.0 KB (largest 1.5 KB)",
      "cdn.third.comh3111111yes—",
    ]);
  });

  it("lists the document's Server-Timing metrics", () => {
    panel("connections");
    expect(rowsOf("Server-Timing")).toEqual(["db53 msDatabase", "cachen/aHIT"]);
  });

  it("says what the HAR does not record instead of counting zero connections", () => {
    panel("connections", { flow: journey, page: 1 });
    const text = details().textContent;
    expect(text).toContain("The HAR does not record the HTTP version of these requests.");
    expect(text).toContain("The HAR has no connection ids");
    expect(rowsOf("Connections per host")[0]).toMatch(/^api\.example\.comn\/a3n\/an\/a/);
    expect(text).toContain("No HTML document: no Server-Timing to read.");
  });

  it("says when no request reached the network, and names a host of several HTTP versions", () => {
    const analysis = { ...journey.pageAnalyses[0] };
    const report = analysis.connectionsReport!;
    analysis.connectionsReport = { ...report, hosts: [] };
    const { unmount } = panel("connections", { analysis });
    expect(details()).toHaveTextContent(
      "No request reached the network: the browser cache served every resource."
    );
    unmount();

    analysis.connectionsReport = {
      ...report,
      hosts: [{ ...report.hosts[0], protocol: "mixed" }],
    };
    panel("connections", { analysis });
    expect(rowsOf("Connections per host")[0]).toMatch(/^example\.commixed3/);
  });

  it("says the document sent no Server-Timing when it sent none", () => {
    panel("connections", { flow: makeFirefoxFlow() });
    expect(details()).toHaveTextContent("The document sent no Server-Timing header.");
  });
});

describe("AnalysisPanel: compression", () => {
  it("adds up what could be saved, and shows the bytes per type behind it", () => {
    panel("compression");
    expect(details()).toHaveTextContent(/About 77 KB could be saved/);
    expect(rowsOf("Text responses by type")).toEqual([
      "CSS1none 150 KB50 KB",
      "JS1gzip 160 KB20 KB",
      "HTML1br 130 KB8.0 KB",
    ]);
  });

  it("lists the responses and images each saving comes from", () => {
    panel("compression");
    expect(rowsOf("Sent uncompressed")).toEqual(["app.cssCSS50 KB50 KB~35 KB"]);
    expect(rowsOf("Gzip or deflate only")).toEqual(["tag.jsJSgzip20 KB~3.0 KB"]);
    expect(rowsOf("Images by format")).toEqual(["jpeg1100 KB", "png130 KB"]);
    expect(rowsOf("JPEG and PNG a modern format would shrink")).toEqual([
      "hero.jpgjpeg100 KB~30 KB~50 KB",
      "thumb.pngpng30 KB~9.0 KB~15 KB",
    ]);
    // Nothing double-encoded: the section says so rather than showing an empty table.
    const encoded = screen.getByRole("heading", { name: "Images sent with a Content-Encoding" });
    expect(encoded.nextElementSibling).toHaveTextContent("None.");
  });

  it("lists images sent with a Content-Encoding, and says when nothing is left to save", () => {
    const image = makeEntry({
      url: "https://example.com/photo.webp",
      mimeType: "image/webp",
      resourceType: "image",
      contentEncoding: "gzip",
      transferSize: 5_000,
      bodySize: 5_000,
    });
    const har = makeHar([image]);
    har.documentEntry.contentEncoding = "br";
    panel("compression", { flow: generateFlow([{ name: "Images", har }]) });
    expect(details()).toHaveTextContent("Nothing left to save by compression or image format.");
    expect(rowsOf("Images sent with a Content-Encoding")).toEqual(["photo.webpwebpgzip5.0 KB"]);
  });

  it("says when no body was downloaded, instead of a zero saving", () => {
    const analysis = { ...journey.pageAnalyses[0] };
    analysis.compressionReport = {
      byType: [],
      uncompressed: [],
      gzipOnly: [],
      images: { byFormat: [], legacy: [], encoded: [] },
      potentialSavings: 0,
      recommendations: [],
    };
    panel("compression", { analysis });
    expect(details()).toHaveTextContent(/No response body was downloaded over the network/);
    expect(details()).not.toHaveTextContent(/could be saved/);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("AnalysisPanel: render", () => {
  it("breaks the LCP down into its phases and names its resource", () => {
    panel("render");
    expect(details()).toHaveTextContent("LCP 600 ms · IMG (image)");
    expect(rowsOf("LCP phases")).toEqual([
      "TTFB81 ms14%",
      "Resource load delay219 ms37%",
      "Resource load duration50 ms8%",
      "Element render delay250 ms42%",
    ]);
    expect(details()).toHaveTextContent(
      "The trace has no request for the LCP image: the HAR times it."
    );
    expect(screen.getByText("hero.jpg")).toHaveAttribute(
      "title",
      "https://static.example.com/hero.jpg"
    );
  });

  it("lists what held the first paint, and where the blocking status comes from", () => {
    panel("render");
    expect(details()).toHaveTextContent(
      "Inferred from the HAR's initiators and priorities: no trace gives the status."
    );
    expect(details()).toHaveTextContent("2 resources · 70 KB · held the first paint 215 ms");
    expect(details()).toHaveTextContent("FCP 400 ms");
    expect(rowsOf("Render-blocking resources")).toEqual([
      "app.cssstylesheetinferredFirst50 KB90 ms150 ms",
      "tag.jsscriptinferredThird20 KB95 ms295 ms",
    ]);
  });

  it("says a page without a trace has no LCP and no FCP, instead of showing zeros", () => {
    panel("render", { flow: generateFlow([analysisPage(false)]) });
    const text = details().textContent;
    expect(text).toContain("No trace: the LCP and its phases come from a Chrome trace");
    expect(text).toContain("FCP n/a without a trace");
    expect(text).toContain("no FCP caps it");
    expect(screen.queryByRole("table", { name: "LCP phases" })).not.toBeInTheDocument();
  });

  it("names a text LCP, and says when the trace has no candidate or nothing blocks", () => {
    // The HAR records initiators, and the one request it makes blocks nothing.
    const image = makeEntry({
      url: "https://example.com/late.png",
      mimeType: "image/png",
      resourceType: "image",
      priority: "Low",
      initiator: { type: "parser", url: "https://example.com/" },
    });
    const har = makeHar([image]);
    const text = generateFlow([
      {
        name: "Text",
        har,
        trace: { ...makeTrace(300, 450), lcpCandidate: { timeMs: 450, type: "text" } },
      },
    ]);
    const { unmount } = panel("render", { flow: text });
    expect(details()).toHaveTextContent("LCP 450 ms");
    expect(details()).toHaveTextContent("The LCP element is text: it has no resource to load.");
    expect(details()).toHaveTextContent("Nothing but the document blocks the first paint.");
    unmount();

    panel("render", { flow: generateFlow([{ name: "No LCP", har, trace: makeTrace(300, null) }]) });
    expect(details()).toHaveTextContent("The trace has no LCP candidate.");
  });

  it("says an API capture paints nothing", () => {
    panel("render", { page: 1 });
    expect(details()).toHaveTextContent(/This page has no HTML document/);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("says when neither the trace nor the HAR records what blocks rendering", () => {
    panel("render", { flow: makeFirefoxFlow() });
    expect(details()).toHaveTextContent(
      /Neither the trace nor the HAR records which requests block rendering/
    );
    expect(
      screen.queryByRole("table", { name: "Render-blocking resources" })
    ).not.toBeInTheDocument();
  });
});

describe("AnalysisPanel: critical path", () => {
  it("lists each chain from the document, the longest first", () => {
    panel("critical-path");
    expect(details()).toHaveTextContent("2 chains · the deepest is 3 requests, 200 ms");
    expect(rowsOf("Chain 1: 3 requests · 200 ms · 78 KB")).toEqual([
      "1example.comdocument8.0 KB0 ms80 ms",
      "2app.cssstylesheet50 KB90 ms150 ms",
      "3font.woff2font20 KB160 ms200 ms",
    ]);
    expect(rowsOf("Chain 2: 2 requests · 295 ms · 28 KB")).toHaveLength(2);
  });

  it("says an API capture has no critical path", () => {
    panel("critical-path", { page: 1 });
    expect(details()).toHaveTextContent(/This page has no HTML document/);
  });

  it("says when nothing chains from the document", () => {
    const analysis = { ...journey.pageAnalyses[0] };
    const report = analysis.renderReport!;
    analysis.renderReport = { ...report, renderBlocking: { ...report.renderBlocking, chains: [] } };
    panel("critical-path", { analysis });
    expect(details()).toHaveTextContent(
      "No critical chain: nothing beyond the document blocks the first paint."
    );
  });

  it("says when neither the trace nor the HAR records what blocks rendering", () => {
    panel("critical-path", { flow: makeFirefoxFlow() });
    expect(details()).toHaveTextContent(
      /Neither the trace nor the HAR records which requests block rendering/
    );
  });
});
