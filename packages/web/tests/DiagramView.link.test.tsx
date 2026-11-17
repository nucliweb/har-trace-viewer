import { render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { DiagramView } from "../src/components/DiagramView.js";
import { makeTwoPageFlow } from "./fixtures.js";
import { loadOnDemandModules } from "./lazy.js";

const flow = makeTwoPageFlow();
const secondPageStep = flow.steps.findIndex((s) => s.pageIndex === 1);

beforeAll(loadOnDemandModules);
afterEach(() => window.history.replaceState(null, "", "/"));

describe("DiagramView link", () => {
  it("opens the drawers on the page of the linked step", () => {
    window.history.replaceState(null, "", `/#p=${secondPageStep + 1}&d=waterfall&r=0`);
    render(<DiagramView flow={flow} />);
    expect(screen.getByText(`Step ${secondPageStep + 1} / ${flow.steps.length}`)).toBeVisible();
    expect(screen.getByText(/Page 2 · /)).toBeVisible();
    expect(screen.getByRole("region", { name: "Request details" })).toBeVisible();
  });

  it("ignores a step out of range or malformed", () => {
    window.history.replaceState(null, "", "/#p=abc");
    render(<DiagramView flow={flow} />);
    expect(screen.getByText(`Step 1 / ${flow.steps.length}`)).toBeVisible();
  });
});
