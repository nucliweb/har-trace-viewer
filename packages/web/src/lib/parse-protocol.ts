import type { ParsedHar, ParsedTrace } from "@htv/core";

export type ParseKind = "har" | "trace";
export type ParsePhase = "reading" | "decompressing" | "parsing";

export interface ParseProgress {
  phase: ParsePhase;
  /** Raw (possibly compressed) bytes consumed so far; 0 while parsing. */
  loaded: number;
  /** Size of the input file in bytes; 0 while parsing (indeterminate). */
  total: number;
}

export interface ParseRequest {
  id: number;
  kind: ParseKind;
  file: File;
}

export type ParseResultFor<K extends ParseKind> = K extends "har" ? ParsedHar[] : ParsedTrace;

export type ParseResponse =
  | { id: number; progress: ParseProgress }
  | { id: number; ok: true; result: ParsedHar[] | ParsedTrace }
  | { id: number; ok: false; error: string };
