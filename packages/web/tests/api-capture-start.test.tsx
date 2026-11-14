import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FlowBuilder } from "../src/components/FlowBuilder.js";
import { makeFile } from "./fixtures.js";
import { apiCaptureHar, apiCaptureTwoPagesHar } from "./api-capture.js";

const generate = () => screen.getByRole("button", { name: /generate diagram/i });

async function load(user: ReturnType<typeof userEvent.setup>, raw: object) {
  const input = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]')).find(
    (i) => i.accept === ".har,.gz"
  )!;
  await user.upload(input, makeFile(JSON.stringify(raw), "api.har"));
}

describe("the start screen with an API capture", () => {
  it("builds the flow of a HAR without pages", async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn();
    render(<FlowBuilder onGenerate={onGenerate} />);
    await load(user, apiCaptureHar());
    await waitFor(() => expect(generate()).toBeEnabled());
    await user.click(generate());

    const [pages] = onGenerate.mock.calls[0];
    expect(pages.map((p: { name: string }) => p.name)).toEqual(["Page 1"]);
    expect(pages[0].har.documentEntry.url).toBe("https://api.example.com/v1/session");
  });

  it("lists the pages of a multi-page API capture with a readable label each", async () => {
    const user = userEvent.setup();
    render(<FlowBuilder onGenerate={vi.fn()} />);
    await load(user, apiCaptureTwoPagesHar());
    const checklist = await screen.findByRole("group", { name: /pages to include/i });

    const labels = within(checklist)
      .getAllByRole("checkbox")
      .map((box) => box.closest("label")!.textContent);
    expect(labels).toEqual(["Orders API (4 req)", "https://api.other.org/v1/session (2 req)"]);
  });
});
