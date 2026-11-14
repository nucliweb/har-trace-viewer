import { act, fireEvent, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useFileDrop } from "../src/hooks/useFileDrop.js";
import { makeFile } from "./fixtures.js";

const files = [makeFile("{}", "a.har")];
const fileDrag = { types: ["Files"], files };
const textDrag = { types: ["text/plain"], files: [] };

describe("useFileDrop", () => {
  it("hands the dropped files over and clears the drag-over state", () => {
    const onFiles = vi.fn();
    const { result } = renderHook(() => useFileDrop(onFiles));
    expect(result.current).toBe(false);

    act(() => void fireEvent.dragEnter(window, { dataTransfer: fileDrag }));
    expect(result.current).toBe(true);
    act(() => void fireEvent.drop(window, { dataTransfer: fileDrag }));
    expect(result.current).toBe(false);
    expect(onFiles).toHaveBeenCalledWith(files);
  });

  it("allows the drop, so the browser does not open the file", () => {
    renderHook(() => useFileDrop(vi.fn()));
    const over = new Event("dragover", { cancelable: true });
    Object.assign(over, { dataTransfer: fileDrag });
    act(() => void window.dispatchEvent(over));
    expect(over.defaultPrevented).toBe(true);
  });

  it("stays out of the way of anything that is not a file drag", () => {
    const onFiles = vi.fn();
    const { result } = renderHook(() => useFileDrop(onFiles));
    const over = new Event("dragover", { cancelable: true });
    Object.assign(over, { dataTransfer: textDrag });

    act(() => void fireEvent.dragEnter(window, { dataTransfer: textDrag }));
    act(() => void window.dispatchEvent(over));
    act(() => void fireEvent.drop(window, { dataTransfer: textDrag }));

    expect(result.current).toBe(false);
    expect(over.defaultPrevented).toBe(false);
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("stays on while the pointer moves between elements and ends when it leaves the window", () => {
    const { result } = renderHook(() => useFileDrop(vi.fn()));
    act(() => void fireEvent.dragEnter(window, { dataTransfer: fileDrag }));
    act(() => void fireEvent.dragEnter(window, { dataTransfer: fileDrag }));
    act(() => void fireEvent.dragLeave(window, { dataTransfer: fileDrag }));
    expect(result.current).toBe(true);
    act(() => void fireEvent.dragLeave(window, { dataTransfer: fileDrag }));
    expect(result.current).toBe(false);
  });

  it("leaves a drop that something else already handled", () => {
    const onFiles = vi.fn();
    renderHook(() => useFileDrop(onFiles));
    const handled = (e: Event) => e.preventDefault();
    document.body.addEventListener("drop", handled);
    act(() => void fireEvent.drop(document.body, { dataTransfer: fileDrag }));
    document.body.removeEventListener("drop", handled);
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("stops listening when unmounted", () => {
    const onFiles = vi.fn();
    const { unmount } = renderHook(() => useFileDrop(onFiles));
    unmount();
    fireEvent.drop(window, { dataTransfer: fileDrag });
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("does nothing for a drop without files", () => {
    const onFiles = vi.fn();
    renderHook(() => useFileDrop(onFiles));
    act(() => void fireEvent.drop(window, { dataTransfer: { types: ["Files"], files: [] } }));
    expect(onFiles).not.toHaveBeenCalled();
  });
});
