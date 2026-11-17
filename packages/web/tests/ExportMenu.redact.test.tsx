import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  expandPageFlows,
  generateFlow,
  parseHarPagesJson,
  redactFlows,
  requestsCsv,
} from "@htv/core";
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

const HOSTS = "Mask third-party hosts";

async function downloadCsv(maskHosts: boolean, flow: Flow, compare?: Flow) {
  const user = userEvent.setup();
  const download = vi.fn();
  render(<ExportMenu flow={flow} compare={compare} download={download} />);
  await user.click(screen.getByRole("button", { name: "Export" }));
  if (maskHosts) await user.click(screen.getByRole("menuitemcheckbox", { name: HOSTS }));
  await user.click(screen.getByRole("menuitem", { name: "Download CSV" }));
  return { user, text: await (download.mock.calls[0][0] as Blob).text() };
}

describe("ExportMenu masking of third-party hosts", () => {
  it("offers one checkbox in a labelled group, unchecked by default", async () => {
    const user = userEvent.setup();
    render(<ExportMenu flow={makeFlow()} />);
    await user.click(screen.getByRole("button", { name: "Export" }));
    const group = screen.getByRole("group", {
      name: "Applies to CSV, Markdown and Mermaid (not images)",
    });
    expect(group).toBeInTheDocument();
    const checkbox = screen.getByRole("menuitemcheckbox", { name: HOSTS });
    expect(checkbox).toHaveAttribute("aria-checked", "false");
    expect(screen.queryAllByRole("menuitemradio")).toHaveLength(0);
    expect(screen.getAllByRole("menuitem")).toHaveLength(3);
  });

  it("keeps the menu open when toggled and moves focus through it with the arrows", async () => {
    const user = userEvent.setup();
    render(<ExportMenu flow={makeFlow()} />);
    await user.click(screen.getByRole("button", { name: "Export" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: HOSTS }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitemcheckbox", { name: HOSTS })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Download CSV" })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitemcheckbox", { name: HOSTS })).toHaveFocus();
  });

  it("exports masked secrets and the hosts as recorded while unchecked, with no note", async () => {
    const { text } = await downloadCsv(false, secretFlow("Account"));
    expect(leaks(text)).toEqual([]);
    expect(text).toContain(
      "https://shop.example.com/account?email=[email]&token=[redacted]&lang=en"
    );
    expect(text).toContain("tracker.vendor-one.io");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("masks the third-party hosts and keeps the secrets masked when checked, then says how many", async () => {
    const flow = secretFlow("Account");
    const { text } = await downloadCsv(true, flow);
    expect(leaks(text)).toEqual([]);
    expect(text).not.toContain("tracker.vendor-one.io");
    expect(text).toContain("host-1.redacted");
    const { flows } = redactFlows([flow], { hosts: "mask", secrets: false });
    expect(text).toBe(requestsCsv(flows[0]));
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Masked: 3 hosts");
    expect(status.querySelector("[lang='en']")).toHaveTextContent("3 hosts");
  });

  it("masks both sides of a comparison with shared hosts", async () => {
    const a = secretFlow("First");
    const b = secretFlow("Second");
    const { text } = await downloadCsv(true, a, b);
    expect(leaks(text)).toEqual([]);
    const { flows } = redactFlows([a, b], { hosts: "mask", secrets: false });
    expect(text).toBe(requestsCsv(flows[0], flows[1]));
  });

  it("clears the note when the menu opens again", async () => {
    const { user } = await downloadCsv(true, secretFlow("Account"));
    expect(screen.getByRole("status")).not.toBeEmptyDOMElement();
    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("keeps the choice for the next visit, and reads the stored three-level choice", async () => {
    const flow = secretFlow("Account");
    await downloadCsv(true, flow);
    document.body.innerHTML = "";
    render(<ExportMenu flow={flow} download={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(screen.getByRole("menuitemcheckbox", { name: HOSTS })).toHaveAttribute(
      "aria-checked",
      "true"
    );

    document.body.innerHTML = "";
    window.localStorage.setItem("htv-redact", "secrets");
    render(<ExportMenu flow={flow} download={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(screen.getByRole("menuitemcheckbox", { name: HOSTS })).toHaveAttribute(
      "aria-checked",
      "false"
    );
  });
});
