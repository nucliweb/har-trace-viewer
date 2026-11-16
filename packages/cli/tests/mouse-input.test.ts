import { describe, expect, it } from "vitest";
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

const settle = (ms = 80) => new Promise((done) => setTimeout(done, ms));

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
    await settle();
    expect(text()).toBe(`ab${ESC}[A`);
    expect(events).toEqual([{ type: "wheel-up", button: 0, x: 10, y: 5 }]);
    close();
  });

  it("joins a report split across two writes", async () => {
    const { source, events, text, close } = open();
    source.write(`${ESC}[<0;3`);
    await settle(10);
    source.write(`;4Mq`);
    await settle();
    expect(text()).toBe("q");
    expect(events).toEqual([{ type: "press", button: 0, x: 3, y: 4 }]);
    close();
  });

  it("lets a lone Esc through after a moment, as the key it is", async () => {
    const { source, text, close } = open();
    source.write(ESC);
    await settle(10);
    expect(text()).toBe("");
    await settle(120);
    expect(text()).toBe(ESC);
    close();
  });

  it("reads a multi-byte character split across two writes", async () => {
    const { source, text, close } = open();
    const bytes = Buffer.from("é");
    source.write(bytes.subarray(0, 1));
    source.write(bytes.subarray(1));
    await settle();
    expect(text()).toBe("é");
    close();
  });

  it("stops reading the terminal once closed", async () => {
    const { source, events, close } = open();
    close();
    source.write(`${ESC}[<64;1;1M`);
    await settle();
    expect(events).toEqual([]);
    expect(source.listenerCount("data")).toBe(0);
  });
});
