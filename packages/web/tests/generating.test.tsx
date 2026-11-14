import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expandPageFlows, generateFlow, parseHarPagesJson } from "@htv/core";
import { App } from "../src/App.js";
import { FlowBuilder } from "../src/components/FlowBuilder.js";
import demoFlow from "../src/demo/demo-flow.json";
import { ca } from "../src/i18n/ca.js";
import { MessagesContext } from "../src/i18n/context.js";
import { es } from "../src/i18n/es.js";
import { harJson, makeFile } from "./fixtures.js";

/** Holds every generation until the test releases it; the generation itself is the real one. */
const gate = vi.hoisted(() => ({ hold: null as Promise<void> | null, calls: 0 }));

vi.mock("../src/lib/parse-client.js", async (importActual) => {
  const actual = await importActual<typeof import("../src/lib/parse-client.js")>();
  return {
    ...actual,
    generateInWorker: async (...args: Parameters<typeof actual.generateInWorker>) => {
      gate.calls += 1;
      await gate.hold;
      return actual.generateInWorker(...args);
    },
  };
});

function hold(): () => Promise<void> {
  let release!: () => void;
  gate.hold = new Promise((resolve) => (release = resolve));
  return () =>
    act(async () => {
      gate.hold = null;
      release();
    });
}

afterEach(() => {
  gate.hold = null;
  gate.calls = 0;
});

// The HAR with the document's DNS and connection as slow as behind the Great Firewall.
const chinaJson = (() => {
  const har = JSON.parse(harJson);
  har.log.entries[0].timings.dns = 320;
  har.log.entries[0].timings.connect = 650;
  return JSON.stringify(har);
})();

const generatedSteps = generateFlow(
  expandPageFlows({ name: "Page 1", har: parseHarPagesJson(harJson) })
).steps.length;

const announcement = () =>
  [...document.querySelectorAll('[aria-live="polite"]')].map((n) => n.textContent).join("");

async function loadHar(user: ReturnType<typeof userEvent.setup>, json = harJson) {
  const input = document.querySelector<HTMLInputElement>('input[accept=".har,.gz"]')!;
  await user.upload(input, makeFile(json, "site.har"));
  return screen.findByRole("button", { name: /generate diagram/i });
}

describe("generating a diagram", () => {
  it("announces the generation and keeps the Generate button from starting a second one", async () => {
    const user = userEvent.setup();
    render(<App />);
    const generate = await loadHar(user);
    const release = hold();

    await user.click(generate);

    expect(generate).toHaveAccessibleName("Generating…");
    expect(generate).toHaveAttribute("aria-disabled", "true");
    expect(announcement()).toBe("Generating…");
    await user.click(generate);
    expect(gate.calls).toBe(1);

    await release();
    expect(await screen.findByRole("region", { name: "Diagram" })).toBeInTheDocument();
    expect(announcement()).not.toContain("Generating…");
  });

  it("keeps the start screen when Reset comes during a region switch", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await loadHar(user, chinaJson));
    const notice = await screen.findByText(/Great Firewall/);
    const release = hold();

    await user.click(screen.getByRole("button", { name: "Show default topology" }));
    expect(notice.closest("[role=status]")).toContainElement(
      screen.getByRole("button", { name: "Generating…" })
    );
    await user.click(screen.getByRole("button", { name: "Reset" }));
    await release();

    expect(screen.getByText("Build your flow")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Diagram" })).not.toBeInTheDocument();
    expect(announcement()).toBe("");
  });

  it("does not let a generation still running replace the demo flow", async () => {
    const user = userEvent.setup();
    render(<App />);
    const generate = await loadHar(user);
    const release = hold();
    await user.click(generate);
    await user.click(screen.getByRole("button", { name: "Load demo flow →" }));
    const demoSteps = demoFlow.steps.length;
    expect(await screen.findByText(`Step 1 / ${demoSteps}`)).toBeInTheDocument();
    expect(generatedSteps).not.toBe(demoSteps);

    await release();
    expect(screen.getByText(`Step 1 / ${demoSteps}`)).toBeInTheDocument();
    expect(announcement()).not.toContain("Generating…");
  });

  it.each([
    ["Spanish", es],
    ["Catalan", ca],
  ])("says it is generating in %s", (_name, messages) => {
    render(
      <MessagesContext.Provider value={messages}>
        <FlowBuilder generating onGenerate={() => undefined} />
      </MessagesContext.Provider>
    );
    expect(screen.getByRole("button", { name: messages.app.generating })).toBeInTheDocument();
    expect(messages.app.generating).not.toBe("Generating…");
  });

  it("redraws the side once the switch lands", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await loadHar(user, chinaJson));
    const notice = (await screen.findByText(/Great Firewall/)).closest<HTMLElement>(
      "[role=status]"
    )!;

    await user.click(within(notice).getByRole("button", { name: "Show default topology" }));

    expect(
      await within(notice).findByRole("button", { name: "Show GFW topology" })
    ).toBeInTheDocument();
  });
});
