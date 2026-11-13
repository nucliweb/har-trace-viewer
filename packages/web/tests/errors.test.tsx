import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { ViewErrorBoundary } from "../src/components/ViewErrorBoundary.js";
import { MessagesContext } from "../src/i18n/context.js";
import { ca } from "../src/i18n/ca.js";
import { en } from "../src/i18n/en.js";
import { es } from "../src/i18n/es.js";
import { harJson, makeFile, makeFlow } from "./fixtures.js";

const analysis = vi.hoisted(() => ({ fail: false }));

vi.mock("@htv/core", async (importActual) => {
  const actual = await importActual<typeof import("@htv/core")>();
  return {
    ...actual,
    generateFlow: (...args: Parameters<typeof actual.generateFlow>) => {
      if (analysis.fail) throw new Error("analysis failed");
      return actual.generateFlow(...args);
    },
  };
});

function Broken(): ReactNode {
  throw new Error("render failed");
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  analysis.fail = false;
  delete window.__HTV_FLOW__;
  vi.restoreAllMocks();
});

async function loadHar(user: ReturnType<typeof userEvent.setup>) {
  const input = document.querySelector<HTMLInputElement>('input[accept=".har,.gz"]')!;
  await user.upload(input, makeFile(harJson, "site.har"));
}

describe("generation errors", () => {
  it("shows an alert and stays on the builder when the analysis throws", async () => {
    const user = userEvent.setup();
    render(<App />);
    await loadHar(user);
    analysis.fail = true;

    await user.click(await screen.findByRole("button", { name: /generate diagram/i }));

    expect(screen.getByRole("alert")).toHaveTextContent(en.errors.generate);
    expect(screen.getByText("Build your flow")).toBeInTheDocument();
  });

  it("clears the alert once a later attempt succeeds", async () => {
    const user = userEvent.setup();
    render(<App />);
    await loadHar(user);
    analysis.fail = true;
    await user.click(await screen.findByRole("button", { name: /generate diagram/i }));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    analysis.fail = false;
    await user.click(screen.getByRole("button", { name: /generate diagram/i }));

    expect(screen.queryByText(en.errors.generate)).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: /diagram|flow/i })).toBeInTheDocument();
  });
});

describe("ViewErrorBoundary", () => {
  it("replaces a view that throws with a heading, a message and a way back", async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    render(
      <ViewErrorBoundary onReset={onReset}>
        <Broken />
      </ViewErrorBoundary>
    );

    const heading = screen.getByRole("heading", { name: en.errors.viewTitle });
    expect(screen.getByRole("alert")).toHaveTextContent(en.errors.viewMessage);
    expect(heading).toHaveFocus();

    await user.click(screen.getByRole("button", { name: en.errors.startOver }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["Spanish", es],
    ["Catalan", ca],
  ])("speaks %s", (_name, messages) => {
    render(
      <MessagesContext.Provider value={messages}>
        <ViewErrorBoundary onReset={() => undefined}>
          <Broken />
        </ViewErrorBoundary>
      </MessagesContext.Provider>
    );
    expect(screen.getByRole("heading", { name: messages.errors.viewTitle })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: messages.errors.startOver })).toBeInTheDocument();
  });

  it("returns the app to the start screen when the diagram view throws", async () => {
    const user = userEvent.setup();
    const flow = JSON.parse(JSON.stringify(makeFlow()));
    flow.steps = [];
    window.__HTV_FLOW__ = flow;
    render(<App />);

    expect(screen.getByRole("heading", { name: en.errors.viewTitle })).toBeInTheDocument();
    expect(screen.getByRole("banner")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: en.errors.startOver }));
    expect(screen.getByText("Build your flow")).toBeInTheDocument();
  });
});
