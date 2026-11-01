import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "../src/cli";
import { parseRedactArgs } from "../src/redact";
import { secretHar, SECRETS, JWT_HEADER } from "../../core/tests/helpers/secret-har";

const CLI_ROOT = resolve(__dirname, "..");
const DIST_ENTRY = join(CLI_ROOT, "dist", "index.js");
const REAL_HAR = resolve(
  CLI_ROOT,
  "../../fixtures/webperf-snippets.nucliweb.net_Cache-20260519T123746.har"
);

const tempDirs: string[] = [];
function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "htv-redact-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const runCli = (args: string[]) => spawnSync("node", [DIST_ENTRY, ...args], { encoding: "utf-8" });

// The secrets of the crafted HAR found in a text; a URL keeps its email percent-encoded too.
const leaks = (text: string) =>
  [...Object.values(SECRETS), JWT_HEADER, "jane.doe%40example.org"].filter((secret) =>
    text.includes(secret)
  );

function writeSecretHar(): string {
  const path = join(makeTempDir(), "secret.har");
  writeFileSync(path, JSON.stringify(secretHar()));
  return path;
}

beforeAll(() => {
  if (!existsSync(DIST_ENTRY)) {
    throw new Error(`${DIST_ENTRY} is missing. Run "npm run build" before running the CLI tests.`);
  }
});

describe("parseArgs --redact", () => {
  it("redacts secrets and keeps hosts with --redact", () => {
    expect(parseArgs(["a.har", "--redact"]).redact).toEqual({ hosts: "keep" });
  });

  it("also masks third-party hosts with --redact=mask-hosts", () => {
    expect(parseArgs(["a.har", "--redact=mask-hosts", "-o", "r.html"])).toMatchObject({
      pages: [{ har: "a.har" }],
      output: "r.html",
      redact: { hosts: "mask" },
    });
  });

  it("leaves the report as is without --redact", () => {
    expect(parseArgs(["a.har"]).redact).toBeUndefined();
  });

  it("rejects an unknown --redact level", () => {
    expect(() => parseArgs(["a.har", "--redact=all"])).toThrow(
      'Invalid --redact "all". Use --redact, or --redact=mask-hosts to also mask third-party hosts.'
    );
  });
});

describe("parseRedactArgs", () => {
  it("takes the HAR, the output and --mask-hosts", () => {
    expect(parseRedactArgs(["in.har.gz", "-o", "out.har", "--mask-hosts"])).toEqual({
      input: "in.har.gz",
      output: "out.har",
      hosts: "mask",
    });
    expect(parseRedactArgs(["in.har"])).toEqual({ input: "in.har", output: "", hosts: "keep" });
  });

  it("asks for exactly one HAR", () => {
    expect(() => parseRedactArgs([])).toThrow("htv redact needs one HAR file");
    expect(() => parseRedactArgs(["a.har", "b.har"])).toThrow("htv redact needs one HAR file");
  });

  it("refuses to overwrite its input", () => {
    expect(() => parseRedactArgs(["a.har", "-o", "./a.har"])).toThrow(
      "The redacted HAR would overwrite a.har: pick another --output"
    );
  });
});

describe("htv redact", () => {
  it("writes a redacted HAR and prints what it redacted", () => {
    const input = writeSecretHar();
    const output = join(makeTempDir(), "shared.har");

    const result = runCli(["redact", input, "-o", output]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Redacted HAR written: ${output}`);
    expect(result.stdout).toMatch(
      /Redacted: 6 cookie values, 6 header values, \d+ query values, 3 bodies, \d+ emails/
    );
    const har = readFileSync(output, "utf-8");
    expect(leaks(readFileSync(input, "utf-8")).length).toBeGreaterThan(10);
    expect(leaks(har)).toEqual([]);
    expect(JSON.parse(har).log.entries).toHaveLength(secretHar().log.entries.length);
  });

  it("writes a HAR htv still analyses", () => {
    const output = join(makeTempDir(), "shared.har");
    runCli(["redact", writeSecretHar(), "-o", output]);

    const result = runCli([output, "--format", "json"]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).flow.pages[0].har.entries).toHaveLength(7);
  });

  it("masks third-party hosts with --mask-hosts and gzips a .gz output", () => {
    const output = join(makeTempDir(), "shared.har.gz");

    const result = runCli(["redact", writeSecretHar(), "-o", output, "--mask-hosts"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("2 hosts masked");
    const har = gunzipSync(readFileSync(output)).toString("utf-8");
    expect(har).not.toMatch(/vendor-one|vendor-two/);
    expect(har).toContain("host-1.redacted");
  });

  it("prints the HAR to stdout without --output, and the counts to stderr", () => {
    const result = runCli(["redact", writeSecretHar()]);

    expect(result.status).toBe(0);
    expect(leaks(result.stdout)).toEqual([]);
    expect(JSON.parse(result.stdout).log.entries).toHaveLength(7);
    expect(result.stderr).toMatch(/^Redacted: 6 cookie values/);
  });

  it("fails without a HAR", () => {
    const result = runCli(["redact"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("htv redact needs one HAR file");
  });

  it("redacts a real recording", () => {
    const output = join(makeTempDir(), "shared.har");

    const result = runCli(["redact", REAL_HAR, "-o", output]);

    expect(result.stdout).toContain("Redacted: 6 query values, 26 bodies");
    expect(readFileSync(output, "utf-8")).not.toContain("1403848601.1770921786");
  });
});

describe("htv --redact", () => {
  it("redacts the JSON report and notes the counts on stderr", () => {
    const result = runCli([writeSecretHar(), "--format", "json", "--redact"]);

    expect(result.status).toBe(0);
    expect(leaks(result.stdout)).toEqual([]);
    expect(JSON.parse(result.stdout).flow.pages[0].har.entries[1].url).toMatch(
      /^https:\/\/shop\.example\.com\/account\?email=\[email\]&token=\[redacted-\d+\]&lang=en$/
    );
    expect(result.stderr).toMatch(/^Redacted the report: \d+ query values, \d+ emails\n/m);
  });

  it("leaves the secrets of URLs in the report without --redact", () => {
    const result = runCli([writeSecretHar(), "--format", "json"]);

    expect(leaks(result.stdout)).toEqual(
      expect.arrayContaining([SECRETS.pageToken, SECRETS.session, SECRETS.email])
    );
  });

  it("redacts the HTML report", () => {
    const output = join(makeTempDir(), "report.html");

    const result = runCli([writeSecretHar(), "-o", output, "--redact"]);

    expect(result.status).toBe(0);
    expect(leaks(readFileSync(output, "utf-8"))).toEqual([]);
  });

  for (const format of ["findings", "markdown", "csv", "mermaid"]) {
    it(`redacts the ${format} output`, () => {
      const result = runCli([writeSecretHar(), "--format", format, "--redact=mask-hosts"]);

      expect(result.status).toBe(0);
      expect(leaks(result.stdout)).toEqual([]);
      expect(result.stdout).not.toMatch(/vendor-one|vendor-two/);
    });
  }

  it("redacts both sides of a comparison with the same placeholders", () => {
    const har = writeSecretHar();

    const result = runCli([har, "--compare-with", har, "--format", "json", "--redact"]);

    expect(result.status).toBe(0);
    expect(leaks(result.stdout)).toEqual([]);
    const { a, b } = JSON.parse(result.stdout);
    expect(b.pages[0].har.entries.map((e: { url: string }) => e.url)).toEqual(
      a.pages[0].har.entries.map((e: { url: string }) => e.url)
    );
  });
});
