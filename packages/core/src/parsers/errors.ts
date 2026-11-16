/** Why a recording could not be parsed; each code has parameters of its own (see ParseError). */
export type ParseErrorCode =
  | "not-json"
  | "unrecognized-json"
  | "wrong-kind"
  | "har-no-entries"
  | "har-no-usable-entries"
  | "trace-no-navigation";

/** The parameters of an error: plain strings, so they survive a structured clone. */
export type ParseErrorParams = Record<string, string>;

/**
 * A parser's error: its English `message` is written for the command line, and `code` with
 * `params` let another caller (the web app) word it in its own language. Parameters by code:
 * `not-json` has `kind` ("har" | "trace") and `detail` (the JSON parser's message);
 * `unrecognized-json` has `kind`; `wrong-kind` has `kind` (what was asked for) and `found`
 * (what the file is); the others have none. A caller with codes of its own names them in `Code`.
 */
export class ParseError<Code extends string = ParseErrorCode> extends Error {
  constructor(
    message: string,
    readonly code: Code,
    readonly params: ParseErrorParams = {},
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "ParseError";
  }
}
