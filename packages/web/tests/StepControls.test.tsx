import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it } from "vitest";
import { DiagramView } from "../src/components/DiagramView.js";
import { makeFlow } from "./fixtures.js";
import { loadOnDemandModules } from "./lazy.js";

const flow = makeFlow();
const total = flow.steps.length;
const label = (n: number) => screen.getByText(`Step ${n} / ${total}`);
const reset = () => screen.getByRole("button", { name: "Reset to first step" });

beforeAll(loadOnDemandModules);

describe("step controls", () => {
  it("returns to the first step with Reset, which has nothing to do on the first step", async () => {
    const user = userEvent.setup();
    render(<DiagramView flow={flow} />);
    expect(reset()).toBeDisabled();

    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(label(3)).toBeInTheDocument();
    expect(reset()).toBeEnabled();

    await user.click(reset());
    expect(label(1)).toBeInTheDocument();
    expect(reset()).toBeDisabled();
  });

  it("disables Prev on the first step and Next on the last", async () => {
    const user = userEvent.setup();
    render(<DiagramView flow={flow} />);
    expect(screen.getByRole("button", { name: /prev/i })).toBeDisabled();

    await user.keyboard("{End}");
    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /prev/i })).toBeEnabled();
  });

  it("plays at the chosen speed: 4x moves on before 1x would", async () => {
    const user = userEvent.setup();
    render(<DiagramView flow={flow} />);
    const speed = screen.getByRole("combobox", { name: "Playback speed" });
    expect(speed).toHaveValue("1400");

    await user.selectOptions(speed, "4×");
    await user.click(screen.getByRole("button", { name: "Auto play" }));

    // 1x waits 1400 ms for the next step; 4x waits 400 ms.
    expect(await screen.findByText(`Step 2 / ${total}`, {}, { timeout: 1000 })).toBeInTheDocument();
  });
});
