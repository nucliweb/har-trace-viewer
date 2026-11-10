import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { setMedia } from "./setup.js";

const html = document.documentElement;
const version = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../cli/package.json"), "utf8")
).version;

afterEach(() => {
  Reflect.deleteProperty(html, "requestFullscreen");
  Reflect.deleteProperty(document, "exitFullscreen");
  Reflect.deleteProperty(document, "fullscreenElement");
});

describe("App — keyboard shortcuts", () => {
  it("t toggles the theme", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.keyboard("t");
    expect(html).toHaveAttribute("data-theme", "dark");
    await user.keyboard("t");
    expect(html).toHaveAttribute("data-theme", "light");
  });

  it("c and the header button open the settings, and Close closes them", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.keyboard("c");
    const settings = screen.getByRole("dialog", { name: "Settings" });
    await user.click(within(settings).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
  });

  it("? opens the keyboard shortcuts and about, one dialog at a time", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.keyboard("?");
    const help = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    for (const action of ["Toggle theme", "Settings", "Fullscreen", "Next step"]) {
      expect(within(help).getByText(action)).toBeInTheDocument();
    }
    expect(help).toHaveTextContent(`v${version}`);

    await user.keyboard("c");
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
  });

  it("closes the open dialog on Escape", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.keyboard("?");

    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("f enters and leaves fullscreen", async () => {
    const user = userEvent.setup();
    const requestFullscreen = vi.fn(() => Promise.resolve());
    const exitFullscreen = vi.fn(() => Promise.resolve());
    Object.assign(html, { requestFullscreen });
    Object.assign(document, { exitFullscreen });
    render(<App />);

    await user.keyboard("f");
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "fullscreenElement", { value: html, configurable: true });
    await user.keyboard("f");
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
  });

  it("leaves the keys to a field being typed in", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText("Page 1 name"), "tc?f");
    expect(html).toHaveAttribute("data-theme", "light");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("App — settings", () => {
  it("choose the theme, the system's included", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Settings" }));

    await user.click(screen.getByRole("radio", { name: "Dark" }));
    expect(html).toHaveAttribute("data-theme", "dark");
    await user.click(screen.getByRole("radio", { name: "System" }));
    expect(html).toHaveAttribute("data-theme", "light");
    setMedia("(prefers-color-scheme: dark)", true);
    expect(await screen.findByRole("radio", { name: "System" })).toBeChecked();
  });

  it("link to the keyboard shortcuts", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.keyboard("c");

    await user.click(screen.getByRole("button", { name: "Keyboard shortcuts and about" }));
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
  });
});
