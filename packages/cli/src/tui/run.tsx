import { render } from "ink";
import type { Report } from "../cli.js";
import { TuiApp } from "./App.js";

// Alternate screen buffer: the TUI takes the whole terminal and leaves the scrollback as it was.
const ENTER_ALT_SCREEN = "\u001B[?1049h";
const LEAVE_ALT_SCREEN = "\u001B[?1049l";

/** Shows the report in the terminal until the user quits. */
export async function runTui({ flow, compare }: Report, version: string): Promise<void> {
  process.stdout.write(ENTER_ALT_SCREEN);
  try {
    const app = render(<TuiApp flow={flow} compare={compare} version={version} />);
    await app.waitUntilExit();
  } finally {
    process.stdout.write(LEAVE_ALT_SCREEN);
  }
}
