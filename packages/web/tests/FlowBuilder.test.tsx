import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { gzipSync } from "node:zlib";
import { File as NodeFile } from "node:buffer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FlowBuilder } from "../src/components/FlowBuilder.js";
import { GZIP_UNSUPPORTED, UNRECOGNIZED_JSON } from "../src/lib/parse-recording.js";
import { wptHar } from "../../core/tests/helpers/wpt-har";
import { harJson, makeFile, traceJson } from "./fixtures.js";

const generate = () => screen.getByRole("button", { name: /generate diagram/i });
const fileInputs = () =>
  Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'));

async function loadHar(user: ReturnType<typeof userEvent.setup>, index = 0, content = harJson) {
  await user.upload(
    fileInputs().filter((i) => i.accept === ".har,.gz")[index],
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
    // The first Trace button belongs to the page; the second one to the optional comparison.
    expect(screen.getAllByRole("button", { name: "Trace" })[0]).toBeDisabled();
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
    expect(await screen.findByText(/^Not valid JSON: /)).toBeInTheDocument();
    expect(generate()).toBeDisabled();
  });

  it("rejects a file with the wrong extension", async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<FlowBuilder onGenerate={vi.fn()} />);
    await user.upload(fileInputs()[0], makeFile("x", "notes.txt"));
    expect(
      await screen.findByText("Only .har and .har.gz files are supported.")
    ).toBeInTheDocument();
  });

  describe("file errors and formats", () => {
    const traceInput = () => fileInputs().find((i) => i.accept === ".json,.gz")!;
    const gzFile = (content: string, name: string) =>
      new NodeFile([gzipSync(content)], name) as unknown as File;

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("shows the message of the core parser for a HAR it cannot read", async () => {
      const user = userEvent.setup();
      render(<FlowBuilder onGenerate={vi.fn()} />);
      await loadHar(user, 0, '{"log":{"pages":[],"entries":[]}}');
      expect(await screen.findByText("HAR contains no pages")).toBeInTheDocument();
      expect(generate()).toBeDisabled();
    });

    it("says a JSON file is neither a HAR nor a trace, on either button", async () => {
      const user = userEvent.setup();
      render(<FlowBuilder onGenerate={vi.fn()} />);
      await loadHar(user, 0, '{"foo":1}');
      expect(await screen.findByText(UNRECOGNIZED_JSON)).toBeInTheDocument();

      await loadHar(user);
      await screen.findByText("site.har");
      await user.upload(traceInput(), makeFile('{"foo":1}', "trace.json"));
      expect(await screen.findByText(UNRECOGNIZED_JSON)).toBeInTheDocument();
    });

    it("loads a trace given as a bare array of events", async () => {
      const user = userEvent.setup();
      render(<FlowBuilder onGenerate={vi.fn()} />);
      await loadHar(user);
      await screen.findByText("site.har");
      const events = JSON.stringify(
        (JSON.parse(traceJson) as { traceEvents: unknown[] }).traceEvents
      );
      await user.upload(traceInput(), makeFile(events, "trace.json"));
      expect(await screen.findByRole("button", { name: "Trace ✓" })).toBeInTheDocument();
    });

    it("loads a gzipped HAR", async () => {
      const user = userEvent.setup();
      render(<FlowBuilder onGenerate={vi.fn()} />);
      await user.upload(fileInputs()[0], gzFile(harJson, "site.har.gz"));
      expect(await screen.findByText("site.har.gz")).toBeInTheDocument();
      expect(generate()).toBeEnabled();
    });

    it("explains that a .gz file needs a browser that can decompress it", async () => {
      vi.stubGlobal("DecompressionStream", undefined);
      const user = userEvent.setup();
      render(<FlowBuilder onGenerate={vi.fn()} />);
      await user.upload(fileInputs()[0], gzFile(harJson, "site.har.gz"));
      expect(await screen.findByText(GZIP_UNSUPPORTED)).toBeInTheDocument();
    });
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

  describe("multi-page HAR", () => {
    const wptJson = JSON.stringify(wptHar());
    const checklist = () => screen.getByRole("group", { name: /pages to include/i });
    const box = (name: RegExp) => within(checklist()).getByRole("checkbox", { name });

    it("shows no checklist for a single-page HAR", async () => {
      const user = userEvent.setup();
      render(<FlowBuilder onGenerate={vi.fn()} />);
      await loadHar(user);
      await screen.findByText("site.har");
      expect(screen.queryByRole("group", { name: /pages to include/i })).not.toBeInTheDocument();
    });

    it("lists every page with its request count and ticks only the first WebPageTest view", async () => {
      const user = userEvent.setup();
      render(<FlowBuilder onGenerate={vi.fn()} />);
      await loadHar(user, 0, wptJson);
      await screen.findByText("site.har · 3 pages");

      expect(box(/Run 1 · First view \(3 req\)/)).toBeChecked();
      expect(box(/Run 1 · Repeat view \(2 req\)/)).not.toBeChecked();
      expect(box(/Run 2 · First view \(4 req\)/)).not.toBeChecked();
    });

    it("generates one flow page per ticked page", async () => {
      const user = userEvent.setup();
      const onGenerate = vi.fn();
      render(<FlowBuilder onGenerate={onGenerate} />);
      await loadHar(user, 0, wptJson);
      await screen.findByText("site.har · 3 pages");
      await user.click(box(/Run 2 · First view/));
      await user.click(generate());

      const [pages] = onGenerate.mock.calls[0];
      expect(pages.map((p: { name: string }) => p.name)).toEqual([
        "Run 1 · First view",
        "Run 2 · First view",
      ]);
    });

    it("selects all or none with the toggle and disables Generate when nothing is ticked", async () => {
      const user = userEvent.setup();
      render(<FlowBuilder onGenerate={vi.fn()} />);
      await loadHar(user, 0, wptJson);
      await screen.findByText("site.har · 3 pages");

      await user.click(within(checklist()).getByRole("button", { name: "Select all" }));
      expect(
        within(checklist())
          .getAllByRole("checkbox")
          .every((c) => (c as HTMLInputElement).checked)
      ).toBe(true);

      await user.click(within(checklist()).getByRole("button", { name: "Select none" }));
      expect(
        within(checklist())
          .getAllByRole("checkbox")
          .some((c) => (c as HTMLInputElement).checked)
      ).toBe(false);
      expect(generate()).toBeDisabled();
    });
  });

  describe("comparison", () => {
    const wptJson = JSON.stringify(wptHar());
    const compareTarget = () => screen.getByRole("group", { name: "Compare with…" });
    const comparePages = () => screen.getByRole("group", { name: "Compare pages" });

    async function loadCompareHar(user: ReturnType<typeof userEvent.setup>, content = harJson) {
      await user.upload(
        within(compareTarget()).getByLabelText("HAR file to compare with", { selector: "input" }),
        makeFile(content, "other.har")
      );
      await within(compareTarget()).findByText("other.har");
    }

    it("offers an optional second drop target that turns Generate into a comparison", async () => {
      const user = userEvent.setup();
      const onGenerate = vi.fn();
      render(<FlowBuilder onGenerate={onGenerate} />);
      expect(
        within(compareTarget()).getByRole("button", { name: /drop \.har to compare/i })
      ).toBeEnabled();

      await loadHar(user);
      await screen.findByText("site.har");
      await loadCompareHar(user);
      await user.click(screen.getByRole("button", { name: /generate comparison/i }));

      const [pages, options, comparePagesArg] = onGenerate.mock.calls[0];
      expect(pages).toHaveLength(1);
      expect(options).toEqual({ clientRegion: "default" });
      expect(comparePagesArg).toHaveLength(1);
      expect(comparePagesArg[0].har.entries.length).toBeGreaterThan(0);
    });

    it("attaches an optional trace to the second flow and can be cleared", async () => {
      const user = userEvent.setup();
      const onGenerate = vi.fn();
      render(<FlowBuilder onGenerate={onGenerate} />);
      await loadHar(user);
      await screen.findByText("site.har");
      await loadCompareHar(user);
      await user.upload(
        within(compareTarget()).getByLabelText("Trace to compare with", { selector: "input" }),
        makeFile(traceJson, "trace.json")
      );
      expect(
        await within(compareTarget()).findByRole("button", { name: "Trace ✓" })
      ).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /generate comparison/i }));
      expect(onGenerate.mock.calls[0][2][0].trace).toBeDefined();

      await user.click(within(compareTarget()).getByRole("button", { name: "Remove comparison" }));
      expect(generate()).toBeEnabled();
      await user.click(generate());
      expect(onGenerate.mock.calls[1][2]).toBeUndefined();
    });

    it("proposes the first and the repeat view of a WebPageTest HAR as the page pair", async () => {
      const user = userEvent.setup();
      render(<FlowBuilder onGenerate={vi.fn()} />);
      await loadHar(user, 0, wptJson);
      await screen.findByText("site.har · 3 pages");

      expect(
        within(comparePages()).getByRole("checkbox", { name: /compare two pages/i })
      ).not.toBeChecked();
      expect(within(comparePages()).getByLabelText("A")).toHaveDisplayValue(
        "Run 1 · First view (3 req)"
      );
      expect(within(comparePages()).getByLabelText("B")).toHaveDisplayValue(
        "Run 1 · Repeat view (2 req)"
      );
    });

    it("compares the two picked pages of the same HAR", async () => {
      const user = userEvent.setup();
      const onGenerate = vi.fn();
      render(<FlowBuilder onGenerate={onGenerate} />);
      await loadHar(user, 0, wptJson);
      await screen.findByText("site.har · 3 pages");

      await user.click(
        within(comparePages()).getByRole("checkbox", { name: /compare two pages/i })
      );
      expect(screen.queryByRole("group", { name: "Compare with…" })).not.toBeInTheDocument();
      await user.selectOptions(within(comparePages()).getByLabelText("B"), "page_2_0_1");
      await user.click(screen.getByRole("button", { name: /generate comparison/i }));

      const [pages, , comparePagesArg] = onGenerate.mock.calls[0];
      expect(pages.map((p: { name: string }) => p.name)).toEqual(["Run 1 · First view"]);
      expect(comparePagesArg.map((p: { name: string }) => p.name)).toEqual(["Run 2 · First view"]);
    });
  });
});
