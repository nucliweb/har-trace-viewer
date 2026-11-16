import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { analyzeCacheForHar } from "@htv/core";
import { CachePanel } from "../src/components/CachePanel.js";
import { makeHar } from "../../core/tests/helpers/synthetic-har";

/** A page whose document answers with these headers. */
function renderDocument(headers: Record<string, string>) {
  const har = makeHar([]);
  har.documentEntry = { ...har.documentEntry!, responseHeaders: headers };
  har.entries[0] = har.documentEntry;
  render(
    <CachePanel report={analyzeCacheForHar(har)} pageLabel="Page" onClose={() => undefined} />
  );
}

const row = (label: string) => screen.getByText(label).closest("div")!;

const MINUTE = 60;
const HOUR = 3_600;
const DAY = 86_400;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

describe("CachePanel document freshness", () => {
  it.each([
    ["seconds", 45, "45s"],
    ["whole minutes", 5 * MINUTE, "5m"],
    ["minutes and seconds", 5 * MINUTE + 30, "5m 30s"],
    ["whole hours", 2 * HOUR, "2h"],
    ["hours and minutes", 2 * HOUR + 15 * MINUTE, "2h 15m"],
    ["whole days", 3 * DAY, "3d"],
    ["days and hours", 3 * DAY + 4 * HOUR, "3d 4h"],
    ["whole months", 2 * MONTH, "2mo"],
    ["months and days", 2 * MONTH + 5 * DAY, "2mo 5d"],
    ["whole years", YEAR, "1y"],
    ["years and months", YEAR + 2 * MONTH, "1y 2mo"],
  ])("writes a max-age of %s as %s", (_case, seconds, text) => {
    renderDocument({ "cache-control": `public, max-age=${seconds}` });

    expect(row("max-age")).toHaveTextContent(text);
  });

  it("says a max-age of 0 means no browser cache", () => {
    renderDocument({ "cache-control": "max-age=0" });

    expect(row("max-age")).toHaveTextContent("0 (no browser cache)");
  });

  it("shows a dash for a document without a max-age", () => {
    renderDocument({});

    expect(row("max-age")).toHaveTextContent("—");
  });

  it("writes the CDN Age in the same units, with the seconds as its tooltip", () => {
    renderDocument({ age: String(2 * HOUR + 15 * MINUTE) });

    const age = row("CDN Age").lastElementChild!;
    expect(age).toHaveTextContent("2h 15m");
    expect(age).toHaveAttribute("title", "8100s");
  });
});
