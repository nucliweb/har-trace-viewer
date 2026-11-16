// `htv completion bash|zsh|fish`: the completion script of a shell, from one list of flags.
// tests/completion.test.ts holds the list against --help and against the parser, so that it
// cannot drift: a flag the help documents and the list lacks fails the build.

import { CLIENT_REGIONS, RUN_METRIC_CHOICES } from "@htv/core";

export const SHELLS = ["bash", "zsh", "fish"] as const;
export type Shell = (typeof SHELLS)[number];

/** What a flag takes: a file, a file or a directory, free text, one of a list; nothing when absent. */
type FlagValue = "file" | "path" | "text" | readonly string[];

export interface Flag {
  name: string;
  short?: string;
  description: string;
  value?: FlagValue;
}

const OUTPUT_FORMATS = ["tui", "html", "json", "findings", "markdown", "csv", "mermaid"];
const CHECK_FORMATS = ["text", "json", "junit", "github"];
const FAIL_ON = ["critical", "warning"];
const RUNS = ["median", "all", ...RUN_METRIC_CHOICES.map((metric) => `median:${metric}`)];

/** The flags of `htv`, in the order of --help. */
export const FLAGS: readonly Flag[] = [
  {
    name: "output",
    short: "o",
    description: "Where the report goes: .html, .json, .md, .csv or a directory",
    value: "path",
  },
  { name: "format", description: "The format of the report", value: OUTPUT_FORMATS },
  { name: "bundle", description: "Inline every asset into index.html of a directory report" },
  {
    name: "redact",
    description: "Redact the report (--redact=mask-hosts also masks third-party hosts)",
  },
  { name: "demo", description: "Report the built-in example" },
  { name: "page", description: "Start a page of the report", value: "text" },
  { name: "har", description: "The HAR of the preceding page", value: "file" },
  { name: "trace", description: "The Chrome trace of the preceding page", value: "file" },
  { name: "select", description: "Keep the matching pages of a multi-page HAR", value: "text" },
  { name: "runs", description: "The WebPageTest runs to keep", value: RUNS },
  { name: "list-pages", description: "Print the pages of each HAR and exit" },
  {
    name: "filter",
    description: "Keep the requests matching a query (csv and json)",
    value: "text",
  },
  { name: "compare", description: "Compare the two pages of the flow" },
  { name: "compare-with", description: "Compare the flow with another HAR", value: "file" },
  {
    name: "compare-trace",
    description: "The Chrome trace of the --compare-with HAR",
    value: "file",
  },
  {
    name: "compare-select",
    description: "The page of a multi-page --compare-with HAR",
    value: "text",
  },
  { name: "compare-region", description: "The client region of side B", value: CLIENT_REGIONS },
  {
    name: "budget",
    description: "Fail when a page goes over a limit, e.g. lcp=2.5s",
    value: "text",
  },
  { name: "check-format", description: "The format of the check result", value: CHECK_FORMATS },
  { name: "check-output", description: "Also write the check result to a file", value: "path" },
  { name: "budget-strict", description: "Fail a budget whose metric the page lacks" },
  { name: "fail-on", description: "Fail on a finding of this severity or worse", value: FAIL_ON },
  { name: "region", description: "The client network region", value: CLIENT_REGIONS },
  { name: "no-mouse", description: "Start the terminal report without mouse reporting" },
  { name: "debug", description: "Write diagnostics to stderr" },
  { name: "help", short: "h", description: "Show the help" },
  { name: "version", short: "v", description: "Show the version" },
];

/** The flags of `htv redact`. */
export const REDACT_FLAGS: readonly Flag[] = [
  { name: "output", short: "o", description: "Write the redacted HAR to this file", value: "path" },
  { name: "mask-hosts", description: "Also mask third-party hostnames" },
];

const SUBCOMMANDS = [
  { name: "redact", description: "Write a redacted copy of a HAR" },
  { name: "completion", description: "Print a shell completion script" },
];

const words = (flags: readonly Flag[]) =>
  flags.flatMap((f) => [`--${f.name}`, ...(f.short ? [`-${f.short}`] : [])]);
const quoteSh = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
const choices = (flag: Flag) => (Array.isArray(flag.value) ? (flag.value as string[]) : null);

function bash(): string {
  const caseOf = (kind: (f: Flag) => boolean, action: string) => {
    const names = FLAGS.filter(kind).flatMap((f) => [
      `--${f.name}`,
      ...(f.short ? [`-${f.short}`] : []),
    ]);
    return names.length > 0 ? `    ${names.join("|")}) ${action} ;;\n` : "";
  };
  const enums = FLAGS.filter((f) => choices(f))
    .map(
      (f) =>
        `    --${f.name}) COMPREPLY=( $(compgen -W ${quoteSh(choices(f)!.join(" "))} -- "$cur") ); return 0 ;;\n`
    )
    .join("");
  return `# htv completion for bash. Load it with: source <(htv completion bash)
# Adds the files and directories that start with $cur, one per line so that a name may hold spaces.
_htv_files() {
  local IFS=$'\\n'
  COMPREPLY+=( $(compgen -f -- "$cur") )
}

_htv() {
  local cur prev cmd
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev=""
  if [ "$COMP_CWORD" -gt 0 ]; then prev="\${COMP_WORDS[COMP_CWORD-1]}"; fi
  cmd="\${COMP_WORDS[1]}"

  if [ "$cmd" = completion ]; then
    if [ "$COMP_CWORD" -eq 2 ]; then COMPREPLY=( $(compgen -W ${quoteSh(SHELLS.join(" "))} -- "$cur") ); fi
    return 0
  fi
  if [ "$cmd" = redact ] && [ "$COMP_CWORD" -gt 1 ]; then
    case "$prev" in
      -o|--output) _htv_files; return 0 ;;
    esac
    if [[ "$cur" == -* ]]; then
      COMPREPLY=( $(compgen -W ${quoteSh(words(REDACT_FLAGS).join(" "))} -- "$cur") )
    else
      _htv_files
    fi
    return 0
  fi

  case "$prev" in
${enums}${caseOf((f) => f.value === "file" || f.value === "path", "_htv_files; return 0")}${caseOf((f) => f.value === "text", "return 0")}  esac

  if [[ "$cur" == -* ]]; then
    COMPREPLY=( $(compgen -W ${quoteSh(words(FLAGS).join(" "))} -- "$cur") )
    return 0
  fi
  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( $(compgen -W ${quoteSh(SUBCOMMANDS.map((c) => c.name).join(" "))} -- "$cur") )
  fi
  _htv_files
  return 0
}
complete -o filenames -F _htv htv
`;
}

// The description inside [...] of an _arguments spec, in single quotes.
const zshText = (text: string) => text.replace(/[\][\\:]/g, "\\$&");

function zsh(): string {
  const spec = (flag: Flag, redact = false) => {
    const label = zshText(flag.description);
    const value =
      redact && flag.name === "mask-hosts"
        ? ""
        : flag.name === "redact" && !redact
          ? "::level:(mask-hosts)"
          : choices(flag)
            ? `:${flag.name}:(${choices(flag)!.join(" ")})`
            : flag.value === "file" || flag.value === "path"
              ? `:${flag.value}:_files`
              : flag.value === "text"
                ? `:${flag.name}: `
                : "";
    const equals = flag.value || flag.name === "redact" ? "=" : "";
    const dash = flag.name === "redact" && !redact ? "-" : "";
    const long = `--${flag.name}${equals}${dash}`;
    if (flag.short) {
      return `'(-${flag.short} --${flag.name})'{-${flag.short},--${flag.name}${equals}}'[${label}]${value}'`;
    }
    if (flag.name === "help" || flag.name === "version") return `'(- *)${long}[${label}]'`;
    return `'${long}[${label}]${value}'`;
  };
  const lines = (flags: readonly Flag[], redact = false) =>
    flags.map((f) => `    ${spec(f, redact)} \\`).join("\n");
  return `#compdef htv
# htv completion for zsh. Load it with: source <(htv completion zsh), after compinit.
_htv_first() {
  _alternative 'commands:command:(${SUBCOMMANDS.map((c) => c.name).join(" ")})' 'files:file:_files'
}

_htv() {
  case $words[2] in
    redact)
      if (( CURRENT > 2 )); then
        _arguments -s \\
${lines(REDACT_FLAGS, true)}
          '2:HAR file:_files'
        return
      fi
      ;;
    completion)
      if (( CURRENT > 2 )); then
        _arguments '2:shell:(${SHELLS.join(" ")})'
        return
      fi
      ;;
  esac
  _arguments -s \\
${lines(FLAGS)}
    '1: :_htv_first' \\
    '*:file:_files'
}

if [ "$funcstack[1]" = "_htv" ]; then
  _htv "$@"
else
  compdef _htv htv
fi
`;
}

const fishText = (text: string) => text.replaceAll("\\", "\\\\").replaceAll("'", "\\'");

function fish(): string {
  const line = (flag: Flag, condition = "") => {
    const parts = ["complete -c htv"];
    if (condition) parts.push(`-n ${quoteFish(condition)}`);
    if (flag.short) parts.push(`-s ${flag.short}`);
    parts.push(`-l ${flag.name}`);
    if (choices(flag)) parts.push(`-x -a '${choices(flag)!.join(" ")}'`);
    else if (flag.value === "file" || flag.value === "path") parts.push("-r");
    else if (flag.value === "text") parts.push("-x");
    parts.push(`-d '${fishText(flag.description)}'`);
    return parts.join(" ");
  };
  const quoteFish = (text: string) => `'${fishText(text)}'`;
  return `# htv completion for fish. Load it with: htv completion fish | source
${SUBCOMMANDS.map(
  (c) => `complete -c htv -n '__fish_use_subcommand' -a ${c.name} -d '${fishText(c.description)}'`
).join("\n")}
complete -c htv -n '__fish_seen_subcommand_from completion' -f -a '${SHELLS.join(" ")}'
${FLAGS.map((f) => line(f, "not __fish_seen_subcommand_from redact completion")).join("\n")}
${REDACT_FLAGS.map((f) => line(f, "__fish_seen_subcommand_from redact")).join("\n")}
`;
}

/** The completion script of `shell`. */
export function generateCompletion(shell: Shell): string {
  return { bash, zsh, fish }[shell]();
}

/** `htv completion <shell>`: prints the script to stdout. */
export function runCompletionCommand(argv: string[]): void {
  const shell = SHELLS.find((s) => s === argv[0]);
  if (!shell || argv.length !== 1) {
    throw new Error(`Usage: htv completion <shell>, with the shell one of ${SHELLS.join(", ")}`);
  }
  process.stdout.write(generateCompletion(shell));
}
