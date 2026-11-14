import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { describeRedaction, expandPageFlows, generateFlow, parseHarPagesJson } from "@htv/core";
import { redactFlows, requestsCsv } from "@htv/core";
import type { Flow } from "@htv/core";
import { ExportMenu } from "../src/components/ExportMenu.js";
import { JWT_HEADER, SECRETS, secretHar } from "../../core/tests/helpers/secret-har";
import { makeFlow } from "./fixtures.js";

afterEach(() => window.localStorage.clear());

function secretFlow(name: string): Flow {
  const har = parseHarPagesJson(JSON.stringify(secretHar()));
  return generateFlow(expandPageFlows({ name, har }));
}

const leaks = (text: string) =>
  [...Object.values(SECRETS), JWT_HEADER, "jane.doe%40example.org"].filter((s) => text.includes(s));

async function downloadCsv(level: string | null, flow: Flow, compare?: Flow) {
  const user = userEvent.setup();
  const download = vi.fn();
  render(<ExportMenu flow={flow} compare={compare} download={download} />);
  await user.click(screen.getByRole("button", { name: "Export" }));
  if (level) await user.click(screen.getByRole("menuitemradio", { name: level }));
  await user.click(screen.getByRole("menuitem", { name: "Download CSV" }));
  return { user, text: await (download.mock.calls[0][0] as Blob).text() };
}

describe("ExportMenu redaction", () => {
  it("offers off, secrets and secrets plus third-party hosts as a labelled radio group, off by default", async () => {
    const user = userEvent.setup();
    render(<ExportMenu flow={makeFlow()} />);
    await user.click(screen.getByRole("button", { name: "Export" }));
    const group = screen.getByRole("group", {
      name: "Redact CSV, Markdown and Mermaid (not images)",
    });
    expect(group).toBeInTheDocument();
    const radios = screen.getAllByRole("menuitemradio");
    expect(radios.map((r) => r.textContent)).toEqual([
      "Off",
      "Secrets",
      "Secrets and third-party hosts",
    ]);
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
    expect(screen.getAllByRole("menuitem")).toHaveLength(3);
  });

  it("keeps the menu open when a level is chosen and moves focus through the radios with the arrows", async () => {
    const user = userEvent.setup();
    render(<ExportMenu flow={makeFlow()} />);
    await user.click(screen.getByRole("button", { name: "Export" }));
    await user.click(screen.getByRole("menuitemradio", { name: "Secrets" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: "Secrets" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    await user.keyboard("{ArrowDown}");
    expect(
      screen.getByRole("menuitemradio", { name: "Secrets and third-party hosts" })
    ).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Download CSV" })).toHaveFocus();
  });

  it("exports the secrets untouched while redaction is off", async () => {
    const { text } = await downloadCsv(null, secretFlow("Account"));
    expect(leaks(text).length).toBeGreaterThan(0);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("removes every secret and matches the CLI's redaction, then says what was redacted", async () => {
    const flow = secretFlow("Account");
    const { text } = await downloadCsv("Secrets", flow);
    expect(leaks(text)).toEqual([]);
    const { flows, report } = redactFlows([flow], { hosts: "keep" });
    expect(text).toBe(requestsCsv(flows[0]));
    expect(text).toContain("tracker.vendor-one.io");
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(`Redacted: ${describeRedaction(report)}`);
    expect(status.querySelector("[lang='en']")).toHaveTextContent(describeRedaction(report));
  });

  it("also masks third-party hosts at the second level", async () => {
    const flow = secretFlow("Account");
    const { text } = await downloadCsv("Secrets and third-party hosts", flow);
    expect(leaks(text)).toEqual([]);
    expect(text).not.toContain("tracker.vendor-one.io");
    const { flows, report } = redactFlows([flow], { hosts: "mask" });
    expect(text).toBe(requestsCsv(flows[0]));
    expect(screen.getByRole("status")).toHaveTextContent(describeRedaction(report));
  });

  it("redacts both sides of a comparison with shared placeholders", async () => {
    const a = secretFlow("First");
    const b = secretFlow("Second");
    const { text } = await downloadCsv("Secrets and third-party hosts", a, b);
    expect(leaks(text)).toEqual([]);
    const { flows } = redactFlows([a, b], { hosts: "mask" });
    expect(text).toBe(requestsCsv(flows[0], flows[1]));
  });

  it("clears the note when the menu opens again and says nothing for the image exports", async () => {
    const flow = secretFlow("Account");
    const { user } = await downloadCsv("Secrets", flow);
    expect(screen.getByRole("status")).not.toBeEmptyDOMElement();
    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("keeps the level for the next visit", async () => {
    const flow = secretFlow("Account");
    const { user } = await downloadCsv("Secrets", flow);
    expect(user).toBeDefined();
    document.body.innerHTML = "";
    render(<ExportMenu flow={flow} download={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(screen.getByRole("menuitemradio", { name: "Secrets" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
  });
});
