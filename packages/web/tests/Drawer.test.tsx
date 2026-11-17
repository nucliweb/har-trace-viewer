import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Drawer, DrawerBody } from "../src/components/Drawer.js";

describe("Drawer", () => {
  it("names the heading by its title and subtitle", () => {
    render(
      <Drawer title="Findings" subtitle="Page 1 · Home" width="560px">
        <DrawerBody label="Findings details">content</DrawerBody>
      </Drawer>
    );

    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading).toHaveTextContent("Findings Page 1 · Home");
  });

  it("shows a note beside the title, outside the heading", () => {
    render(
      <Drawer title="Resources" note="12 resources" width="480px">
        <DrawerBody label="Resources">content</DrawerBody>
      </Drawer>
    );

    expect(screen.getByRole("heading", { level: 2 })).toHaveAccessibleName("Resources");
    expect(screen.getByText("12 resources")).toBeInTheDocument();
  });

  it("closes from a labelled button", async () => {
    const onClose = vi.fn();
    render(
      <Drawer title="Hops" closeLabel="Close hops" onClose={onClose} width="1160px">
        <DrawerBody label="Hops details">content</DrawerBody>
      </Drawer>
    );

    await userEvent.click(screen.getByRole("button", { name: "Close hops" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("has no close button when nothing closes it", () => {
    render(
      <Drawer title="Cache" width="280px">
        <DrawerBody label="Cache">content</DrawerBody>
      </Drawer>
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("scrolls in a named region the keyboard can reach", async () => {
    render(
      <Drawer title="Metrics" width="520px">
        <DrawerBody label="Metrics details">content</DrawerBody>
      </Drawer>
    );

    const region = screen.getByRole("region", { name: "Metrics details" });
    await userEvent.tab();

    expect(region).toHaveTextContent("content");
    expect(region).toHaveFocus();
  });

  it("puts the header, the content before the body and the body in that order", () => {
    render(
      <Drawer title="Hops" width="520px">
        <p>summary</p>
        <DrawerBody label="details">body</DrawerBody>
      </Drawer>
    );

    const text = screen.getByRole("heading").closest("div")!.parentElement!.textContent;
    expect(text).toBe("Hopssummarybody");
  });

  it("hands its container and its scroll region to the caller", () => {
    const container = createRef<HTMLDivElement>();
    const body = createRef<HTMLDivElement>();
    render(
      <Drawer ref={container} title="Deltas" className="extra" width="1040px">
        <DrawerBody ref={body} label="Deltas details" className="padded">
          content
        </DrawerBody>
      </Drawer>
    );

    expect(container.current).toHaveClass("extra");
    expect(container.current).toContainElement(body.current);
    expect(body.current).toHaveClass("padded");
    expect(body.current).toBe(screen.getByRole("region", { name: "Deltas details" }));
  });

  it("takes its width from the caller", () => {
    const container = createRef<HTMLDivElement>();
    render(
      <Drawer ref={container} title="Waterfall" width="1040px">
        <DrawerBody label="details">content</DrawerBody>
      </Drawer>
    );

    expect(container.current!.style.getPropertyValue("--drawer-width")).toBe("1040px");
  });
});
