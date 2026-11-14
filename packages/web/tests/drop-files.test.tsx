import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { FlowBuilder } from "../src/components/FlowBuilder.js";
import { harJson, makeFile, traceJson } from "./fixtures.js";

const NEEDS_HAR =
  "Add the HAR of the same recording: a trace adds main-thread detail to a HAR and can't be shown on its own.";

const dataTransfer = (...files: File[]) => ({ types: ["Files"], files });
const rowInputs = () =>
  Array.from(document.querySelectorAll<HTMLInputElement>('input[accept=".har,.gz,.json"]'));
const generate = () => screen.getByRole("button", { name: /generate diagram/i });

afterEach(() => {
  delete window.__HTV_FLOW__;
});

describe("dropping several files", () => {
  it("fills the HAR and trace slots of the row they are dropped on", async () => {
    render(<FlowBuilder onGenerate={() => undefined} />);
    const row = screen.getByLabelText("Page 1 name").parentElement!;

    fireEvent.drop(row, {
      dataTransfer: dataTransfer(makeFile(traceJson, "t.json"), makeFile(harJson, "site.har")),
    });

    expect(await screen.findByText("site.har")).toBeVisible();
    expect(await screen.findByRole("button", { name: "Trace ✓" })).toBeVisible();
    expect(screen.queryByText(NEEDS_HAR)).not.toBeInTheDocument();
    expect(generate()).toBeEnabled();
  });

  it("adds a page row for a second HAR", async () => {
    render(<FlowBuilder onGenerate={() => undefined} />);

    fireEvent.drop(window, {
      dataTransfer: dataTransfer(makeFile(harJson, "one.har"), makeFile(harJson, "two.har")),
    });

    expect(await screen.findByText("one.har")).toBeVisible();
    expect(await screen.findByText("two.har")).toBeVisible();
    expect(screen.getByLabelText("Page 2 name")).toBeVisible();
  });

  it("keeps the good file and shows the error of the unreadable one", async () => {
    render(<FlowBuilder onGenerate={() => undefined} />);

    fireEvent.drop(window, {
      dataTransfer: dataTransfer(makeFile(harJson, "good.har"), makeFile("not json", "bad.har")),
    });

    expect(await screen.findByText("good.har")).toBeVisible();
    expect(await screen.findByText(/^Not valid JSON/)).toBeVisible();
    expect(generate()).toBeEnabled();
  });

  it("asks for the HAR of a trace dropped alone", async () => {
    render(<FlowBuilder onGenerate={() => undefined} />);

    fireEvent.drop(window, { dataTransfer: dataTransfer(makeFile(traceJson, "t.json")) });

    expect(await screen.findByText(NEEDS_HAR)).toBeVisible();
    expect(generate()).toBeDisabled();
  });

  it("takes several files from the picker of a row", async () => {
    const user = userEvent.setup();
    render(<FlowBuilder onGenerate={() => undefined} />);

    await user.upload(rowInputs()[0], [
      makeFile(harJson, "site.har"),
      makeFile(traceJson, "t.json"),
    ]);

    expect(await screen.findByText("site.har")).toBeVisible();
    expect(await screen.findByRole("button", { name: "Trace ✓" })).toBeVisible();
  });
});

describe("dropping anywhere on the screen", () => {
  it("shows a drop target while files are dragged over, and hides it after the drop", async () => {
    render(<FlowBuilder onGenerate={() => undefined} />);
    expect(screen.queryByText("Drop a HAR and its trace here")).not.toBeInTheDocument();

    fireEvent.dragEnter(window, { dataTransfer: dataTransfer() });
    expect(screen.getByText("Drop a HAR and its trace here")).toBeVisible();

    fireEvent.drop(window, { dataTransfer: dataTransfer(makeFile(harJson, "site.har")) });
    expect(screen.queryByText("Drop a HAR and its trace here")).not.toBeInTheDocument();
    expect(await screen.findByText("site.har")).toBeVisible();
  });

  it("is hidden from the accessibility tree: the buttons stay the way in", () => {
    render(<FlowBuilder onGenerate={() => undefined} />);
    fireEvent.dragEnter(window, { dataTransfer: dataTransfer() });
    expect(screen.getByText("Drop a HAR and its trace here").parentElement).toHaveAttribute(
      "aria-hidden",
      "true"
    );
  });

  it("does not load a file dropped on a row twice", async () => {
    render(<FlowBuilder onGenerate={() => undefined} journeys />);
    const row = screen.getByLabelText("Page 1 name").parentElement!;

    fireEvent.drop(row, { dataTransfer: dataTransfer(makeFile(harJson, "site.har")) });

    await screen.findByText("site.har");
    expect(screen.queryByLabelText("Page 2 name")).not.toBeInTheDocument();
  });

  it("does not take drops once a flow is shown", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.upload(rowInputs()[0], makeFile(harJson, "site.har"));
    await user.click(await screen.findByRole("button", { name: /generate diagram/i }));
    await screen.findByRole("region", { name: "Diagram" });

    const drop = new Event("drop", { cancelable: true, bubbles: true });
    Object.assign(drop, { dataTransfer: dataTransfer(makeFile(harJson, "other.har")) });
    window.dispatchEvent(drop);

    expect(screen.queryByText("other.har")).not.toBeInTheDocument();
  });
});

const generated = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.upload(rowInputs()[0], [makeFile(harJson, "site.har"), makeFile(traceJson, "t.json")]);
  await user.click(await screen.findByRole("button", { name: /generate diagram/i }));
  await screen.findByRole("region", { name: "Diagram" });
};

describe("Home", () => {
  it("returns to the builder with the pages already read, ready for one more", async () => {
    const user = userEvent.setup();
    render(<App />);
    await generated(user);

    await user.click(screen.getByRole("button", { name: "Home" }));

    expect(screen.getByText("Build your flow")).toBeVisible();
    expect(screen.getByText("site.har")).toBeVisible();
    expect(screen.getByRole("button", { name: "Trace ✓" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Home" })).not.toBeInTheDocument();

    fireEvent.drop(window, { dataTransfer: dataTransfer(makeFile(harJson, "more.har")) });
    expect(await screen.findByText("more.har")).toBeVisible();
    expect(screen.getByText("site.har")).toBeVisible();
    expect(screen.getByLabelText("Page 2 name")).toBeVisible();
  });
});

describe("Reset", () => {
  it("leaves the flow for an empty builder", async () => {
    const user = userEvent.setup();
    render(<App />);
    await generated(user);

    await user.click(screen.getByRole("button", { name: "Reset" }));

    expect(screen.getByText("Build your flow")).toBeVisible();
    expect(screen.queryByText("site.har")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Trace ✓" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Page 1 name")).toBeVisible();
    expect(generate()).toBeDisabled();
  });

  it("empties the start screen, and is offered only when something is loaded", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.queryByRole("button", { name: "Reset" })).not.toBeInTheDocument();

    await user.upload(rowInputs()[0], [makeFile(harJson, "one.har"), makeFile(harJson, "two.har")]);
    expect(await screen.findByText("two.har")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Reset" }));

    expect(screen.queryByText("one.har")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Page 2 name")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Page 1 name")).toHaveValue("Page 1");
    expect(screen.queryByRole("button", { name: "Reset" })).not.toBeInTheDocument();
  });
});
