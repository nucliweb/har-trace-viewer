import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkBudgets, measureBuild, staticImports } from "../scripts/size.mjs";

const dirs: string[] = [];

/** A build directory with an index.html and the given assets. */
function build(html: string, assets: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "htv-size-"));
  dirs.push(dir);
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), html);
  for (const [name, content] of Object.entries(assets)) {
    writeFileSync(join(dir, "assets", name), content);
  }
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("staticImports", () => {
  it("lists the chunks a module imports statically, not the ones it imports on demand", () => {
    const code =
      'import{a as b}from"./shared-1.js";import"./side-2.js";export{c}from"./re-3.js";' +
      'const d=()=>import("./lazy-4.js");';
    expect(staticImports(code)).toEqual(["shared-1.js", "side-2.js", "re-3.js"]);
  });
});

describe("measureBuild", () => {
  it("counts the entry and what it imports as the initial load, the rest as loaded later", () => {
    const dir = build(
      '<script type="module" crossorigin src="/base/assets/index-a.js"></script>' +
        '<link rel="modulepreload" crossorigin href="/base/assets/shared-b.js">' +
        '<link rel="stylesheet" crossorigin href="/base/assets/index-c.css">',
      {
        "index-a.js":
          'import"./shared-b.js";import"./vendor-e.js";const v=()=>import("./view-d.js");',
        "shared-b.js": "export const b=1;",
        "vendor-e.js": "export const e=1;",
        "view-d.js": "export const d=1;",
        "view-d.css": ".d{}",
        "index-c.css": ".c{}",
        "parse.worker-f.js": "self.onmessage=()=>{};",
        "font-g.woff2": "binary",
      }
    );
    const { chunks, totals } = measureBuild(dir);

    const kinds = Object.fromEntries(chunks.map((chunk) => [chunk.file, chunk.kind]));
    expect(kinds).toEqual({
      "index-a.js": "initial",
      "shared-b.js": "initial",
      "vendor-e.js": "initial",
      "view-d.js": "lazy",
      "parse.worker-f.js": "worker",
      "index-c.css": "initial",
      "view-d.css": "lazy",
    });
    for (const chunk of chunks) {
      expect(chunk.raw).toBeGreaterThan(0);
      expect(chunk.gzip).toBeGreaterThan(0);
    }
    const sum = (kind: string, ext: string) =>
      chunks
        .filter((chunk) => chunk.kind === kind && chunk.file.endsWith(ext))
        .reduce((total, chunk) => total + chunk.gzip, 0);
    expect(totals.initialJs.gzip).toBe(sum("initial", ".js"));
    expect(totals.totalJs.gzip).toBe(sum("initial", ".js") + sum("lazy", ".js"));
    expect(totals.worker.gzip).toBe(sum("worker", ".js"));
    expect(totals.css.gzip).toBe(sum("initial", ".css") + sum("lazy", ".css"));
  });

  it("fails when the directory holds no build", () => {
    expect(() => measureBuild(join(tmpdir(), "htv-size-missing"))).toThrow(/npm run build/);
  });
});

describe("checkBudgets", () => {
  const totals = {
    initialJs: { raw: 300, gzip: 100 },
    totalJs: { raw: 600, gzip: 200 },
    worker: { raw: 90, gzip: 30 },
    css: { raw: 60, gzip: 20 },
  };

  it("passes every total at or under its gzip budget", () => {
    const results = checkBudgets(totals, { initialJs: 100, totalJs: 250 });
    expect(results).toEqual([
      { metric: "initialJs", actual: 100, budget: 100, ok: true },
      { metric: "totalJs", actual: 200, budget: 250, ok: true },
    ]);
  });

  it("fails a total over its budget", () => {
    const [result] = checkBudgets(totals, { initialJs: 99 });
    expect(result).toEqual({ metric: "initialJs", actual: 100, budget: 99, ok: false });
  });

  it("rejects a budget for a total it does not measure", () => {
    expect(() => checkBudgets(totals, { images: 10 })).toThrow(/images/);
  });
});
