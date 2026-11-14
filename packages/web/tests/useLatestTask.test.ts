import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useLatestTask } from "../src/hooks/useLatestTask.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useLatestTask", () => {
  it("runs while the task is pending and hands over its result", async () => {
    const { result } = renderHook(() => useLatestTask());
    const task = deferred<string>();
    const onDone = vi.fn();
    expect(result.current.running).toBe(false);

    let done!: Promise<void>;
    act(() => {
      done = result.current.run(() => task.promise, onDone, vi.fn());
    });
    expect(result.current.running).toBe(true);

    await act(async () => {
      task.resolve("flow");
      await done;
    });
    expect(onDone).toHaveBeenCalledWith("flow");
    expect(result.current.running).toBe(false);
  });

  it("hands over the error of a task that fails, thrown or rejected", async () => {
    const { result } = renderHook(() => useLatestTask());
    const onError = vi.fn();
    const failure = new Error("analysis failed");

    await act(() =>
      result.current.run(
        () => {
          throw failure;
        },
        vi.fn(),
        onError
      )
    );
    await act(() => result.current.run(() => Promise.reject(failure), vi.fn(), onError));

    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledWith(failure);
    expect(result.current.running).toBe(false);
  });

  it("drops the outcome of a task a newer one replaced", async () => {
    const { result } = renderHook(() => useLatestTask());
    const first = deferred<string>();
    const second = deferred<string>();
    const onDone = vi.fn();
    const onError = vi.fn();

    let firstDone!: Promise<void>;
    let secondDone!: Promise<void>;
    act(() => {
      firstDone = result.current.run(() => first.promise, onDone, onError);
    });
    act(() => {
      secondDone = result.current.run(() => second.promise, onDone, onError);
    });

    await act(async () => {
      first.reject(new Error("stale"));
      await firstDone;
    });
    expect(onError).not.toHaveBeenCalled();
    expect(result.current.running).toBe(true);

    await act(async () => {
      second.resolve("newer");
      await secondDone;
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith("newer");
  });

  it("drops the outcome of a cancelled task and stops running at once", async () => {
    const { result } = renderHook(() => useLatestTask());
    const task = deferred<string>();
    const onDone = vi.fn();

    let done!: Promise<void>;
    act(() => {
      done = result.current.run(() => task.promise, onDone, vi.fn());
    });
    act(() => result.current.cancel());
    expect(result.current.running).toBe(false);

    await act(async () => {
      task.resolve("stale");
      await done;
    });
    expect(onDone).not.toHaveBeenCalled();
    expect(result.current.running).toBe(false);
  });

  it("drops the outcome of a task still pending when the component unmounts", async () => {
    const { result, unmount } = renderHook(() => useLatestTask());
    const task = deferred<string>();
    const onDone = vi.fn();

    let done!: Promise<void>;
    act(() => {
      done = result.current.run(() => task.promise, onDone, vi.fn());
    });
    unmount();

    task.resolve("stale");
    await done;
    expect(onDone).not.toHaveBeenCalled();
  });
});
