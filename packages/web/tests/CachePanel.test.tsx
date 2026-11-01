import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { analyzeCacheForHar, analyzeNetwork } from "@htv/core";
import { CachePanel } from "../src/components/CachePanel.js";
import { makeEntry, makeHar } from "../../core/tests/helpers/synthetic-har";

const renderPanel = (har: ReturnType<typeof makeHar>) =>
  render(
    <CachePanel report={analyzeCacheForHar(har)} pageLabel="Page" onClose={() => undefined} />
  );

const row = (label: string) => screen.getByText(label).closest("div")!;

describe("CachePanel", () => {
  it("counts the browser-cache hits inferred from WebPageTest and says so", () => {
    renderPanel({
      ...makeHar([makeEntry()]),
      inferredCacheHits: [
        {
          url: "https://example.com/a.js",
          resourceType: "script",
          transferSize: 900,
          lifetime: 600,
        },
      ],
    });

    expect(row("Hit ratio")).toHaveTextContent("50% (1/2)");
    expect(row("Inferred (WebPageTest)")).toHaveTextContent("1");
    expect(screen.getByText("Browser cache hits inferred from WebPageTest")).toBeInTheDocument();
  });

  it("counts CDN hits over the own resources that reached the network", () => {
    const hit = { "x-vercel-cache": "HIT" };
    renderPanel(
      makeHar([
        makeEntry({ responseHeaders: hit, fromCache: "disk" }),
        makeEntry({ responseHeaders: hit }),
        makeEntry({ responseHeaders: { "x-vercel-cache": "MISS" } }),
      ])
    );

    expect(row("CDN hits")).toHaveTextContent("1/2 50%");
  });

  it("shows no CDN hit ratio when the browser cache served every own resource", () => {
    renderPanel(
      makeHar([makeEntry({ responseHeaders: { "x-vercel-cache": "HIT" }, fromCache: "disk" })])
    );

    expect(row("CDN hits")).toHaveTextContent("—");
  });

  it("shows the 304 revalidations next to the hits", () => {
    renderPanel(makeHar([makeEntry({ status: 304 }), makeEntry()]));

    expect(row("Revalidated (304)")).toHaveTextContent("1");
  });

  it("lists the resources a recommendation names, with their size and Cache-Control", async () => {
    const user = userEvent.setup();
    renderPanel(
      makeHar([
        makeEntry({
          url: "https://example.com/app/chunk-47TTPNLV.js",
          transferSize: 20_000,
          responseHeaders: { "cache-control": "no-store" },
        }),
        makeEntry({
          url: "https://example.com/app/styles-VC4FUF6G.css",
          transferSize: 30_000,
          responseHeaders: { "cache-control": "no-cache, no-store" },
        }),
      ])
    );

    const toggle = screen.getByText("2 resources · 50 KB");
    await user.click(toggle);
    const items = within(toggle.closest("details")!).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      "styles-VC4FUF6G.css30 KBno-cache, no-store",
      "chunk-47TTPNLV.js20 KBno-store",
    ]);
    expect(within(items[0]).getByText("styles-VC4FUF6G.css")).toHaveAttribute(
      "title",
      "https://example.com/app/styles-VC4FUF6G.css"
    );
  });
});

describe("CachePanel — network", () => {
  const renderWithNetwork = (har: ReturnType<typeof makeHar>) =>
    render(
      <CachePanel
        report={analyzeCacheForHar(har)}
        network={analyzeNetwork(har)}
        pageLabel="Page"
        onClose={() => undefined}
      />
    );

  it("lists the network findings with the resources they name and what went wrong", async () => {
    const user = userEvent.setup();
    renderWithNetwork(
      makeHar([
        makeEntry({ url: "https://example.com/api/cart", status: 500, transferSize: 380 }),
        makeEntry({ url: "https://example.com/app.js", startTime: 120, transferSize: 9_000 }),
        makeEntry({ url: "https://example.com/app.js", startTime: 240, transferSize: 9_000 }),
      ])
    );

    const section = screen.getByRole("region", { name: "Network" });
    expect(within(section).getByText("1 server error (5xx)")).toBeInTheDocument();
    expect(within(section).getByText("1 resource downloaded more than once")).toBeInTheDocument();

    const toggle = within(section).getByText("1 resource · 380 B");
    await user.click(toggle);
    const items = within(toggle.closest("details")!).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["cart380 B500"]);
  });

  it("says when the network report found nothing", () => {
    renderWithNetwork(makeHar([makeEntry()]));

    expect(
      within(screen.getByRole("region", { name: "Network" })).getByText(
        "No duplicate requests, redirects, errors or mixed content."
      )
    ).toBeInTheDocument();
  });

  it("leaves the network section out of a flow generated without a network report", () => {
    renderPanel(makeHar([makeEntry()]));

    expect(screen.queryByRole("region", { name: "Network" })).not.toBeInTheDocument();
  });
});
