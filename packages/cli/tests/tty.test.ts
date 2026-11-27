import { describe, it, expect, vi } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

// Runs the built CLI inside a real pseudo-terminal, through the `script` utility that macOS and
// Linux ship, so the Ink TUI sees a TTY (the other CLI tests pipe stdout and get the report).
const CLI_ROOT = resolve(__dirname, "..");
const DIST_ENTRY = join(CLI_ROOT, "dist", "index.js");
const HAR = join(CLI_ROOT, "..", "core", "tests", "fixtures", "webperf-snippets.har.fixture.json");

const LEAVE_ALT_SCREEN = "\u001B[?1049l";
const MOUSE_ON = "\u001B[?1000h\u001B[?1006h";
const MOUSE_OFF = "\u001B[?1006l\u001B[?1000l";
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

interface SessionState {
  closed: boolean;
  output: string;
  // Resolves once `text` shows up in what the TUI drew after the first `from` characters.
  drew: (text: string, from?: number) => Promise<void>;
}

// Starts the TUI, runs `act` once the first frame is up and returns what it drew and how it ended.
async function session(
  env: Record<string, string>,
  act: (child: ReturnType<typeof spawnInPty>, state: SessionState) => Promise<void> | void
) {
  const child = spawnInPty(["node", DIST_ENTRY, "--page", "Home", "--har", HAR], env);
  let output = "";
  let started = false;
  const state: SessionState = {
    closed: false,
    output: "",
    drew: (text, from = 0) =>
      vi.waitFor(
        () => {
          if (!state.output.slice(from).includes(text)) {
            throw new Error(`The TUI did not draw ${JSON.stringify(text)} in:\n${state.output}`);
          }
        },
        { timeout: TIMEOUT_MS / 2, interval: 5 }
      ),
  };
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    output += chunk;
    state.output = output;
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
        // The help closes on Esc, so the status bar coming back shows the app took the Esc as a
        // key; only then is it known that the Esc did not quit.
        child.stdin.write("?");
        await state.drew("close help");
        const afterHelp = state.output.length;
        child.stdin.write("\u001B");
        await state.drew("q quit", afterHelp);
        closedAfterEsc = state.closed;
        child.stdin.write("q");
      });

      expect(result.started).toBe(true);
      expect(closedAfterEsc).toBe(false);
      expect(result.code).toBe(0);
    },
    TIMEOUT_MS + 2_000
  );

  runTty(
    "reports the mouse while it runs and always turns the reporting off when it quits",
    async () => {
      const result = await session({}, (child) => void child.stdin.write("q"));
      expect(result.code).toBe(0);
      expect(result.output).toContain(MOUSE_ON);
      expect(result.output.lastIndexOf(MOUSE_OFF)).toBeGreaterThan(result.output.indexOf(MOUSE_ON));
      expect(result.output.indexOf(MOUSE_OFF + LEAVE_ALT_SCREEN)).toBeGreaterThan(-1);
    },
    TIMEOUT_MS + 2_000
  );

  runTty(
    "does not read a mouse report as keys: a wheel turn does not quit and Esc is not typed",
    async () => {
      let closedAfterReports: boolean | undefined;
      const result = await session({}, async (child, state) => {
        child.stdin.write("\u001B[<65;10;10M\u001B[<0;5;5M\u001B[<0;5;5m");
        // The input is read in order: once the Waterfall tab is up, the reports before the key
        // for it have been read too.
        const afterStart = state.output.length;
        child.stdin.write("2");
        await state.drew("z axis", afterStart);
        closedAfterReports = state.closed;
        child.stdin.write("q");
      });
      expect(closedAfterReports).toBe(false);
      expect(result.code).toBe(0);
    },
    TIMEOUT_MS + 2_000
  );

  runTty(
    "leaves the mouse alone with --no-mouse, and still turns the reporting off on exit",
    async () => {
      const child = spawnInPty(["node", DIST_ENTRY, "--page", "Home", "--har", HAR, "--no-mouse"]);
      let output = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        output += chunk;
        if (output.includes("q quit") && !output.includes("QUIT-SENT")) {
          output += "QUIT-SENT";
          child.stdin.write("q");
        }
        if (output.includes(LEAVE_ALT_SCREEN)) child.stdin.end();
      });
      const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
      const code = await new Promise<number | null>((done) => child.on("close", done));
      clearTimeout(timer);
      expect(code).toBe(0);
      expect(output).not.toContain(MOUSE_ON);
      expect(output).toContain(MOUSE_OFF);
    },
    TIMEOUT_MS + 2_000
  );

  runTty(
    "turns the reporting off when it is interrupted by a signal",
    async () => {
      // The shell signals the CLI itself: a signal sent to the pty's own child would miss it.
      const command = `node ${quote(DIST_ENTRY)} --page Home --har ${quote(HAR)} <&0 & pid=$!; sleep 3; kill -INT $pid; wait $pid`;
      const child = spawnInPty(["sh", "-c", command]);
      let output = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        output += chunk;
        if (output.includes(MOUSE_OFF + LEAVE_ALT_SCREEN)) child.stdin.end();
      });
      const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
      const code = await new Promise<number | null>((done) => child.on("close", done));
      clearTimeout(timer);
      expect(output).toContain(MOUSE_ON);
      expect(output).toContain(MOUSE_OFF + LEAVE_ALT_SCREEN);
      expect(code).toBe(130);
    },
    TIMEOUT_MS + 2_000
  );
});
