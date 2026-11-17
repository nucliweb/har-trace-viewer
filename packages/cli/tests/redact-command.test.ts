import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { generateFlow, parseHarJson } from "@htv/core";
import { parseRedactArgs, redactReport, runRedactCommand } from "../src/redact";
import { secretHar, SECRETS } from "../../core/tests/helpers/secret-har";

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "htv-redact-cmd-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function writeSecretHar(): string {
  const path = join(tempDir(), "secret.har");
  writeFileSync(path, JSON.stringify(secretHar()));
  return path;
}

/** Runs the command and returns what it printed on each stream. */
async function run(argv: string[]) {
  let stdout = "";
  let stderr = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  vi.spyOn(console, "log").mockImplementation((line) => {
    stdout += `${line}\n`;
  });
  vi.spyOn(console, "error").mockImplementation((line) => {
    stderr += `${line}\n`;
  });
  await runRedactCommand(parseRedactArgs(argv));
  return { stdout, stderr };
}

const leaks = (text: string) => Object.values(SECRETS).filter((secret) => text.includes(secret));

describe("htv redact in process", () => {
  it("writes the redacted HAR to stdout and the counts to stderr without --output", async () => {
    const { stdout, stderr } = await run([writeSecretHar()]);

    expect(leaks(stdout)).toEqual([]);
    expect(JSON.parse(stdout).log.entries.length).toBeGreaterThan(0);
    expect(stderr).toMatch(/^Redacted: .*query values/);
  });

  it("writes a plain file for --output and reports its path and the counts", async () => {
    const output = join(tempDir(), "nested", "shared.har");

    const { stdout, stderr } = await run([writeSecretHar(), "-o", output]);

    expect(stdout).toContain(`Redacted HAR written: ${output}`);
    expect(stdout).toMatch(/Redacted: .*query values/);
    expect(stderr).toBe("");
    expect(leaks(readFileSync(output, "utf8"))).toEqual([]);
  });

  it("gzips the output for a .gz path", async () => {
    const output = join(tempDir(), "shared.har.GZ");

    await run([writeSecretHar(), "-o", output]);

    const json = gunzipSync(readFileSync(output)).toString("utf8");
    expect(leaks(json)).toEqual([]);
    expect(JSON.parse(json).log.entries.length).toBeGreaterThan(0);
  });

  it("masks the third-party host names with --mask-hosts and keeps the page host", async () => {
    const { stdout } = await run([writeSecretHar(), "--mask-hosts"]);

    expect(stdout).not.toContain("tracker.vendor-one.io");
    expect(stdout).toContain("shop.example.com");
  });

  it("refuses the input file as the output", () => {
    const input = writeSecretHar();
    expect(() => parseRedactArgs([input, "-o", input])).toThrow(/would overwrite/);
  });

  it("needs exactly one HAR", () => {
    expect(() => parseRedactArgs([])).toThrow("htv redact needs one HAR file");
    expect(() => parseRedactArgs(["a.har", "b.har"])).toThrow("htv redact needs one HAR file");
  });
});

describe("redactReport", () => {
  // A page named after a URL with a token: the one secret reading the HAR does not mask.
  const flow = () =>
    generateFlow([
      {
        name: `Home?token=${SECRETS.pageToken}`,
        har: parseHarJson(JSON.stringify(secretHar())),
      },
    ]);

  it("redacts one flow and notes the counts", () => {
    const { report, note } = redactReport({ flow: flow() }, { hosts: "keep" });

    expect(leaks(JSON.stringify(report))).toEqual([]);
    expect(report.compare).toBeUndefined();
    expect(note).toMatch(/^Redacted the report: \d+ query values?$/);
  });

  it("redacts both sides of a comparison", () => {
    const { report } = redactReport({ flow: flow(), compare: flow() }, { hosts: "mask" });

    expect(leaks(JSON.stringify(report.flow))).toEqual([]);
    expect(leaks(JSON.stringify(report.compare))).toEqual([]);
  });
});
