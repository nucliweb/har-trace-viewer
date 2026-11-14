import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// The non-interactive commands must not pay for loading the TUI: the entry file stays free of
// Ink and React, which live in a chunk that only the interactive path imports.
const DIST = resolve(__dirname, "..", "dist");
const entry = readFileSync(join(DIST, "index.js"), "utf8");
const read = (file: string) => readFileSync(join(DIST, file), "utf8");

// Chunks the entry loads at startup (static imports) and the one it loads on demand.
const staticChunks = [
  ...entry.matchAll(/^(?:import|export)[^(]*?from\s*["']\.\/(tui-[^"']+\.js)["']/gm),
].map((m) => m[1]);
const onDemand = [...entry.matchAll(/\bimport\(\s*["']\.\/(tui-[^"']+\.js)["']\s*\)/g)].map(
  (m) => m[1]
);
const isTui = (code: string) => code.includes("react-reconciler") && code.includes("ink-box");

describe("startup", () => {
  it("keeps Ink and React out of the entry file and of every chunk it loads statically", () => {
    expect(isTui(entry)).toBe(false);
    for (const chunk of staticChunks) expect(isTui(read(chunk))).toBe(false);
    expect(entry).not.toContain("react-reconciler");
  });

  it("loads the TUI from a chunk on demand", () => {
    expect(onDemand).toHaveLength(1);
    expect(staticChunks).not.toContain(onDemand[0]);
    expect(isTui(read(onDemand[0]))).toBe(true);
  });

  it("keeps the shebang on the entry file", () => {
    expect(entry.startsWith("#!/usr/bin/env node\n")).toBe(true);
  });
});
