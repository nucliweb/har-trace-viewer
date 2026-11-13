import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { HarEntry } from "@htv/core";
import { ResourceSidebar } from "../src/components/ResourceSidebar.js";

function entry(url: string, over: Partial<HarEntry> = {}): HarEntry {
  return {
    url,
    startTime: 100,
    duration: 100,
    timing: { dns: 0, connect: 0, ssl: 0, send: 0, wait: 50, receive: 0, blocked: 0 },
    ttfb: 50,
    status: 200,
    mimeType: "application/javascript",
    resourceType: "script",
    priority: "Low",
    responseHeaders: {},
    transferSize: 2000,
    bodySize: 2000,
    isDocument: false,
    fromCache: false,
    ...over,
  };
}

describe("ResourceSidebar preconnect tip", () => {
  const sidebar = (resources: HarEntry[]) =>
    render(
      <ResourceSidebar
        resources={resources}
        title="Third-party scripts"
        onClose={() => undefined}
        documentHostname="www.example.com"
        renderDeadline={400}
      />
    );

  it("suggests the host of a render-critical font, not the tag manager", () => {
    sidebar([
      entry("https://www.googletagmanager.com/gtm.js?id=GTM-XXXX", { priority: "High" }),
      entry("https://fonts.gstatic.com/s/inter.woff2", {
        resourceType: "font",
        mimeType: "font/woff2",
        priority: "VeryHigh",
      }),
    ]);

    const tip = screen.getByText(/Consider preconnecting/);
    expect(tip).toHaveTextContent("fonts.gstatic.com");
    expect(tip).not.toHaveTextContent("googletagmanager");
  });

  it("gives no tip when only analytics and async scripts come from other hosts", () => {
    sidebar([
      entry("https://www.googletagmanager.com/gtm.js?id=GTM-XXXX"),
      entry("https://cdn.debugbear.com/rum.js"),
    ]);

    expect(screen.queryByText(/preconnect/i)).toBeNull();
  });
});

describe("ResourceSidebar on a large page", () => {
  it("lists 200 rows of a type at a time, with a button for the next ones", async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 450 }, (_, i) =>
      entry(`https://cdn.example.com/asset-${i}.js`)
    );
    const { container } = render(
      <ResourceSidebar resources={many} title="All resources" overview onClose={() => undefined} />
    );
    const rows = () =>
      container.querySelectorAll('[title^="https://cdn.example.com/asset-"]').length;

    expect(screen.getByText("450 resources")).toBeInTheDocument();
    expect(rows()).toBe(200);
    await user.click(screen.getByRole("button", { name: "Show 200 more (250 left)" }));
    expect(rows()).toBe(400);
    await user.click(screen.getByRole("button", { name: "Show 50 more (50 left)" }));
    expect(rows()).toBe(450);
    expect(screen.queryByRole("button", { name: /Show \d+ more/ })).toBeNull();
  });
});

describe("ResourceSidebar paging", () => {
  it("keeps an expanded list expanded when the parent re-renders with the same data", async () => {
    const resources = Array.from({ length: 250 }, (_, i) =>
      entry(`https://cdn.example.com/${i}.js`)
    );
    const ui = (title: string) => (
      <ResourceSidebar resources={resources} title={title} onClose={() => undefined} />
    );
    const { rerender } = render(ui("First"));
    await userEvent.click(screen.getByRole("button", { name: /show \d+ more/i }));
    expect(screen.queryByRole("button", { name: /show \d+ more/i })).toBeNull();

    rerender(ui("Second"));

    expect(screen.queryByRole("button", { name: /show \d+ more/i })).toBeNull();
  });
});
