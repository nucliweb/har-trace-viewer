import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { harJson, makeCompareFlows, makeFile } from "./fixtures.js";

afterEach(() => {
  delete window.__HTV_FLOW__;
  delete window.__HTV_COMPARE__;
});

// The same HAR with a 320 ms DNS lookup and a 650 ms connection for the document: the latencies
// of a load from China, behind the Great Firewall.
const chinaJson = (() => {
  const har = JSON.parse(harJson);
  har.log.entries[0].timings.dns = 320;
  har.log.entries[0].timings.connect = 650;
  return JSON.stringify(har);
})();

const pane = (side: "A" | "B") => screen.getByRole("region", { name: new RegExp(`^${side} · `) });
const drawsGfw = (side: "A" | "B") => within(pane(side)).queryByText("GFW checkpoint") !== null;
const regionNotices = () =>
  screen.queryAllByRole("status").filter((s) => s.textContent?.includes("Great Firewall"));

async function compare(a: string, b: string) {
  const user = userEvent.setup();
  render(<App />);
  const harInput = document.querySelector<HTMLInputElement>(
    'input[type="file"][accept=".har,.gz"]'
  );
  await user.upload(harInput!, makeFile(a, "a.har"));
  await screen.findByText("a.har");
  const target = screen.getByRole("group", { name: "Compare with…" });
  await user.upload(
    within(target).getByLabelText("HAR file to compare with", { selector: "input" }),
    makeFile(b, "b.har")
  );
  await within(target).findByText("b.har");
  await user.click(screen.getByRole("button", { name: /generate comparison/i }));
  return user;
}

describe("a comparison of loads from different places", () => {
  it("draws the Great Firewall only on the side whose latencies suggest China", async () => {
    await compare(harJson, chinaJson);
    expect(drawsGfw("A")).toBe(false);
    expect(drawsGfw("B")).toBe(true);
  });

  it("explains B's topology in a notice of its own, whose button redraws B alone", async () => {
    const user = await compare(harJson, chinaJson);
    const [notice, ...others] = regionNotices();
    expect(others).toEqual([]);
    expect(notice).toHaveTextContent(/^B · China \/ GFW routing/);

    await user.click(within(notice).getByRole("button", { name: "Show default topology" }));
    expect(drawsGfw("B")).toBe(false);
    expect(drawsGfw("A")).toBe(false);
    expect(
      within(regionNotices()[0]).getByRole("button", { name: "Show GFW topology" })
    ).toBeVisible();
  });

  it("puts the notice on A when A is the load from China", async () => {
    await compare(chinaJson, harJson);
    expect([drawsGfw("A"), drawsGfw("B")]).toEqual([true, false]);
    const notices = regionNotices();
    expect(notices).toHaveLength(1);
    expect(notices[0]).toHaveTextContent(/^A · China \/ GFW routing/);
  });

  it("names B's own flag in a report, which cannot draw the diagram again", () => {
    const [a, b] = makeCompareFlows();
    window.__HTV_FLOW__ = JSON.parse(JSON.stringify(a));
    window.__HTV_COMPARE__ = JSON.parse(
      JSON.stringify({
        ...b,
        clientRegion: "cn",
        hints: { suggestedClientRegion: { region: "cn", reason: "document DNS 663ms" } },
      })
    );
    render(<App />);

    const [notice, ...others] = regionNotices();
    expect(others).toEqual([]);
    expect(notice).toHaveTextContent("B · China / GFW routing");
    expect(notice).toHaveTextContent(
      "Generate the report with --compare-region default to draw the default topology."
    );
  });
});
