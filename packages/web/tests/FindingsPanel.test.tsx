import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { collectFindings, generateFlow } from "@htv/core";
import { FindingsPanel } from "../src/components/FindingsPanel.js";
import { makeEntry, makeHar, makeTrace } from "../../core/tests/helpers/synthetic-har";

// Five missing scripts and assets without long-term caching (warnings), a poor LCP and a
// versioned bundle without cache (critical).
function findings() {
  const missing = [1, 2, 3, 4, 5].map((n) =>
    makeEntry({ url: `https://example.com/missing-${n}.js`, status: 404, transferSize: 100 * n })
  );
  const har = makeHar([
    ...missing,
    makeEntry({
      url: "https://example.com/app/chunk-47TTPNLV.js",
      transferSize: 20_000,
      responseHeaders: { "cache-control": "no-store" },
    }),
  ]);
  // The synthetic responses carry no Content-Encoding, which the compression report flags:
  // leave that source out so the panel's groups stay the ones this file describes.
  return collectFindings(
    generateFlow([{ name: "Home", har, trace: makeTrace(900, 5_200) }])
  ).filter((f) => f.source !== "compression");
}

const group = (name: string) => screen.getByRole("region", { name: new RegExp(`^${name}`) });

describe("FindingsPanel", () => {
  it("groups the findings by severity, worst first, with their counts", () => {
    render(
      <FindingsPanel findings={findings()} pageLabel="Page 1 · Home" onClose={() => undefined} />
    );

    expect(screen.getByText("Page 1 · Home")).toBeInTheDocument();
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(["Critical2", "Warnings2"]);
    expect(within(group("Critical")).getByText("LCP is poor: 5.2 s")).toBeInTheDocument();
  });

  it("shows the metric, the summary, what to do and the evidence of each finding", () => {
    render(<FindingsPanel findings={findings()} pageLabel="Home" onClose={() => undefined} />);
    const finding = screen.getByText("Versioned assets are not cached").closest("li")!;

    expect(finding).toHaveTextContent("transfer · high confidence · cache");
    expect(finding).toHaveTextContent("1 versioned asset is served with no-store");
    expect(finding).toHaveTextContent("Its URL changes whenever its content does");
    expect(
      within(finding).getByTitle("https://example.com/app/chunk-47TTPNLV.js")
    ).toHaveTextContent("chunk-47TTPNLV.js");
  });

  it("lists three evidence rows and keeps the rest behind a count", async () => {
    const user = userEvent.setup();
    render(<FindingsPanel findings={findings()} pageLabel="Home" onClose={() => undefined} />);
    const finding = screen.getByText("5 requests failed (4xx)").closest("li")!;

    expect(within(finding).getByText("missing-3.js")).toBeVisible();
    expect(within(finding).getByText("missing-4.js")).not.toBeVisible();
    await user.click(within(finding).getByText("2 more"));
    expect(within(finding).getByText("missing-4.js")).toBeVisible();
  });

  it("says when the page has no findings", () => {
    render(<FindingsPanel findings={[]} pageLabel="Home" onClose={() => undefined} />);
    expect(screen.getByText("No findings for this page.")).toBeInTheDocument();
  });

  it("closes with its close button", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<FindingsPanel findings={findings()} pageLabel="Home" onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Close findings" }));
    expect(onClose).toHaveBeenCalled();
  });
});
