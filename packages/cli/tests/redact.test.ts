import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "../src/cli";
import { parseRedactArgs } from "../src/redact";
import {
  secretHar,
  secretTrace,
  SECRETS,
  HEADER_SECRETS,
  JWT_HEADER,
} from "../../core/tests/helpers/secret-har";

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

function writeSecretTrace(): string {
  const path = join(makeTempDir(), "secret.trace.json");
  writeFileSync(path, JSON.stringify(secretTrace()));
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
      /Redacted: 7 cookie values, 9 header values, \d+ query values, 3 bodies, \d+ emails/
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
    expect(JSON.parse(result.stdout).flow.pages[0].har.entries).toHaveLength(
      secretHar().log.entries.length
    );
  });

  it("masks third-party hosts with --mask-hosts and gzips a .gz output", () => {
    const output = join(makeTempDir(), "shared.har.gz");

    const result = runCli(["redact", writeSecretHar(), "-o", output, "--mask-hosts"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("3 hosts masked");
    const har = gunzipSync(readFileSync(output)).toString("utf-8");
    expect(har).not.toMatch(/vendor-one|vendor-two|vendor-three/);
    expect(har).toContain("host-1.redacted");
  });

  it("prints the HAR to stdout without --output, and the counts to stderr", () => {
    const result = runCli(["redact", writeSecretHar()]);

    expect(result.status).toBe(0);
    expect(leaks(result.stdout)).toEqual([]);
    expect(JSON.parse(result.stdout).log.entries).toHaveLength(secretHar().log.entries.length);
    expect(result.stderr).toMatch(/^Redacted: 7 cookie values/);
  });

  it("fails without a HAR", () => {
    const result = runCli(["redact"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("htv redact needs one HAR file");
  });

  it.each([
    ["a missing file", "missing.har", null, "no such file or directory"],
    ["a missing .gz file", "missing.har.gz", null, "no such file or directory"],
    [
      "a file that is not JSON",
      "notes.har",
      "hello",
      "expected a HAR, but the file is not valid JSON",
    ],
    [
      "JSON that is not a recording",
      "other.har",
      '{"a":1}',
      "expected a HAR (log.entries) but found neither a HAR nor a Chrome trace",
    ],
    [
      "a Chrome trace",
      "trace.json",
      '{"traceEvents":[]}',
      "expected a HAR but this is a Chrome trace",
    ],
  ])("names the file and writes nothing for %s", (_case, name, content, message) => {
    const dir = makeTempDir();
    const input = join(dir, name);
    if (content !== null) writeFileSync(input, content);
    const output = join(dir, "out.har");
    const result = runCli(["redact", input, "-o", output]);
    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toBe(`${input}: ${message}`);
    expect(result.stdout).toBe("");
    expect(existsSync(output)).toBe(false);
  });

  it("redacts a real recording", () => {
    const output = join(makeTempDir(), "shared.har");

    const result = runCli(["redact", REAL_HAR, "-o", output]);

    expect(result.stdout).toContain("Redacted: 6 query values, 26 bodies");
    expect(readFileSync(output, "utf-8")).not.toContain("1403848601.1770921786");
  });
});

describe("htv --redact", () => {
  it("redacts the JSON report on top of what reading the HAR masked, and notes the counts on stderr", () => {
    const name = `Account?token=${SECRETS.pageToken} of ${SECRETS.email}`;
    const result = runCli(["--page", name, writeSecretHar(), "--format", "json", "--redact"]);

    expect(result.status).toBe(0);
    expect(leaks(result.stdout)).toEqual([]);
    const page = JSON.parse(result.stdout).flow.pages[0];
    // Masked as the HAR was read, unnumbered; --redact numbers what it masks itself.
    expect(page.har.entries[1].url).toBe(
      "https://shop.example.com/account?email=[email]&token=[redacted]&lang=en"
    );
    expect(page.name).toBe("Account?token=[redacted-1] of [email]");
    expect(result.stderr).toMatch(/^Redacted the report: 1 query value, 1 email\n/m);
  });

  it("leaves no secret of the HAR or its trace in the JSON and HTML reports, even without --redact", () => {
    const har = writeSecretHar();
    const trace = writeSecretTrace();
    const output = join(makeTempDir(), "report.html");
    expect(leaks(readFileSync(har, "utf-8") + readFileSync(trace, "utf-8"))).toEqual(
      expect.arrayContaining(Object.values(SECRETS))
    );

    const json = runCli([har, trace, "--format", "json"]);
    const html = runCli([har, trace, "-o", output]);

    expect(json.status).toBe(0);
    expect(html.status).toBe(0);
    expect(leaks(json.stdout)).toEqual([]);
    expect(leaks(readFileSync(output, "utf-8"))).toEqual([]);
    const page = JSON.parse(json.stdout).flow.pages[0];
    expect(page.har.documentEntry.url).toBe(
      "https://shop.example.com/account?email=[email]&token=[redacted]&lang=en"
    );
    expect(page.trace.url).toBe(page.har.documentEntry.url);
  });

  for (const format of ["findings", "markdown", "csv", "mermaid"]) {
    it(`leaves no secret of the HAR or its trace in the ${format} output, even without --redact`, () => {
      const result = runCli([writeSecretHar(), writeSecretTrace(), "--format", format]);

      expect(result.status).toBe(0);
      expect(leaks(result.stdout)).toEqual([]);
    });
  }

  it("keeps every header with its secrets masked in the JSON and HTML reports, even without --redact", () => {
    const har = writeSecretHar();
    const output = join(makeTempDir(), "report.html");

    const json = runCli([har, "--format", "json"]).stdout;
    expect(runCli([har, "-o", output]).status).toBe(0);
    const html = readFileSync(output, "utf-8");

    for (const text of [json, html]) {
      expect(HEADER_SECRETS.filter((secret) => text.includes(secret))).toEqual([]);
    }
    const doc = JSON.parse(json).flow.pages[0].har.documentEntry;
    expect(doc.headers.request).toEqual(
      expect.arrayContaining([
        "authorization: [redacted]",
        "proxy-authorization: [redacted]",
        "x-api-key: [redacted]",
      ])
    );
    expect(html).toContain("authorization: [redacted]");
  });

  it("masks third-party hosts in every header of the JSON and HTML reports", () => {
    const har = writeSecretHar();
    const output = join(makeTempDir(), "report.html");

    const json = runCli([har, "--format", "json", "--redact=mask-hosts"]).stdout;
    expect(runCli([har, "-o", output, "--redact=mask-hosts"]).status).toBe(0);
    const html = readFileSync(output, "utf-8");

    for (const text of [json, html]) {
      expect(leaks(text)).toEqual([]);
      expect(text).not.toMatch(/vendor-one|vendor-two|vendor-three/);
    }
    const login = JSON.parse(json).flow.pages[0].har.entries[0];
    expect(login.headers.request).toEqual(
      expect.arrayContaining([expect.stringMatching(/^origin: https:\/\/host-\d+\.redacted$/)])
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
