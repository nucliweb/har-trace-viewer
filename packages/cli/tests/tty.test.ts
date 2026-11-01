import { describe, it, expect } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

// Runs the built CLI inside a real pseudo-terminal, through the `script` utility that macOS and
// Linux ship, so the Ink TUI sees a TTY (the other CLI tests pipe stdout and get the report).
const CLI_ROOT = resolve(__dirname, "..");
const DIST_ENTRY = join(CLI_ROOT, "dist", "index.js");
const HAR = join(CLI_ROOT, "..", "core", "tests", "fixtures", "webperf-snippets.har.fixture.json");

const LEAVE_ALT_SCREEN = "\u001B[?1049l";
const TAB_NAMES = ["Findings", "Waterfall", "Overview", "Steps", "Hosts", "Cache & network"];
const TIMEOUT_MS = 10_000;

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

function hasScript(): boolean {
  if (process.platform === "win32") return false;
  return spawnSync("script", ["-q", "/dev/null", "true"], { stdio: "ignore" }).status === 0;
}

// BSD script (macOS) takes the command as arguments and exits with its status; util-linux script
// wants one string and -e to exit with the status too.
function scriptArgs(command: string[]): string[] {
  return process.platform === "darwin"
    ? ["-q", "/dev/null", ...command]
    : ["-q", "-e", "-c", command.map(quote).join(" "), "/dev/null"];
}

// Node hands a child a socket as stdin, and BSD script refuses sockets (tcgetattr fails). `cat`
// relays our stdin into a real pipe, which script accepts everywhere.
function spawnInPty(command: string[]) {
  return spawn("sh", ["-c", `cat | script "$@"`, "sh", ...scriptArgs(command)], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, TERM: "xterm-256color", NO_COLOR: "1" },
  });
}

const runTty = hasScript() ? it : it.skip;
if (!hasScript()) {
  console.warn("tty.test.ts skipped: the `script` utility is not available on this platform");
}

describe("htv in a pseudo-terminal", () => {
  runTty(
    "draws the TUI, quits on q and leaves the alternate screen",
    async () => {
      const started = Date.now();
      const child = spawnInPty(["node", DIST_ENTRY, "--page", "Home", "--har", HAR]);

      let output = "";
      let sentQuit = false;
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        output += chunk;
        // The first frame is on screen once the last tab name has been drawn.
        if (!sentQuit && output.includes("Cache & network")) {
          sentQuit = true;
          child.stdin.write("q");
        }
        // Closing stdin earlier would cut the key off; once the app is gone, `cat` can end.
        if (output.includes(LEAVE_ALT_SCREEN)) child.stdin.end();
      });

      const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
      const code = await new Promise<number | null>((done) => child.on("close", done));
      clearTimeout(timer);

      expect(sentQuit, `no first frame in:\n${output}`).toBe(true);
      expect(code).toBe(0);
      for (const name of TAB_NAMES) expect(output).toContain(name);
      expect(output).toContain(LEAVE_ALT_SCREEN);
      expect(Date.now() - started).toBeLessThan(TIMEOUT_MS);
    },
    TIMEOUT_MS + 2_000
  );
});
