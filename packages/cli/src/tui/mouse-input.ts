import { PassThrough } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { createMouseParser } from "./mouse.js";
import type { MouseEvent } from "./mouse.js";

// How long a lone Esc is held in case the rest of a mouse report is on its way.
const ESC_HOLD_MS = 30;

/** The terminal's input as Ink sees it: a stream that passes for a TTY. */
type InkInput = PassThrough & {
  isTTY: true;
  setRawMode: (mode: boolean) => void;
  ref: () => void;
  unref: () => void;
};

/**
 * Reads the terminal and passes everything but the mouse reports on to the stream it returns,
 * which goes to Ink as its input; the reports go to `onEvent`. Ink never sees them, so that
 * they cannot be read as keys, not even when a report is split across two reads.
 */
export function filterMouse(
  terminal: NodeJS.ReadStream,
  onEvent: (event: MouseEvent) => void
): { input: NodeJS.ReadStream; close: () => void } {
  const input = new PassThrough() as InkInput;
  input.isTTY = true;
  input.setRawMode = (mode) => void terminal.setRawMode?.(mode);
  input.ref = () => void terminal.ref?.();
  input.unref = () => void terminal.unref?.();

  const parser = createMouseParser();
  const decoder = new StringDecoder("utf8");
  let timer: NodeJS.Timeout | undefined;
  const pass = (text: string) => {
    if (text) input.write(text);
  };
  const onData = (chunk: Buffer | string) => {
    clearTimeout(timer);
    const { text, events } = parser.push(typeof chunk === "string" ? chunk : decoder.write(chunk));
    pass(text);
    for (const event of events) onEvent(event);
    // What the parser holds may be the start of a report or a key that is only Esc.
    timer = setTimeout(() => pass(parser.flush()), ESC_HOLD_MS);
    timer.unref();
  };
  terminal.on("data", onData);

  return {
    input: input as unknown as NodeJS.ReadStream,
    close() {
      clearTimeout(timer);
      terminal.off("data", onData);
      terminal.pause();
    },
  };
}
