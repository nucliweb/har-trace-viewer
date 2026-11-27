import { vi } from "vitest";
import { useEffect, useLayoutEffect, useState, type ReactElement } from "react";
import { useInput } from "ink";
import { render } from "ink-testing-library";

const WAIT_MS = 3_000;

// Polls `holds` until it is true, failing with `what` (and the last frame) after WAIT_MS.
async function until(holds: () => boolean, what: () => string) {
  await vi.waitFor(
    () => {
      if (!holds()) throw new Error(`Timed out after ${WAIT_MS} ms waiting for ${what()}`);
    },
    { timeout: WAIT_MS, interval: 5 }
  );
}

// Renders the TUI next to a probe that sees every key Ink hands to `useInput`. Each key the probe
// sees also re-renders the probe, in the same batch as the app's own update, so once that render
// has committed the frame on screen is the app's answer to the key. A bare Esc only arrives once
// Ink's escape timer gives up waiting for a sequence, so the next key must wait for it.
export function renderTui(element: ReactElement) {
  const probe = { listening: false, received: 0, rendered: 0, unmounted: false };
  function KeyProbe() {
    const [seen, setSeen] = useState(0);
    useInput(() => {
      probe.received += 1;
      setSeen(probe.received);
    });
    // Effects run in order, after those of the app rendered before the probe: its keys are wired.
    useEffect(() => {
      probe.listening = true;
    }, []);
    useLayoutEffect(() => {
      probe.rendered = seen;
    }, [seen]);
    // q quits: the app unmounts with the probe, and no render follows the key.
    useLayoutEffect(
      () => () => {
        probe.unmounted = true;
      },
      []
    );
    return null;
  }
  const withProbe = (node: ReactElement) => (
    <>
      {node}
      <KeyProbe />
    </>
  );
  const app = render(withProbe(element));
  const frame = () => `the frame:\n${app.lastFrame() ?? "(nothing drawn)"}`;

  return {
    lastFrame: app.lastFrame,
    unmount: app.unmount,
    rerender: (next: ReactElement) => app.rerender(withProbe(next)),
    // Types the keys one at a time, each once the app has drawn its answer to the one before.
    async press(...keys: string[]) {
      await until(
        () => probe.listening,
        () => `the app to listen for keys, ${frame()}`
      );
      for (const key of keys) {
        const target = probe.received + 1;
        app.stdin.write(key);
        await until(
          () => probe.unmounted || probe.rendered >= target,
          () => `the app to render after the key ${JSON.stringify(key)}, ${frame()}`
        );
      }
    },
    // Waits until the last frame satisfies `holds`, for changes that come without a key.
    async untilFrame(holds: (frame: string) => boolean, what: string) {
      await until(
        () => holds(app.lastFrame() ?? ""),
        () => `${what}, ${frame()}`
      );
    },
  };
}
