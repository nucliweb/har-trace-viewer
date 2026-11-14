import { Suspense } from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { preloadWhenIdle, preloadable } from "../src/lib/preloadable.js";

function Greeting({ name }: { name: string }) {
  return <p>Hello {name}</p>;
}

const loader = () => vi.fn(() => Promise.resolve(Greeting));

describe("preloadable", () => {
  it("shows the fallback until the component has loaded, then the component", async () => {
    const LazyGreeting = preloadable(loader());
    render(
      <Suspense fallback={<p>Loading</p>}>
        <LazyGreeting name="Ada" />
      </Suspense>
    );
    expect(screen.getByText("Loading")).toBeInTheDocument();
    expect(await screen.findByText("Hello Ada")).toBeInTheDocument();
  });

  it("renders at once, with no fallback, once preloaded", async () => {
    const LazyGreeting = preloadable(loader());
    await LazyGreeting.preload();
    render(
      <Suspense fallback={<p>Loading</p>}>
        <LazyGreeting name="Ada" />
      </Suspense>
    );
    expect(screen.getByText("Hello Ada")).toBeInTheDocument();
    expect(screen.queryByText("Loading")).not.toBeInTheDocument();
  });

  it("loads the module once, however often it is preloaded and rendered", async () => {
    const load = loader();
    const LazyGreeting = preloadable(load);
    await Promise.all([LazyGreeting.preload(), LazyGreeting.preload()]);
    render(<LazyGreeting name="Ada" />);
    render(<LazyGreeting name="Grace" />);
    await LazyGreeting.preload();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("tries again after a failed load", async () => {
    const load = vi
      .fn<() => Promise<typeof Greeting>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(Greeting);
    const LazyGreeting = preloadable(load);
    await expect(LazyGreeting.preload()).rejects.toThrow("offline");
    await LazyGreeting.preload();
    render(<LazyGreeting name="Ada" />);
    expect(screen.getByText("Hello Ada")).toBeInTheDocument();
  });
});

describe("preloadWhenIdle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preloads the components when the browser is idle", () => {
    const callbacks: (() => void)[] = [];
    vi.stubGlobal("requestIdleCallback", (callback: () => void) => callbacks.push(callback));
    vi.stubGlobal("cancelIdleCallback", vi.fn());
    const first = { preload: vi.fn(() => Promise.resolve()) };
    const second = { preload: vi.fn(() => Promise.resolve()) };

    preloadWhenIdle([first, second]);
    expect(first.preload).not.toHaveBeenCalled();
    callbacks.forEach((callback) => callback());
    expect(first.preload).toHaveBeenCalledTimes(1);
    expect(second.preload).toHaveBeenCalledTimes(1);
  });

  it("can be cancelled before it runs", () => {
    const cancelIdleCallback = vi.fn();
    vi.stubGlobal("requestIdleCallback", () => 7);
    vi.stubGlobal("cancelIdleCallback", cancelIdleCallback);

    preloadWhenIdle([{ preload: vi.fn(() => Promise.resolve()) }])();
    expect(cancelIdleCallback).toHaveBeenCalledWith(7);
  });

  it("falls back to a timeout where there is no idle callback, ignoring a failed load", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestIdleCallback", undefined);
    const failing = { preload: vi.fn(() => Promise.reject(new Error("offline"))) };

    preloadWhenIdle([failing]);
    expect(failing.preload).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(failing.preload).toHaveBeenCalledTimes(1);

    const cancelled = { preload: vi.fn(() => Promise.resolve()) };
    preloadWhenIdle([cancelled])();
    vi.runAllTimers();
    expect(cancelled.preload).not.toHaveBeenCalled();
  });
});
