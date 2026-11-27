import { describe, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";
import { filterMouse } from "../src/tui/mouse-input";
import type { MouseEvent } from "../src/tui/mouse";

const ESC = "\u001B";

// A terminal stand-in: a stream that records the raw mode it is put in.
function fakeTerminal() {
  const source = new PassThrough() as PassThrough & {
    isTTY: boolean;
    setRawMode: (mode: boolean) => void;
    raw: boolean;
  };
  source.isTTY = true;
  source.raw = false;
  source.setRawMode = (mode) => {
    source.raw = mode;
  };
  return source;
}

// A write to the terminal stand-in reaches the filter before `write` returns, so what the filter
// does at once can be checked right after it. What it does later (the held Esc) is awaited by its
// result, never by a fixed wait.
const until = (check: () => void) => vi.waitFor(check, { timeout: 3_000, interval: 5 });

function open() {
  const source = fakeTerminal();
  const events: MouseEvent[] = [];
  const { input, close } = filterMouse(source as unknown as NodeJS.ReadStream, (e) =>
    events.push(e)
  );
  let text = "";
  input.setEncoding("utf8");
  input.on("data", (chunk: string) => (text += chunk));
  return { source, input, events, close, text: () => text };
}

describe("the input of the terminal report", () => {
  it("looks like a terminal to Ink and puts the real one in raw mode", () => {
    const { source, input, close } = open();
    expect(input.isTTY).toBe(true);
    input.setRawMode(true);
    expect(source.raw).toBe(true);
    input.setRawMode(false);
    expect(source.raw).toBe(false);
    close();
  });

  it("hands on the keys and takes the mouse reports out", async () => {
    const { source, events, text, close } = open();
    source.write(`a${ESC}[<64;10;5Mb${ESC}[A`);
    await until(() => expect(text()).toBe(`ab${ESC}[A`));
    expect(events).toEqual([{ type: "wheel-up", button: 0, x: 10, y: 5 }]);
    close();
  });

  it("joins a report split across two writes", async () => {
    const { source, events, text, close } = open();
    source.write(`${ESC}[<0;3`);
    expect(text()).toBe("");
    expect(events).toEqual([]);
    source.write(`;4Mq`);
    await until(() => expect(text()).toBe("q"));
    expect(events).toEqual([{ type: "press", button: 0, x: 3, y: 4 }]);
    close();
  });

  it("lets a lone Esc through after a moment, as the key it is", async () => {
    const { source, text, close } = open();
    source.write(ESC);
    // Held: the write has returned and nothing has been passed on yet.
    expect(text()).toBe("");
    await until(() => expect(text()).toBe(ESC));
    close();
  });

  it("reads a multi-byte character split across two writes", async () => {
    const { source, text, close } = open();
    const bytes = Buffer.from("é");
    source.write(bytes.subarray(0, 1));
    source.write(bytes.subarray(1));
    await until(() => expect(text()).toBe("é"));
    close();
  });

  it("stops reading the terminal once closed", () => {
    const { source, events, close } = open();
    close();
    source.write(`${ESC}[<64;1;1M`);
    expect(events).toEqual([]);
    expect(source.listenerCount("data")).toBe(0);
  });
});
