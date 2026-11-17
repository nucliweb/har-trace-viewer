import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { HELP, parseArgs } from "../src/cli";
import { FLAGS, REDACT_FLAGS, SHELLS, generateCompletion } from "../src/completion";

const DIST_ENTRY = resolve(__dirname, "..", "dist", "index.js");
const has = (shell: string) => spawnSync(shell, ["--version"], { stdio: "ignore" }).status === 0;

const long = (flag: { name: string }) => `--${flag.name}`;
const MAIN = FLAGS.map(long);
const REDACT = REDACT_FLAGS.map(long);

describe("the completion's flags", () => {
  it("cover every flag --help documents", () => {
    const documented = [...new Set(HELP.match(/--[a-z][a-z-]*/g))];
    // The deprecated alias is named in the help, in a note; the completion does not offer it.
    const known = new Set([...MAIN, ...REDACT, "--redact"]);
    expect(documented.filter((flag) => !known.has(flag))).toEqual([]);
  });

  it("are all documented in --help", () => {
    expect([...MAIN, ...REDACT].filter((flag) => !HELP.includes(flag))).toEqual([]);
  });

  it("are all accepted by the parser, with their short forms", () => {
    for (const flag of FLAGS) {
      const value = Array.isArray(flag.value) ? [flag.value[0]] : flag.value ? ["x"] : [];
      let message = "";
      try {
        parseArgs([long(flag), ...value]);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message, long(flag)).not.toMatch(/unknown option|argument missing|expects a value/i);
      if (flag.short) {
        try {
          parseArgs([`-${flag.short}`, ...value]);
        } catch (error) {
          expect((error as Error).message, `-${flag.short}`).not.toMatch(/unknown option/i);
        }
      }
    }
  });

  it("offer the values the parser accepts, no fewer and no more", () => {
    for (const name of ["format", "region", "compare-region", "fail-on", "check-format"]) {
      const flag = FLAGS.find((f) => f.name === name);
      let message = "";
      try {
        parseArgs([`--${name}`, "no-such-value"]);
      } catch (error) {
        message = (error as Error).message;
      }
      const accepted = /Valid values: ([^.]+)\./.exec(message)?.[1].split(", ");
      expect(flag?.value, name).toEqual(accepted);
    }
  });
});

describe("the completion scripts", () => {
  it("name every flag and every enumerated value, whatever the shell", () => {
    for (const shell of SHELLS) {
      const script = generateCompletion(shell);
      for (const flag of [...MAIN, ...REDACT])
        expect(script, `${shell} ${flag}`).toContain(flag.slice(2));
      for (const value of FLAGS.find((f) => f.name === "format")!.value as string[]) {
        expect(script, `${shell} ${value}`).toContain(value);
      }
      expect(script).toContain("redact");
      expect(script).toContain("completion");
    }
  });

  for (const shell of SHELLS) {
    // `fish -n` and the like parse without running; a shell that is not installed is skipped.
    (has(shell) ? it : it.skip)(`parse without a syntax error in ${shell}`, () => {
      const run = spawnSync(shell, ["-n"], { input: generateCompletion(shell), encoding: "utf8" });
      expect(run.stderr).toBe("");
      expect(run.status).toBe(0);
    });
  }

  // Sources the script in a real bash and asks it what completes the words.
  const complete = (words: string[]) => {
    const script = generateCompletion("bash");
    const run = spawnSync(
      "bash",
      [
        "-c",
        `source /dev/stdin <<'EOF'\n${script}\nEOF\ncd "$1"; shift; COMP_WORDS=("$@"); COMP_CWORD=$(($#-1)); COMP_LINE="$*"; COMP_POINT=\${#COMP_LINE}; _htv; printf '%s\\n' "\${COMPREPLY[@]}"`,
        "bash",
        join(__dirname, "..", "..", "core", "tests", "fixtures"),
        "htv",
        ...words,
      ],
      { encoding: "utf8" }
    );
    return run.stdout.split("\n").filter(Boolean);
  };

  (has("bash") ? it : it.skip)("completes in bash: flags, their values, subcommands", () => {
    expect(complete(["--forma"])).toEqual(["--format"]);
    expect(complete(["--format", ""])).toEqual(FLAGS.find((f) => f.name === "format")!.value);
    expect(complete(["--format", "ma"])).toEqual(["markdown"]);
    expect(complete(["--fail-on", ""])).toEqual(["critical", "warning"]);
    expect(complete(["--check-format", "j"])).toEqual(["json", "junit"]);
    expect(complete(["--no-m"])).toEqual(["--no-mouse"]);
    expect(complete(["--deb"])).toEqual(["--debug"]);
    expect(complete(["comp"])).toContain("completion");
    expect(complete(["completion", ""])).toEqual(["bash", "zsh", "fish"]);
    expect(complete(["redact", "--m"])).toEqual(["--mask-hosts"]);
    expect(complete(["--region", "c"])).toContain("cn");
  });

  (has("bash") ? it : it.skip)("completes the files of the folder after --har", () => {
    const files = complete(["--har", "webperf"]);
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((f) => f.startsWith("webperf"))).toBe(true);
  });

  // Types the line and a Tab in a real interactive zsh, through a pseudo-terminal of zsh's own
  // (zsh/zpty), with the script loaded after compinit. A prefix with one candidate completes in
  // place; none or several leave the line as typed.
  (has("zsh") ? it : it.skip)(
    "completes in zsh: flags, their values, subcommands",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "htv-zsh-"));
      writeFileSync(join(dir, "htv.zsh"), generateCompletion("zsh"));
      writeFileSync(
        join(dir, "drive.zsh"),
        `zmodload zsh/zpty
zpty z 'zsh -f -i'
drain() { out=; local c; while zpty -r -t z c; do out+=$c; done }
zpty -w z "PS1='> '; autoload -Uz compinit; compinit -u -d /dev/null; source ${dir}/htv.zsh; echo READY-\\$((20+22))"
for i in {1..40}; do sleep 0.25; drain; [[ $out == *READY-42* ]] && break; done
sleep 0.3; drain
for t in "$@"; do
  zpty -w -n z "$t"$'\\t'
  sleep 1; drain
  print -r -- "$t => \${out//[$'\\r\\n']/ }"
  zpty -w -n z $'\\025'; sleep 0.2; drain
done
zpty -d z
`
      );
      const lines = [
        ["--fail-on c", "--fail-on critical "],
        ["--format ma", "--format markdown "],
        ["--check-format ju", "--check-format junit "],
        ["--no-m", "--no-mouse "],
        ["--deb", "--debug "],
        ["comp", "completion "],
        ["completion z", "completion zsh "],
        ["redact --m", "redact --mask-hosts "],
      ];
      const run = spawnSync(
        "zsh",
        ["-f", join(dir, "drive.zsh"), ...lines.map(([typed]) => `htv ${typed}`)],
        { encoding: "utf8" }
      );
      const answers = run.stdout.split("\n").filter((line) => line.includes(" => "));
      for (const [typed, completed] of lines) {
        const answer = answers.find((line) => line.startsWith(`htv ${typed} => `));
        // eslint-disable-next-line no-control-regex
        const text = (answer ?? "").replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
        expect(text, `htv ${typed}`).toContain(`htv ${completed}`);
      }
    },
    30_000
  );
});

describe("htv completion", () => {
  const htv = (...args: string[]) => spawnSync("node", [DIST_ENTRY, ...args], { encoding: "utf8" });

  it("prints the script of each shell to stdout and nothing else", () => {
    for (const shell of SHELLS) {
      const run = htv("completion", shell);
      expect(run.status).toBe(0);
      expect(run.stdout).toBe(generateCompletion(shell));
      expect(run.stderr).toBe("");
    }
  });

  it("names the shells it knows when asked for another, or for none", () => {
    for (const args of [["completion", "powershell"], ["completion"]]) {
      const run = htv(...args);
      expect(run.status).toBe(1);
      expect(run.stdout).toBe("");
      expect(run.stderr).toContain("bash, zsh, fish");
    }
  });
});
