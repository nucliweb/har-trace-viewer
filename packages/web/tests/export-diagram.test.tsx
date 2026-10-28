import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ExportMenu } from "../src/components/ExportMenu.js";
import { exportFilename, serializeDiagramSvg } from "../src/lib/export-diagram.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function makeSvg(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  svg.setAttribute("id", "diagram-svg");
  svg.setAttribute("viewBox", "0 0 800 400");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.innerHTML = `
    <defs><filter id="glow"><feGaussianBlur stdDeviation="3"/></filter></defs>
    <rect id="node" x="10" y="10" width="100" height="50" fill="var(--color-surface)" class="hashed"/>
    <text id="label" x="20" y="30" font-family="var(--font-mono)">Browser</text>
    <path id="path" d="M0 0L10 10"><animateMotion dur="1s" repeatCount="indefinite"/><animate attributeName="opacity" dur="1s"/></path>`;
  return svg;
}

const fakeComputed = ((el: Element) => ({
  getPropertyValue: (prop: string) => {
    if (el.id === "node" && prop === "fill") return "rgb(12, 16, 24)";
    if (el.id === "label" && prop === "font-family") return '"JetBrains Mono", monospace';
    return "";
  },
})) as unknown as typeof getComputedStyle;

const options = {
  theme: "dark" as const,
  fontCss: '@font-face{font-family:"JetBrains Mono";src:url(data:font/woff2;base64,AAAA)}',
  getComputedStyle: fakeComputed,
  background: "rgb(6, 9, 16)",
};

describe("serializeDiagramSvg", () => {
  it("inlines computed styles, namespace, size, background and font faces", () => {
    const out = serializeDiagramSvg(makeSvg(), options);
    const doc = new DOMParser().parseFromString(out, "image/svg+xml");
    const root = doc.documentElement;
    expect(root.getAttribute("xmlns")).toBe(SVG_NS);
    expect(root.getAttribute("width")).toBe("800");
    expect(root.getAttribute("height")).toBe("400");
    expect(doc.querySelector("#node")!.getAttribute("style")).toContain("fill:rgb(12, 16, 24)");
    expect(doc.querySelector("#label")!.getAttribute("style")).toContain("JetBrains Mono");
    expect(doc.querySelector("style")!.textContent).toContain("data:font/woff2;base64,AAAA");
    expect(out).not.toContain("var(--");
    expect(doc.querySelector("rect")!.getAttribute("fill")).toBe("rgb(6, 9, 16)");
    expect(doc.querySelector("#label")!.textContent).toBe("Browser");
  });

  it("removes animation elements and leaves the live DOM untouched", () => {
    const svg = makeSvg();
    const out = serializeDiagramSvg(svg, options);
    expect(out).not.toContain("animateMotion");
    expect(out).not.toContain("<animate");
    expect(svg.querySelector("animateMotion")).not.toBeNull();
  });

  it("renders the active badges as text and grows the canvas to hold them", () => {
    const out = serializeDiagramSvg(makeSvg(), {
      ...options,
      badges: [{ label: "FCP", value: "1.2 s", color: "rgb(0, 255, 157)", opacity: 1 }],
    });
    const doc = new DOMParser().parseFromString(out, "image/svg+xml");
    const text = doc.documentElement.textContent ?? "";
    expect(text).toContain("FCP");
    expect(text).toContain("1.2 s");
    expect(Number(doc.documentElement.getAttribute("height"))).toBeGreaterThan(400);
  });
});

describe("exportFilename", () => {
  it("slugs the page name and numbers the step", () => {
    expect(exportFilename("Home Page / EN", 4, "png")).toBe("htv-home-page-en-step-4.png");
    expect(exportFilename("???", 1, "svg")).toBe("htv-page-step-1.svg");
  });
});

describe("ExportMenu", () => {
  function setup() {
    const download = vi.fn();
    const container = document.createElement("div");
    container.appendChild(makeSvg());
    document.body.appendChild(container);
    const utils = render(
      <ExportMenu
        containerRef={{ current: container }}
        pageName="Home"
        stepNumber={3}
        download={download}
        collectFonts={async () => options.fontCss}
      />
    );
    return { download, ...utils };
  }

  it("opens, closes with Escape and returns focus to the button", async () => {
    const user = userEvent.setup();
    setup();
    const button = screen.getByRole("button", { name: "Export" });
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await user.click(button);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Download SVG" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it("downloads the SVG with the step file name", async () => {
    const user = userEvent.setup();
    const { download } = setup();
    await user.click(screen.getByRole("button", { name: "Export" }));
    await user.click(screen.getByRole("menuitem", { name: "Download SVG" }));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    const [blob, filename] = download.mock.calls[0] as [Blob, string];
    expect(filename).toBe("htv-home-step-3.svg");
    expect(blob.type).toBe("image/svg+xml");
    expect(await blob.text()).toContain("@font-face");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("is disabled when there is no diagram", () => {
    render(<ExportMenu containerRef={{ current: null }} pageName="Home" stepNumber={1} disabled />);
    expect(screen.getByRole("button", { name: "Export" })).toBeDisabled();
  });
});
