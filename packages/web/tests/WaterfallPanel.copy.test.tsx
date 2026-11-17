import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WaterfallPanel } from "../src/components/WaterfallPanel.js";
import { makeEntry, makeHar } from "../../core/tests/helpers/synthetic-har";

const quoted = makeEntry({
  url: "https://example.com/it's?a=1&b=2",
  startTime: 100,
  duration: 40,
  method: "POST",
});
const plain = makeEntry({ url: "https://example.com/main.css", startTime: 200, duration: 40 });
const har = makeHar([quoted, plain], { onContentLoad: 300, onLoad: 520 });

// The rows of the list, not the items of the lists inside a request's detail.
const items = () => {
  const list = screen.getByRole("list", { name: /Requests/ });
  return within(list)
    .getAllByRole("listitem")
    .filter((li) => li.parentElement === list);
};

function renderPanel() {
  render(<WaterfallPanel har={har} pageLabel="Page 1" onClose={() => undefined} />);
}

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("WaterfallPanel: copying a request", () => {
  it("adds no copy button to the rows until one is selected", () => {
    renderPanel();
    expect(screen.queryByRole("button", { name: "Copy URL" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy cURL" })).not.toBeInTheDocument();
  });

  it("selects a row to show its actions, and a second click hides them", async () => {
    const user = userEvent.setup();
    renderPanel();
    const row = within(items()[2]).getAllByRole("button")[0];

    await user.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(within(items()[2]).getByRole("button", { name: "Copy URL" })).toBeInTheDocument();
    expect(within(items()[1]).queryByRole("button", { name: "Copy URL" })).not.toBeInTheDocument();

    await user.click(row);
    expect(row).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Copy URL" })).not.toBeInTheDocument();
  });

  it("copies the URL and announces it in a polite live region", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    renderPanel();

    await user.click(within(items()[1]).getAllByRole("button")[0]);
    await user.click(screen.getByRole("button", { name: "Copy URL" }));

    expect(writeText).toHaveBeenCalledWith("https://example.com/it's?a=1&b=2");
    const status = await screen.findByText("URL copied");
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  it("copies a cURL command made of the method and the shell-quoted URL", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    renderPanel();

    await user.click(within(items()[1]).getAllByRole("button")[0]);
    await user.click(screen.getByRole("button", { name: "Copy cURL" }));

    expect(writeText).toHaveBeenCalledWith("curl -X 'POST' 'https://example.com/it'\\''s?a=1&b=2'");
    expect(await screen.findByText("cURL command copied")).toBeInTheDocument();
  });

  it("says so when the clipboard is unavailable", async () => {
    const user = userEvent.setup();
    // userEvent installs a clipboard of its own; an insecure page has none.
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    renderPanel();

    await user.click(within(items()[2]).getAllByRole("button")[0]);
    await user.click(screen.getByRole("button", { name: "Copy URL" }));

    expect(await screen.findByText(/Could not copy/)).toHaveAttribute("aria-live", "polite");
  });

  it("says so when the clipboard refuses", async () => {
    const user = userEvent.setup();
    stubClipboard(() => Promise.reject(new Error("denied")));
    renderPanel();

    await user.click(within(items()[2]).getAllByRole("button")[0]);
    await user.click(screen.getByRole("button", { name: "Copy cURL" }));

    expect(await screen.findByText(/Could not copy/)).toBeInTheDocument();
  });

  it("offers the same actions in the table view", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    renderPanel();

    await user.click(screen.getByRole("button", { name: "Table" }));
    await user.click(screen.getByRole("button", { name: "main.css" }));
    await user.click(screen.getByRole("button", { name: "Copy URL" }));

    expect(writeText).toHaveBeenCalledWith("https://example.com/main.css");
    expect(await screen.findByText("URL copied")).toBeInTheDocument();
  });

  it("clears the message when another row is selected", async () => {
    const user = userEvent.setup();
    stubClipboard(() => Promise.resolve());
    renderPanel();

    await user.click(within(items()[1]).getAllByRole("button")[0]);
    await user.click(screen.getByRole("button", { name: "Copy URL" }));
    await screen.findByText("URL copied");
    await user.click(within(items()[2]).getAllByRole("button")[0]);

    expect(screen.queryByText("URL copied")).not.toBeInTheDocument();
  });
});
