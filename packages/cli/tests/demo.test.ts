import { beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { HELP, USAGE, parseArgs, validateArgs } from "../src/cli";

const CLI_ROOT = resolve(__dirname, "..");
const DIST_ENTRY = join(CLI_ROOT, "dist", "index.js");
const HAR = join(CLI_ROOT, "..", "core", "tests", "fixtures", "webperf-snippets.har.fixture.json");

const runCli = (args: string[]) =>
  spawnSync("node", [DIST_ENTRY, ...args], { encoding: "utf-8", input: "" });

beforeAll(() => {
  if (!existsSync(DIST_ENTRY)) throw new Error(`${DIST_ENTRY} is missing. Run "npm run build".`);
});

describe("--demo", () => {
  it("needs no file", () => {
    const args = parseArgs(["--demo"]);
    expect(args.demo).toBe(true);
    expect(validateArgs(args)).toBeNull();
  });

  it("reports the built-in example, a page with its trace", () => {
    const res = runCli(["--demo", "--format", "json"]);
    expect(res.status, res.stderr).toBe(0);
    const { flow } = JSON.parse(res.stdout);
    expect(flow.pages).toHaveLength(1);
    expect(flow.pages[0].name).toBe("Home");
    expect(flow.pages[0].har.entries.length).toBeGreaterThan(10);
    expect(flow.pages[0].trace).toBeTruthy();
  });

  it("writes every kind of report", () => {
    const markdown = runCli(["--demo", "--format", "markdown"]);
    expect(markdown.status, markdown.stderr).toBe(0);
    expect(markdown.stdout).toContain("Home");

    const html = join(mkdtempSync(join(tmpdir(), "htv-demo-")), "demo.html");
    const written = runCli(["--demo", "-o", html]);
    expect(written.status, written.stderr).toBe(0);
    expect(readFileSync(html, "utf-8")).toContain("__HTV_FLOW__");
  });

  it("narrows the example with --filter", () => {
    const res = runCli(["--demo", "--format", "csv", "--filter", "type:stylesheet"]);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stderr).toMatch(/--filter kept \d+ of \d+ requests/);
  });

  it("does not open the terminal report without a terminal", () => {
    const res = runCli(["--demo"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("needs an interactive terminal");
  });

  it.each([
    [["--demo", HAR]],
    [["--demo", "--har", HAR]],
    [["--demo", "--compare"]],
    [["--demo", "--compare-with", HAR]],
    [["--demo", "--list-pages"]],
    [["--demo", "--region", "cn"]],
  ])("refuses a recording or what needs one: %j", (argv) => {
    expect(validateArgs(parseArgs(argv))).toMatch(/--demo/);
  });

  it("is what the usage points to when no file is given", () => {
    expect(USAGE).toContain("htv --demo");
    expect(HELP).toMatch(/--demo\s+Report the built-in example/);
    const res = runCli([]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("htv --demo");
  });
});
