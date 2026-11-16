import { render } from "ink";
import type { Instance } from "ink";
import type { Report } from "../cli.js";
import { TuiApp } from "./App.js";
import { MOUSE_OFF, MOUSE_ON } from "./mouse.js";
import type { MouseControl, MouseEvent } from "./mouse.js";
import { filterMouse } from "./mouse-input.js";

// Alternate screen buffer: the TUI takes the whole terminal and leaves the scrollback as it was.
const ENTER_ALT_SCREEN = "\u001B[?1049h";
const LEAVE_ALT_SCREEN = "\u001B[?1049l";
// The signals that end the process without the app's own exit, with the exit codes of a shell.
const SIGNALS = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 } as const;

export interface TuiOptions {
  /** Starts with the mouse reported; `m` switches it. On unless false. */
  mouse?: boolean;
}

/** Shows the report in the terminal until the user quits. */
export async function runTui(
  { flow, compare }: Report,
  version: string,
  { mouse = true }: TuiOptions = {}
): Promise<void> {
  const listeners = new Set<(event: MouseEvent) => void>();
  const input = filterMouse(process.stdin, (event) => listeners.forEach((l) => l(event)));
  const control: MouseControl = {
    enabled: mouse,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    setEnabled(on) {
      process.stdout.write(on ? MOUSE_ON : MOUSE_OFF);
    },
  };

  // Gives the terminal back as it was. It runs on every way out: the app's own exit, a signal,
  // an error, process.exit; a terminal left reporting the mouse prints escape codes at the prompt.
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    process.stdout.write(MOUSE_OFF + LEAVE_ALT_SCREEN);
  };
  // Ink draws a last frame when it unmounts: it goes first, onto the screen about to be left.
  let app: Instance | undefined;
  const onSignal = (signal: keyof typeof SIGNALS) => () => {
    app?.unmount();
    process.exit(SIGNALS[signal]);
  };
  const handlers = (Object.keys(SIGNALS) as (keyof typeof SIGNALS)[]).map(
    (signal) => [signal, onSignal(signal)] as const
  );
  for (const [signal, handler] of handlers) process.on(signal, handler);

  process.stdout.write(ENTER_ALT_SCREEN);
  if (mouse) process.stdout.write(MOUSE_ON);
  try {
    app = render(<TuiApp flow={flow} compare={compare} version={version} mouse={control} />, {
      stdin: input.input,
    });
    process.on("exit", restore);
    await app.waitUntilExit();
  } finally {
    restore();
    process.off("exit", restore);
    for (const [signal, handler] of handlers) process.off(signal, handler);
    input.close();
  }
}
