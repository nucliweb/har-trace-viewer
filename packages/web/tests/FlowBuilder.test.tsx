import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { gzipSync } from "node:zlib";
import { File as NodeFile } from "node:buffer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FlowBuilder } from "../src/components/FlowBuilder.js";
import { UNRECOGNIZED_JSON } from "@htv/core";
import { GZIP_UNSUPPORTED } from "../src/lib/parse-recording.js";
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
  it("renders one empty page with Generate disabled, without the journey controls", () => {
    render(<FlowBuilder onGenerate={vi.fn()} />);
    expect(screen.getByLabelText("Page 1 name")).toHaveValue("Page 1");
    expect(screen.getByText("Drop .har")).toBeInTheDocument();
    expect(generate()).toBeDisabled();
    expect(screen.getByText("Load a HAR file, and a Chrome trace if you have one.")).toBeVisible();
    expect(screen.getByRole("heading", { name: "HAR file (required)" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Trace (optional)" })).toBeVisible();
    for (const name of ["+ Add page", "Move page up", "Move page down", "Remove page"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("offers the journey controls when journeys are on", () => {
    render(<FlowBuilder onGenerate={vi.fn()} journeys />);
    expect(screen.getByRole("button", { name: "+ Add page" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Remove page" })).toBeDisabled();
    expect(screen.getByText(/multiple pages to visualise a user journey/)).toBeVisible();
  });

  it("keeps the journey controls while a journey has several pages, journeys off", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<FlowBuilder onGenerate={vi.fn()} journeys />);
    await user.click(screen.getByRole("button", { name: "+ Add page" }));
    rerender(<FlowBuilder onGenerate={vi.fn()} journeys={false} />);
    expect(screen.getAllByRole("button", { name: "Remove page" })).toHaveLength(2);

    await user.click(screen.getAllByRole("button", { name: "Remove page" })[1]);
    expect(screen.queryByRole("button", { name: "+ Add page" })).not.toBeInTheDocument();
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
    await loadHar(user);
    await screen.findByText("site.har");
    await user.upload(
      fileInputs().find((i) => i.accept === ".json,.gz")!,
      makeFile(traceJson, "trace.json")
    );
    expect(await screen.findByRole("button", { name: "Trace ✓" })).toBeInTheDocument();
  });

  describe("a trace before its HAR", () => {
    const NEEDS_HAR =
      "Add the HAR of the same recording: a trace adds main-thread detail to a HAR and can't be shown on its own.";
    const traceInput = () => fileInputs().find((i) => i.accept === ".json,.gz")!;

    it("keeps the trace, asks for the HAR, and generates once it arrives", async () => {
      const user = userEvent.setup();
      const onGenerate = vi.fn();
      render(<FlowBuilder onGenerate={onGenerate} />);
      expect(screen.getAllByRole("button", { name: "Trace" })[0]).toBeEnabled();
      await user.upload(traceInput(), makeFile(traceJson, "trace.json"));
      expect(await screen.findByRole("button", { name: "Trace ✓" })).toBeInTheDocument();
      expect(screen.getByText(NEEDS_HAR)).toBeVisible();
      expect(generate()).toBeDisabled();

      await loadHar(user);
      await screen.findByText("site.har");
      expect(screen.queryByText(NEEDS_HAR)).not.toBeInTheDocument();
      await user.click(generate());
      expect(onGenerate.mock.calls[0][0][0].trace).toBeDefined();
    });

    it("takes a trace picked with the HAR button as the trace", async () => {
      const user = userEvent.setup({ applyAccept: false });
      render(<FlowBuilder onGenerate={vi.fn()} />);
      await user.upload(fileInputs()[0], makeFile(traceJson, "trace.json"));
      expect(await screen.findByRole("button", { name: "Trace ✓" })).toBeInTheDocument();
      expect(screen.queryByText("Only .har and .har.gz files are supported.")).toBeNull();
      expect(screen.getByText(NEEDS_HAR)).toBeVisible();
    });

    it("takes a trace dropped on the row as the trace", async () => {
      render(<FlowBuilder onGenerate={vi.fn()} />);
      const row = screen.getByLabelText("Page 1 name").parentElement!;
      fireEvent.drop(row, { dataTransfer: { files: [makeFile(traceJson, "trace.json")] } });
      expect(await screen.findByRole("button", { name: "Trace ✓" })).toBeInTheDocument();
      expect(screen.getByText(NEEDS_HAR)).toBeVisible();
    });

    it("holds Generate while the recording to compare with has a trace and no HAR", async () => {
      const user = userEvent.setup();
      render(<FlowBuilder onGenerate={vi.fn()} />);
      await loadHar(user);
      await screen.findByText("site.har");
      const compareTarget = screen.getByRole("group", { name: "Compare with…" });
      await user.upload(
        within(compareTarget).getByLabelText("Trace to compare with", { selector: "input" }),
        makeFile(traceJson, "trace.json")
      );
      expect(await within(compareTarget).findByText(NEEDS_HAR)).toBeVisible();
      expect(generate()).toBeDisabled();

      await user.click(within(compareTarget).getByRole("button", { name: "Remove comparison" }));
      expect(generate()).toBeEnabled();
    });
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
      expect(await screen.findByText("HAR contains no entries")).toBeInTheDocument();
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
    render(<FlowBuilder onGenerate={vi.fn()} journeys />);
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

  it("leaves the region to the latencies by default, and passes an explicit Default", async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn();
    render(<FlowBuilder onGenerate={onGenerate} />);
    await loadHar(user);
    await screen.findByText("site.har");
    expect(screen.getByLabelText("Client region")).toHaveDisplayValue("Auto (from the latencies)");
    await user.click(generate());
    expect(onGenerate.mock.calls[0][1]).toEqual({});

    await user.selectOptions(screen.getByLabelText("Client region"), "default");
    await user.click(generate());
    expect(onGenerate.mock.calls[1][1]).toEqual({ clientRegion: "default" });
  });

  it("only includes pages that have a HAR", async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn();
    render(<FlowBuilder onGenerate={onGenerate} journeys />);
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
      expect(options).toEqual({});
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

      const compareBox = within(comparePages()).getByRole("checkbox", {
        name: /compare two pages/i,
      });
      expect(compareBox).not.toBeChecked();
      // The page selectors show once the comparison is asked for, never greyed out.
      expect(within(comparePages()).queryByRole("combobox")).not.toBeInTheDocument();
      await user.click(compareBox);
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
