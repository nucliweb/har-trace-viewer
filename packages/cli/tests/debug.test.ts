import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { createDebug } from "../src/debug";

const DIST_ENTRY = resolve(__dirname, "..", "dist", "index.js");

function recorder(enabled: boolean) {
  const out: string[] = [];
  let now = 0;
  const debug = createDebug(
    (text) => out.push(text),
    () => now
  );
  if (enabled) debug.enable();
  return { debug, out, advance: (ms: number) => (now += ms) };
}

describe("the debug log", () => {
  it("writes nothing until it is enabled", async () => {
    const { debug, out } = recorder(false);
    debug.log("hello");
    debug.phase("analyze");
    await debug.time("read", async () => 1);
    debug.error(new Error("boom"));
    debug.end();
    expect(out).toEqual([]);
    expect(debug.enabled).toBe(false);
  });

  it("writes one prefixed line per message", () => {
    const { debug, out } = recorder(true);
    debug.log("two pages");
    expect(out).toEqual(["debug: two pages\n"]);
  });

  it("times a step, whatever it returns, and the phases it is in", async () => {
    const { debug, out, advance } = recorder(true);
    debug.phase("analyze");
    const value = await debug.time("read page.har", async () => {
      advance(12.4);
      return 42;
    });
    advance(100);
    debug.phase("render");
    advance(5);
    debug.end();
    expect(value).toBe(42);
    expect(out).toEqual([
      "debug: read page.har: 12 ms\n",
      "debug: analyze: 112 ms\n",
      "debug: render: 5 ms\n",
      "debug: total: 117 ms\n",
    ]);
  });

  it("still times a step that throws, and lets the error through", async () => {
    const { debug, out, advance } = recorder(true);
    await expect(
      debug.time("read", async () => {
        advance(3);
        throw new Error("nope");
      })
    ).rejects.toThrow("nope");
    expect(out).toEqual(["debug: read (failed): 3 ms\n"]);
  });

  it("ends only once", () => {
    const { debug, out } = recorder(true);
    debug.phase("a");
    debug.end();
    debug.end();
    expect(out.filter((line) => line.includes("total"))).toHaveLength(1);
  });

  it("writes the stack of an error and of its causes", () => {
    const { debug, out } = recorder(true);
    debug.error(new Error("outer", { cause: new Error("inner") }));
    const text = out.join("");
    expect(text).toContain("debug: Error: outer\n");
    expect(text).toMatch(/\n\s+at /);
    expect(text).toContain("caused by: Error: inner");
  });

  it("names the input: its kind, whether it is gzip, and its size", () => {
    const dir = mkdtempSync(join(tmpdir(), "htv-debug-"));
    const plain = join(dir, "a.har");
    const zipped = join(dir, "b.har.gz");
    writeFileSync(plain, "{}");
    writeFileSync(zipped, gzipSync("{}"));
    const { debug, out } = recorder(true);
    debug.input("har", plain);
    debug.input("trace", zipped);
    debug.input("har", "-");
    debug.input("har", join(dir, "missing.har"));
    expect(out).toEqual([
      `debug: input: HAR ${plain}, plain JSON, 2 B\n`,
      `debug: input: Chrome trace ${zipped}, gzip, ${gzipSync("{}").length} B\n`,
      "debug: input: HAR from stdin\n",
      `debug: input: HAR ${join(dir, "missing.har")}, unreadable\n`,
    ]);
  });
});

describe("htv --debug", () => {
  const htv = (...args: string[]) => spawnSync("node", [DIST_ENTRY, ...args], { encoding: "utf8" });

  it("leaves stdout as it is and writes the diagnostics to stderr", () => {
    const plain = htv("--demo", "--format", "json");
    const debugged = htv("--demo", "--format", "json", "--debug");
    expect(debugged.status).toBe(0);
    expect(debugged.stdout).toBe(plain.stdout);
    expect(plain.stderr).toBe("");
    expect(debugged.stderr).toMatch(/^debug: /m);
    expect(debugged.stderr).toMatch(/debug: pages: 1\b/);
    expect(debugged.stderr).toMatch(/debug: analyze: \d+ ms/);
    expect(debugged.stderr).toMatch(/debug: render json: \d+ ms/);
    expect(debugged.stderr).toMatch(/debug: total: \d+ ms/);
  });

  it("names the HAR it read and the phases of reading it", () => {
    const har = resolve(
      __dirname,
      "..",
      "..",
      "core",
      "tests",
      "fixtures",
      "webperf-snippets.har.fixture.json"
    );
    const run = htv("--har", har, "--format", "csv", "--debug");
    expect(run.status).toBe(0);
    expect(run.stderr).toContain(`debug: input: HAR ${har}, plain JSON,`);
    expect(run.stderr).toMatch(/debug: read and parse HAR .*: \d+ ms/);
    expect(run.stderr).toMatch(/debug: parse total: \d+ ms/);
    expect(run.stderr).toMatch(/debug: generate: \d+ ms/);
  });

  it("adds the full stack to the one-line message of an error", () => {
    const missing = htv("nowhere.har", "--format", "json");
    const debugged = htv("nowhere.har", "--format", "json", "--debug");
    expect(missing.status).toBe(1);
    expect(debugged.status).toBe(1);
    expect(missing.stderr).toBe("nowhere.har: no such file or directory\n");
    expect(debugged.stdout).toBe("");
    expect(debugged.stderr).toContain("nowhere.har: no such file or directory\n");
    expect(debugged.stderr).toMatch(/\n\s+at /);
    expect(debugged.stderr).toContain("caused by:");
  });

  it("adds the stack to a usage error too", () => {
    const debugged = htv("--format", "nope", "--debug");
    expect(debugged.status).toBe(1);
    expect(debugged.stderr).toContain('Invalid --format "nope"');
    expect(debugged.stderr).toMatch(/\n\s+at /);
  });
});
