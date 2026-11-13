import { describe, it, expect } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

// Runs the built CLI inside a real pseudo-terminal, through the `script` utility that macOS and
// Linux ship, so the Ink TUI sees a TTY (the other CLI tests pipe stdout and get the report).
const CLI_ROOT = resolve(__dirname, "..");
const DIST_ENTRY = join(CLI_ROOT, "dist", "index.js");
const HAR = join(CLI_ROOT, "..", "core", "tests", "fixtures", "webperf-snippets.har.fixture.json");

const LEAVE_ALT_SCREEN = "\u001B[?1049l";
// "Cache & network" shortens to "Cache" on the 80 columns a pseudo-terminal defaults to.
const TAB_NAMES = ["Findings", "Waterfall", "Resources", "Overview", "Steps", "Hosts", "Cache"];
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
function spawnInPty(command: string[], env: Record<string, string> = {}) {
  const base = { ...process.env };
  delete base.NO_COLOR;
  return spawn("sh", ["-c", `cat | script "$@"`, "sh", ...scriptArgs(command)], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...base, TERM: "xterm-256color", ...env },
  });
}

// The SGR codes that set a colour: 30-37, 90-97, 38 and 39, 40-47, 100-107, 48 and 49.
// eslint-disable-next-line no-control-regex
const COLOR_SGR = /\u001B\[(?:\d+;)*(?:3\d|9[0-7]|4\d|10[0-7])(?:;\d+)*m/;

// Starts the TUI, runs `act` once the first frame is up and returns what it drew and how it ended.
async function session(
  env: Record<string, string>,
  act: (child: ReturnType<typeof spawnInPty>, state: { closed: boolean }) => Promise<void> | void
) {
  const child = spawnInPty(["node", DIST_ENTRY, "--page", "Home", "--har", HAR], env);
  let output = "";
  let started = false;
  const state = { closed: false };
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    output += chunk;
    if (!started && output.includes("q quit")) {
      started = true;
      void Promise.resolve(act(child, state));
    }
    if (output.includes(LEAVE_ALT_SCREEN)) child.stdin.end();
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
  const code = await new Promise<number | null>((done) =>
    child.on("close", (c) => {
      state.closed = true;
      done(c);
    })
  );
  clearTimeout(timer);
  return { output, code, started };
}

const runTty = hasScript() ? it : it.skip;
if (!hasScript()) {
  console.warn("tty.test.ts skipped: the `script` utility is not available on this platform");
}

describe("htv in a pseudo-terminal", () => {
  runTty(
    "explains that the terminal report needs an interactive terminal when stdin is not a TTY",
    async () => {
      const command = `node ${quote(DIST_ENTRY)} --har ${quote(HAR)} < /dev/null`;
      const child = spawnInPty(["sh", "-c", command]);
      child.stdin.end();

      let output = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => (output += chunk));
      const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
      const code = await new Promise<number | null>((done) => child.on("close", done));
      clearTimeout(timer);

      expect(output).toContain("The terminal report needs an interactive terminal");
      expect(output).not.toMatch(/Raw mode|at .*\(/);
      expect(code).toBe(1);
    },
    TIMEOUT_MS + 2_000
  );

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
        // The first frame is on screen once the status bar has been drawn.
        if (!sentQuit && output.includes("q quit")) {
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

  runTty(
    "colours the TUI, unless NO_COLOR is set to a non-empty value",
    async () => {
      const quit = (child: ReturnType<typeof spawnInPty>) => void child.stdin.write("q");
      const coloured = await session({}, quit);
      const plain = await session({ NO_COLOR: "1" }, quit);

      expect(coloured.output).toMatch(COLOR_SGR);
      expect(plain.started).toBe(true);
      expect(plain.output).not.toMatch(COLOR_SGR);
      expect(plain.output).toContain("Findings");
    },
    TIMEOUT_MS * 2 + 2_000
  );

  runTty(
    "does not quit on a bare Esc, only on q",
    async () => {
      let closedAfterEsc: boolean | undefined;
      const result = await session({}, async (child, state) => {
        child.stdin.write("\u001B");
        await new Promise((done) => setTimeout(done, 500));
        closedAfterEsc = state.closed;
        child.stdin.write("q");
      });

      expect(result.started).toBe(true);
      expect(closedAfterEsc).toBe(false);
      expect(result.code).toBe(0);
    },
    TIMEOUT_MS + 2_000
  );
});
