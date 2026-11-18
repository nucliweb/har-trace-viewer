// Mouse reporting for the terminal report: the sequences that turn it on and off, and a parser
// that takes the reports (SGR encoding, `ESC [ < button ; column ; row M|m`) out of the stream
// of input, so that they are never read as keys.

const ESC = "\u001B";

/** Asks the terminal to report button presses and the wheel, in the SGR encoding. */
export const MOUSE_ON = `${ESC}[?1000h${ESC}[?1006h`;
/** Stops the reports; the reverse of MOUSE_ON. */
export const MOUSE_OFF = `${ESC}[?1006l${ESC}[?1000l`;

export interface MouseEvent {
  type: "press" | "release" | "wheel-up" | "wheel-down" | "move";
  /** 0 left, 1 middle, 2 right. */
  button: number;
  /** The cell, from 1 at the top left. */
  x: number;
  y: number;
}

export interface MouseParser {
  /** The input with the mouse reports taken out, and the reports. A partial one is held. */
  push(chunk: string): { text: string; events: MouseEvent[] };
  /** Gives up on what is held (a lone Esc, say) and returns it as input. */
  flush(): string;
}

const INTRO = `${ESC}[<`;
// The longest report is `ESC [ < 3 digits ; 4 digits ; 4 digits M`; longer than this is noise.
const MAX_HELD = 32;
// eslint-disable-next-line no-control-regex
const REPORT = /^\u001B\[<(\d{1,5});(\d{1,5});(\d{1,5})([Mm])/;
// What a report looks like up to the end of the chunk: the rest may arrive in the next one.
// eslint-disable-next-line no-control-regex
const PARTIAL = /^\u001B\[<[\d;]*$/;
// A report with the wrong parameters: the introducer, then parameters and a final byte.
// eslint-disable-next-line no-control-regex
const MALFORMED = /^\u001B\[<[\d;]*[@-~]?/;

function toEvent(code: number, x: number, y: number, final: string): MouseEvent | null {
  // Bits 4, 8 and 16 are the modifiers, 32 marks motion, 64 the wheel.
  const base = code & ~(4 | 8 | 16);
  if (base >= 128 || x < 1 || y < 1) return null;
  if (base & 64) {
    return base === 64 || base === 65
      ? { type: base === 64 ? "wheel-up" : "wheel-down", button: 0, x, y }
      : null;
  }
  const button = base & 3;
  if (base & 32) return { type: "move", button: button === 3 ? 0 : button, x, y };
  if (button === 3) return null;
  return { type: final === "M" ? "press" : "release", button, x, y };
}

export function createMouseParser(): MouseParser {
  let held = "";
  return {
    push(chunk) {
      const input = held + chunk;
      held = "";
      const events: MouseEvent[] = [];
      let text = "";
      let i = 0;
      while (i < input.length) {
        const esc = input.indexOf(ESC, i);
        if (esc === -1) {
          text += input.slice(i);
          break;
        }
        text += input.slice(i, esc);
        const rest = input.slice(esc);
        const match = REPORT.exec(rest);
        if (match) {
          const found = toEvent(
            Number(match[1]),
            Number(match[2]),
            Number(match[3]),
            match[4] ?? ""
          );
          if (found) events.push(found);
          i = esc + match[0].length;
        } else if (INTRO.startsWith(rest) || (PARTIAL.test(rest) && rest.length <= MAX_HELD)) {
          held = rest;
          break;
        } else if (rest.startsWith(INTRO)) {
          // Malformed: dropped with its parameters and its final byte, when there is one.
          i = esc + (MALFORMED.exec(rest) as RegExpExecArray)[0].length;
        } else {
          text += ESC;
          i = esc + 1;
        }
      }
      return { text, events };
    },
    flush() {
      const rest = held;
      held = "";
      return rest;
    },
  };
}

/** What the report needs of the mouse: its events, and a switch for the terminal's reporting. */
export interface MouseControl {
  /** Listens to the reports; returns the function that stops. */
  subscribe(listener: (event: MouseEvent) => void): () => void;
  /** Turns the reporting on or off in the terminal. */
  setEnabled(on: boolean): void;
  /** Whether the reporting is on to begin with. */
  enabled: boolean;
}
