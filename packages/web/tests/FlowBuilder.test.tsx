import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FlowBuilder } from "../src/components/FlowBuilder.js";
import { harJson, makeFile, traceJson } from "./fixtures.js";

const generate = () => screen.getByRole("button", { name: /generate diagram/i });
const fileInputs = () =>
  Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'));

async function loadHar(user: ReturnType<typeof userEvent.setup>, index = 0, content = harJson) {
  await user.upload(
    fileInputs().filter((i) => i.accept === ".har")[index],
    makeFile(content, "site.har")
  );
}

describe("FlowBuilder", () => {
  it("renders one empty page with Generate disabled", () => {
    render(<FlowBuilder onGenerate={vi.fn()} />);
    expect(screen.getByLabelText("Page 1 name")).toHaveValue("Page 1");
    expect(screen.getByText("Drop .har")).toBeInTheDocument();
    expect(generate()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove page" })).toBeDisabled();
  });

  it("parses a HAR on the main thread, shows its name and enables Generate", async () => {
    const user = userEvent.setup();
    render(<FlowBuilder onGenerate={vi.fn()} />);
    await loadHar(user);
    expect(await screen.findByText("site.har")).toBeInTheDocument();
    expect(generate()).toBeEnabled();
  });

  it("loads a trace after the HAR", async () => {
    const user = userEvent.setup();
    render(<FlowBuilder onGenerate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Trace" })).toBeDisabled();
    await loadHar(user);
    await screen.findByText("site.har");
    await user.upload(
      fileInputs().find((i) => i.accept === ".json,.gz")!,
      makeFile(traceJson, "trace.json")
    );
    expect(await screen.findByRole("button", { name: "Trace ✓" })).toBeInTheDocument();
  });

  it("shows an inline error for a corrupt HAR", async () => {
    const user = userEvent.setup();
    render(<FlowBuilder onGenerate={vi.fn()} />);
    await loadHar(user, 0, "{ not json");
    expect(await screen.findByText("Could not parse HAR file.")).toBeInTheDocument();
    expect(generate()).toBeDisabled();
  });

  it("rejects a file with the wrong extension", async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<FlowBuilder onGenerate={vi.fn()} />);
    await user.upload(fileInputs()[0], makeFile("x", "notes.txt"));
    expect(await screen.findByText("Only .har files are supported.")).toBeInTheDocument();
  });

  it("adds, reorders and removes pages", async () => {
    const user = userEvent.setup();
    render(<FlowBuilder onGenerate={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "+ Add page" }));
    const names = () =>
      screen.getAllByPlaceholderText("Page name").map((i) => (i as HTMLInputElement).value);
    expect(names()).toEqual(["Page 1", "Page 2"]);

    await user.click(screen.getAllByRole("button", { name: "Move page down" })[0]);
    expect(names()).toEqual(["Page 2", "Page 1"]);
    await user.click(screen.getAllByRole("button", { name: "Move page up" })[1]);
    expect(names()).toEqual(["Page 1", "Page 2"]);

    await user.click(screen.getAllByRole("button", { name: "Remove page" })[0]);
    expect(names()).toEqual(["Page 2"]);
  });

  it("generates PageFlows from the fixture with the chosen client region", async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn();
    render(<FlowBuilder onGenerate={onGenerate} />);
    await user.clear(screen.getByLabelText("Page 1 name"));
    await user.type(screen.getByLabelText("Page 1 name"), "Home");
    await loadHar(user);
    await screen.findByText("site.har");
    await user.selectOptions(screen.getByLabelText("Client region"), "cn");
    await user.click(generate());

    expect(onGenerate).toHaveBeenCalledTimes(1);
    const [pages, options] = onGenerate.mock.calls[0];
    expect(options).toEqual({ clientRegion: "cn" });
    expect(pages[0].name).toContain("Home");
    expect(pages[0].har.entries.length).toBeGreaterThan(0);
  });

  it("only includes pages that have a HAR", async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn();
    render(<FlowBuilder onGenerate={onGenerate} />);
    await user.click(screen.getByRole("button", { name: "+ Add page" }));
    await loadHar(user, 1);
    await waitFor(() => expect(generate()).toBeEnabled());
    await user.click(generate());
    expect(onGenerate.mock.calls[0][0]).toHaveLength(1);
    expect(within(document.body).getByDisplayValue("Page 2")).toBeInTheDocument();
  });
});
