import type { Flow, FlowOptions, PageFlow, ParsedHar, ParsedTrace } from "@htv/core";

export type ParseKind = "har" | "trace";
type ParsePhase = "reading" | "decompressing" | "parsing";

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

/** generateFlow(pages, options), off the main thread. */
export interface FlowRequest {
  id: number;
  kind: "flow";
  pages: PageFlow[];
  options: FlowOptions;
}

export type WorkerRequest = ParseRequest | FlowRequest;

export type ParseResultFor<K extends ParseKind> = K extends "har" ? ParsedHar[] : ParsedTrace;

/** A generated flow comes back with `pages` empty: the page already holds them. */
export type WorkerResult = ParsedHar[] | ParsedTrace | Flow;

export type ParseResponse =
  | { id: number; progress: ParseProgress }
  | { id: number; ok: true; result: WorkerResult }
  | { id: number; ok: false; error: string };
