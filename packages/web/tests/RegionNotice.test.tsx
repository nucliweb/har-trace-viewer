import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RegionNotice } from "../src/components/RegionNotice.js";

const suggestion = { region: "cn" as const, reason: "document DNS 663ms ≥ 300ms" };

describe("RegionNotice", () => {
  it("says the diagram draws the Great Firewall and switches back to the default topology", async () => {
    const user = userEvent.setup();
    const onSwitch = vi.fn();
    render(
      <RegionNotice suggestion={suggestion} applied onSwitch={onSwitch} onDismiss={vi.fn()} />
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "so the diagram draws it. A slow or mobile network shows the same latencies."
    );
    await user.click(screen.getByRole("button", { name: "Show default topology" }));
    expect(onSwitch).toHaveBeenCalledTimes(1);
  });

  it("offers the GFW topology when the default one is drawn", async () => {
    const user = userEvent.setup();
    const onSwitch = vi.fn();
    render(
      <RegionNotice
        suggestion={suggestion}
        applied={false}
        onSwitch={onSwitch}
        onDismiss={vi.fn()}
      />
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "so the diagram keeps the default topology"
    );
    await user.click(screen.getByRole("button", { name: "Show GFW topology" }));
    expect(onSwitch).toHaveBeenCalledTimes(1);
  });

  it("names the --region flag in a report, which cannot draw the diagram again", () => {
    render(<RegionNotice suggestion={suggestion} applied onDismiss={vi.fn()} />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Generate the report with --region default to draw the default topology."
    );
    expect(screen.queryByRole("button", { name: "Show default topology" })).not.toBeInTheDocument();
  });
});
