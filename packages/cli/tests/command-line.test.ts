import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "../src/cli";
import { parseRedactArgs } from "../src/redact";
import { splitCommand } from "../src/command";
import { secretHar } from "../../core/tests/helpers/secret-har";

const DIST_ENTRY = resolve(__dirname, "..", "dist", "index.js");
const runCli = (args: string[], cwd?: string) =>
  spawnSync("node", [DIST_ENTRY, ...args], { encoding: "utf-8", cwd });

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "htv-cmd-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("splitCommand", () => {
  it("takes the first argument as the command", () => {
    expect(splitCommand(["redact", "a.har"])).toEqual({ command: "redact", rest: ["a.har"] });
    expect(splitCommand(["completion", "bash"])).toEqual({ command: "completion", rest: ["bash"] });
  });

  it("looks past --debug, which is global, and drops it from the arguments", () => {
    expect(splitCommand(["--debug", "redact", "a.har"])).toEqual({
      command: "redact",
      rest: ["a.har"],
    });
    expect(splitCommand(["--debug", "--debug", "completion", "zsh"])).toEqual({
      command: "completion",
      rest: ["zsh"],
    });
  });

  it("leaves a report run alone, with --debug where it was", () => {
    expect(splitCommand(["--debug", "a.har"])).toEqual({ rest: ["--debug", "a.har"] });
    expect(splitCommand(["a.har", "redact"])).toEqual({ rest: ["a.har", "redact"] });
    expect(splitCommand(["--har", "redact"])).toEqual({ rest: ["--har", "redact"] });
    expect(splitCommand(["./redact"])).toEqual({ rest: ["./redact"] });
    expect(splitCommand([])).toEqual({ rest: [] });
  });
});

describe("a command after a global flag", () => {
  it("runs htv --debug redact on a HAR", () => {
    const har = join(tempDir(), "x.har");
    writeFileSync(har, JSON.stringify(secretHar()));
    const res = runCli(["--debug", "redact", har]);
    expect(res.status).toBe(0);
    expect(res.stderr).not.toContain("Unexpected argument");
    expect(JSON.parse(res.stdout).log.entries.length).toBeGreaterThan(0);
  });

  it("still reaches a file named like a command by its path", () => {
    const res = runCli(["./redact"], tempDir());
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('Unexpected argument "./redact"');
  });
});

describe("--help of the commands", () => {
  it("prints the help of htv redact and exits 0", () => {
    const res = runCli(["redact", "--help"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Usage: htv redact");
    expect(res.stdout).toContain("--mask-hosts");
    expect(res.stderr).toBe("");
    expect(runCli(["redact", "-h"]).stdout).toBe(res.stdout);
  });

  it("prints the help of htv completion and exits 0", () => {
    const res = runCli(["completion", "--help"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Usage: htv completion");
    expect(res.stdout).toContain("bash");
    expect(res.stderr).toBe("");
  });
});

describe("an unknown option", () => {
  it("names the closest known flag", () => {
    expect(() => parseArgs(["--formt", "json"])).toThrow(
      "Unknown option '--formt'. Did you mean '--format'? See htv --help."
    );
    expect(() => parseArgs(["--compare-wit", "b.har"])).toThrow(/Did you mean '--compare-with'\?/);
    expect(() => parseArgs(["--mask-host"])).toThrow(/Did you mean '--mask-hosts'\?/);
  });

  it("only points at the help when nothing is close", () => {
    expect(() => parseArgs(["--zzzzzzzz"])).toThrow("Unknown option '--zzzzzzzz'. See htv --help.");
    expect(() => parseArgs(["-x"])).toThrow("Unknown option '-x'. See htv --help.");
  });

  it("names the flags of htv redact for that command", () => {
    expect(() => parseRedactArgs(["a.har", "--mask-host"])).toThrow(
      "Unknown option '--mask-host'. Did you mean '--mask-hosts'? See htv redact --help."
    );
    expect(() => parseRedactArgs(["a.har", "--format"])).toThrow(
      "Unknown option '--format'. See htv redact --help."
    );
  });

  it("exits 1 with the suggestion on stderr, for the report and for redact", () => {
    const report = runCli(["a.har", "--formt", "json"]);
    expect(report.status).toBe(1);
    expect(report.stderr).toContain("Unknown option '--formt'. Did you mean '--format'?");
    const redact = runCli(["redact", "a.har", "--mask-host"]);
    expect(redact.status).toBe(1);
    expect(redact.stderr).toContain("Did you mean '--mask-hosts'?");
  });
});

describe("the removed --redact flag", () => {
  it("is an unknown option, with or without a level", () => {
    for (const arg of ["--redact", "--redact=mask-hosts", "--redact=all"]) {
      expect(() => parseArgs(["a.har", arg])).toThrow(/^Unknown option '--redact(=.*)?'/);
    }
    const res = runCli(["a.har", "--redact"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Unknown option '--redact'");
    expect(res.stderr).not.toContain("deprecated");
  });
});
