// Which command an invocation names: `htv redact ...` and `htv completion ...`, or a report run.

const COMMANDS = ["redact", "completion"] as const;
export type Command = (typeof COMMANDS)[number];

// The flags that go before a command and take no value. --debug is the only one every command
// shares; anything else before the command belongs to a report run.
const GLOBAL_FLAGS = new Set(["--debug"]);

/**
 * The command in `argv` and the arguments after it. The command is the first argument that is not
 * a global flag: `htv --debug redact x.har` is `htv redact x.har` with debugging on. A file named
 * like a command is reached by any other spelling of its path (`./redact`) or with `--har`.
 */
export function splitCommand(argv: string[]): { command?: Command; rest: string[] } {
  let start = 0;
  while (GLOBAL_FLAGS.has(argv[start] ?? "")) start++;
  const command = COMMANDS.find((name) => name === argv[start]);
  if (!command) return { rest: argv };
  return { command, rest: argv.slice(start + 1) };
}
