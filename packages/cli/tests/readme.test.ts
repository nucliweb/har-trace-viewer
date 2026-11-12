import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { npmReadme } from "../scripts/readme.mjs";

const root = readFileSync(resolve(import.meta.dirname, "../../../README.md"), "utf8");
const published = readFileSync(resolve(import.meta.dirname, "../README.md"), "utf8");

describe("the README npm shows", () => {
  it("is the repository's README, as the build writes it", () => {
    expect(published).toBe(npmReadme(root));
  });

  it("keeps everything a user of the command reads and leaves the contributors' sections out", () => {
    for (const heading of [
      "## Usage",
      "### Options",
      "### CI budgets",
      "### Sharing a report safely",
      "### Examples",
      "## Why htv",
    ]) {
      expect(published).toContain(`\n${heading}\n`);
    }
    for (const heading of ["## Packages", "## Development", "## Releasing"]) {
      expect(published).not.toContain(`\n${heading}\n`);
    }
  });

  it("links to files by absolute URLs, which npmjs.com can follow", () => {
    const relative = [...published.matchAll(/\]\(([^)]+)\)/g)]
      .map(([, target]) => target)
      .filter((target) => !/^(https?:|#)/.test(target));
    expect(relative).toEqual([]);
    expect(published).toContain(
      "(https://raw.githubusercontent.com/nucliweb/har-trace-viewer/main/docs/screenshot-light.png)"
    );
    expect(published).toContain(
      "(https://github.com/nucliweb/har-trace-viewer/blob/main/packages/core/schema/findings.schema.json)"
    );
  });
});
