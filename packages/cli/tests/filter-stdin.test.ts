import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, resolve } from "node:path";
import { parseArgs, validateArgs } from "../src/cli";

const CLI_ROOT = resolve(__dirname, "..");
const DIST_ENTRY = join(CLI_ROOT, "dist", "index.js");
const HAR = join(CLI_ROOT, "..", "core", "tests", "fixtures", "webperf-snippets.har.fixture.json");

function runCli(args: string[], input?: string | Buffer) {
  return spawnSync("node", [DIST_ENTRY, ...args], {
    encoding: "utf-8",
    // Without input the child gets an empty pipe, never a terminal.
    input: input ?? "",
  });
}

beforeAll(() => {
  if (!existsSync(DIST_ENTRY)) throw new Error(`${DIST_ENTRY} is missing. Run "npm run build".`);
});

const csvRows = (csv: string) => csv.split("\r\n").filter(Boolean).slice(1);

describe("--filter", () => {
  it("parses the query", () => {
    expect(parseArgs(["a.har", "--filter", "type:script"]).filter).toBe("type:script");
    expect(parseArgs(["a.har"]).filter).toBeUndefined();
  });

  it("rejects a query with a problem as a usage error", () => {
    expect(() => parseArgs(["a.har", "--filter", "status:banana"])).toThrow(/--filter/);
  });

  it("emits only the matching requests as CSV", () => {
    const all = runCli(["--har", HAR, "--format", "csv"]);
    const some = runCli(["--har", HAR, "--format", "csv", "--filter", "type:stylesheet"]);
    expect(some.status, some.stderr).toBe(0);
    expect(csvRows(all.stdout)).toHaveLength(34);
    const rows = csvRows(some.stdout);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row).toContain(",stylesheet,");
    expect(some.stderr).toContain("--filter kept 2 of 34 requests");
  });

  it("negates and combines terms", () => {
    const res = runCli(["--har", HAR, "--format", "csv", "--filter=-type:script -type:stylesheet"]);
    expect(csvRows(res.stdout)).toHaveLength(5);
  });

  it("emits only the matching requests in the JSON of each page", () => {
    const res = runCli(["--har", HAR, "--format", "json", "--filter", "type:stylesheet"]);
    expect(res.status, res.stderr).toBe(0);
    const doc = JSON.parse(res.stdout);
    expect(doc.flow.pages[0].har.entries).toHaveLength(2);
  });

  it("matches nothing without failing", () => {
    const res = runCli(["--har", HAR, "--format", "csv", "--filter", "status:599"]);
    expect(res.status, res.stderr).toBe(0);
    expect(csvRows(res.stdout)).toHaveLength(0);
  });

  it("exits 1 with a readable message on an invalid query", () => {
    const res = runCli(["--har", HAR, "--format", "csv", "--filter", "status:banana"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Invalid --filter");
    expect(res.stderr).toContain("status");
    expect(res.stdout).toBe("");
  });

  it.each(["findings", "markdown", "mermaid", "html"])("rejects --format %s", (format) => {
    const out = format === "html" ? ["-o", "x.html"] : [];
    const res = runCli(["--har", HAR, "--format", format, "--filter", "type:script", ...out]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("--filter works with --format csv and json");
  });

  it("narrows both sides of a comparison", () => {
    const args = ["--har", HAR, "--compare-with", HAR, "--format", "csv"];
    const res = runCli([...args, "--filter", "type:stylesheet"]);
    expect(res.status, res.stderr).toBe(0);
    const sides = csvRows(res.stdout).map((row) => row.split(",")[1]);
    expect(sides.filter((side) => side === "a")).toHaveLength(2);
    expect(sides.filter((side) => side === "b")).toHaveLength(2);
    expect(res.stderr).toContain("--filter kept 4 of 68 requests");
  });

  it("rejects --filter with --list-pages", () => {
    const res = runCli(["--har", HAR, "--list-pages", "--filter", "type:script"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("--filter");
  });
});

describe("reading the HAR from stdin", () => {
  const har = readFileSync(HAR);

  it("reads a HAR given as -", () => {
    const res = runCli(["-", "--format", "csv"], har);
    expect(res.status, res.stderr).toBe(0);
    expect(csvRows(res.stdout)).toHaveLength(34);
  });

  it("reads --har - and works with --filter", () => {
    const res = runCli(["--har", "-", "--format", "csv", "--filter", "type:stylesheet"], har);
    expect(res.status, res.stderr).toBe(0);
    expect(csvRows(res.stdout)).toHaveLength(2);
  });

  it("reads a gzipped HAR", () => {
    const res = runCli(["-", "--format", "csv"], gzipSync(har));
    expect(res.status, res.stderr).toBe(0);
    expect(csvRows(res.stdout)).toHaveLength(34);
  });

  it("lists the pages of a HAR on stdin", () => {
    const res = runCli(["-", "--list-pages"], har);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toContain("1 page");
  });

  it("redacts a HAR given as -", () => {
    const res = runCli(["redact", "-"], readFileSync(HAR));
    expect(res.status, res.stderr).toBe(0);
    expect(JSON.parse(res.stdout).log.entries).toHaveLength(34);
  });

  it("exits 1 when stdin is empty", () => {
    const res = runCli(["-", "--format", "csv"], "");
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("stdin: no input");
  });

  it("exits 1 when stdin is not a HAR", () => {
    const res = runCli(["-", "--format", "csv"], "not json");
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("stdin: expected a HAR");
  });

  it("does not open the terminal report on a piped stdin", () => {
    const res = runCli(["-"], har);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("stdin");
    expect(res.stderr).toContain("--format");
  });

  it("rejects stdin twice and as a trace", () => {
    expect(validateArgs(parseArgs(["--har", "-", "--compare-with", "-"]))).toContain("once");
    expect(validateArgs(parseArgs(["a.har", "--trace", "-"]))).toContain("HAR only");
  });
});

describe("--list-pages --format json", () => {
  it("prints the pages of each HAR as JSON", () => {
    const res = runCli(["--har", HAR, "--list-pages", "--format", "json"]);
    expect(res.status, res.stderr).toBe(0);
    const doc = JSON.parse(res.stdout);
    expect(doc).toEqual({
      files: [
        {
          file: HAR,
          pages: [
            {
              id: expect.any(String),
              title: expect.any(String),
              url: expect.stringMatching(/^https:\/\//),
              entries: 34,
            },
          ],
        },
      ],
    });
  });

  it("keeps the text list without --format json", () => {
    const res = runCli(["--har", HAR, "--list-pages"]);
    expect(res.stdout).toContain("34 entries");
    expect(() => JSON.parse(res.stdout)).toThrow();
  });
});
