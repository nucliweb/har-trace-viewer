import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ExportMenu } from "../src/components/ExportMenu.js";
import { makeFlow } from "./fixtures.js";

function setup(collectFonts: () => Promise<string>) {
  const download = vi.fn();
  const container = document.createElement("div");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("id", "diagram-svg");
  svg.setAttribute("viewBox", "0 0 800 400");
  container.appendChild(svg);
  document.body.appendChild(container);
  render(
    <ExportMenu
      flow={makeFlow()}
      containerRef={{ current: container }}
      pageName="Home"
      stepNumber={1}
      download={download}
      collectFonts={collectFonts}
    />
  );
  return download;
}

describe("ExportMenu image export failure", () => {
  it("says the export failed, downloads nothing and keeps the menu usable", async () => {
    const user = userEvent.setup();
    const download = setup(() => Promise.reject(new Error("fonts blocked")));

    await user.click(screen.getByRole("button", { name: "Export" }));
    await user.click(screen.getByRole("menuitem", { name: "Download SVG" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Export failed");
    expect(download).not.toHaveBeenCalled();
    const button = screen.getByRole("button", { name: "Export" });
    expect(button).toBeEnabled();
  });

  it("returns focus to the Export button after an image export", async () => {
    const user = userEvent.setup();
    setup(() => Promise.reject(new Error("fonts blocked")));

    await user.click(screen.getByRole("button", { name: "Export" }));
    await user.click(screen.getByRole("menuitem", { name: "Download SVG" }));
    await screen.findByRole("alert");

    expect(screen.getByRole("button", { name: "Export" })).toHaveFocus();
  });

  it("clears the failure when the next export succeeds", async () => {
    const user = userEvent.setup();
    let attempt = 0;
    const download = setup(async () => {
      if (attempt++ === 0) throw new Error("fonts blocked");
      return "";
    });

    await user.click(screen.getByRole("button", { name: "Export" }));
    await user.click(screen.getByRole("menuitem", { name: "Download SVG" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Export" }));
    await user.click(screen.getByRole("menuitem", { name: "Download SVG" }));

    expect(download).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
