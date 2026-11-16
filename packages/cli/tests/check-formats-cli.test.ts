import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { wptHar } from "../../core/tests/helpers/wpt-har";

const CLI_ROOT = resolve(__dirname, "..");
const DIST_ENTRY = join(CLI_ROOT, "dist", "index.js");
const HAR = join(CLI_ROOT, "..", "core", "tests", "fixtures", "webperf-snippets.har.fixture.json");

const tempDirs: string[] = [];
function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "htv-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const runCli = (args: string[]) => spawnSync("node", [DIST_ENTRY, ...args], { encoding: "utf-8" });

/** A WebPageTest HAR whose first view (A) transfers far more than its repeat view (B). */
function wptPath(): string {
  const path = join(makeTempDir(), "wpt.har");
  writeFileSync(path, JSON.stringify(wptHar()));
  return path;
}
const FIRST_TO_REPEAT = ["--select", "page_1_0_1,page_1_1_1", "--compare"];

describe("--check-format (built CLI)", () => {
  it("prints the JSON result to stdout with exit 2 when a budget fails", () => {
    const res = runCli([
      "--har",
      HAR,
      "--budget",
      "requests=1,transfer=1gb",
      "--check-format",
      "json",
    ]);
    expect(res.status, res.stderr).toBe(2);
    const json = JSON.parse(res.stdout);
    expect(json.passed).toBe(false);
    expect(json.budgets.map((b: { status: string }) => b.status)).toEqual(["failed", "passed"]);
    expect(json.budgets[0]).toMatchObject({ metric: "requests", operator: "<=", limit: 1 });
  });

  it("lists the findings that reached --fail-on and a skipped budget", () => {
    const res = runCli([
      "--har",
      HAR,
      "--budget",
      "lcp=2s",
      "--fail-on",
      "warning",
      "--check-format",
      "json",
    ]);
    const json = JSON.parse(res.stdout);
    expect(json.failOn).toBe("warning");
    expect(json.budgets[0]).toMatchObject({ metric: "lcp", actual: null, status: "skipped" });
    expect(json.findings.length).toBe(json.summary.findings);
  });

  it("prints well-formed JUnit XML", () => {
    const res = runCli(["--har", HAR, "--budget", "requests=1", "--check-format", "junit"]);
    expect(res.status).toBe(2);
    expect(res.stdout).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>/);
    expect(res.stdout).toContain('<testsuite name="htv checks" tests="1" failures="1"');
    expect(res.stdout).toMatch(/<failure message="Page 1: requests \d+, limit &lt;= 1"/);
  });

  it("prints GitHub workflow commands", () => {
    const res = runCli(["--har", HAR, "--budget", "requests=1", "--check-format", "github"]);
    expect(res.status).toBe(2);
    expect(res.stdout).toMatch(/^::error title=Budget requests \(Page 1\)::Page 1: requests \d+/);
  });

  it("writes the result to --check-output and keeps the report on -o", () => {
    const dir = makeTempDir();
    const checks = join(dir, "nested", "checks.xml");
    const report = join(dir, "report.html");
    const res = runCli([
      "--har",
      HAR,
      "-o",
      report,
      "--budget",
      "requests=1",
      "--check-format",
      "junit",
      "--check-output",
      checks,
    ]);
    expect(res.status, res.stderr).toBe(2);
    expect(existsSync(report)).toBe(true);
    expect(readFileSync(checks, "utf8")).toContain("<testsuite");
    expect(res.stderr).toContain("Checks failed");
  });

  it("exits 1 for an unknown format, an unwritable path and a format without checks", () => {
    const bad = runCli(["--har", HAR, "--budget", "requests=1", "--check-format", "xml"]);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('Invalid --check-format "xml"');

    const dir = makeTempDir();
    const blocker = join(dir, "file");
    writeFileSync(blocker, "");
    const unwritable = runCli([
      "--har",
      HAR,
      "--budget",
      "requests=1",
      "--check-output",
      join(blocker, "checks.json"),
    ]);
    expect(unwritable.status).toBe(1);
    expect(unwritable.stderr).toContain("Could not write the check result to");
    // The result is still read on the terminal: the file is what failed, not the check.
    expect(unwritable.stdout).toContain("requests");

    const none = runCli(["--har", HAR, "--check-format", "json"]);
    expect(none.status).toBe(1);
    expect(none.stderr).toContain("need --budget or --fail-on");
  });
});

describe("delta budgets (built CLI)", () => {
  it("passes when B improves on A and fails when it is worse", () => {
    const ok = runCli(["--har", wptPath(), ...FIRST_TO_REPEAT, "--budget", "delta:transfer<=0"]);
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stdout).toMatch(/pass\s+A: .* vs B: .*\s+delta transfer\s+-/);

    const har = wptPath();
    const bad = runCli([
      "--har",
      har,
      "--select",
      "page_1_1_1",
      "--compare-with",
      har,
      "--compare-select",
      "page_1_0_1",
      "--budget",
      "delta:transfer<=10%",
    ]);
    expect(bad.status, bad.stderr).toBe(2);
    expect(bad.stdout).toMatch(/FAIL\s+A: .* vs B: .*\s+delta transfer\s+\+/);
  });

  it("keeps the plain budgets on both sides next to a delta budget", () => {
    const res = runCli([
      "--har",
      wptPath(),
      ...FIRST_TO_REPEAT,
      "--budget",
      "requests=100000,delta:requests<=0",
      "--check-format",
      "json",
    ]);
    const json = JSON.parse(res.stdout);
    expect(json.budgets.filter((b: { type: string }) => b.type === "value")).toHaveLength(2);
    expect(json.budgets.filter((b: { type: string }) => b.type === "delta")).toHaveLength(1);
  });

  it("works with --compare-with", () => {
    const res = runCli([
      "--har",
      HAR,
      "--compare-with",
      HAR,
      "--budget",
      "delta:requests<=0",
      "--check-format",
      "json",
    ]);
    expect(res.status, res.stderr).toBe(0);
    expect(JSON.parse(res.stdout).budgets[0]).toMatchObject({ type: "delta", actual: 0 });
  });

  it("exits 1 without a comparison", () => {
    const res = runCli(["--har", HAR, "--budget", "delta:lcp<=200"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("--compare or --compare-with");
  });
});
