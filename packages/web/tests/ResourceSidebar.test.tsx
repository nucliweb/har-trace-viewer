import { render, screen } from "@testing-library/react";
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
