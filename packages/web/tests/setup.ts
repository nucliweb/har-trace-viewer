import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

type Listener = () => void;

/** Controllable matchMedia: tests flip a query with `setMedia` and listeners receive a change event. */
const matches = new Map<string, boolean>();
const listeners = new Map<string, Set<Listener>>();

export function setMedia(query: string, value: boolean): void {
  matches.set(query, value);
  for (const listener of listeners.get(query) ?? []) listener();
}

// jsdom has no modal dialogs: showModal opens the dialog and close closes it, firing "close".
// The browser's focus trap, Escape (a "cancel" event) and top layer are covered end to end.
const dialogProto = (window.HTMLDialogElement ?? window.HTMLElement).prototype as HTMLDialogElement;
if (typeof dialogProto.showModal !== "function") {
  dialogProto.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  dialogProto.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}

beforeEach(() => {
  matches.clear();
  listeners.clear();
  window.matchMedia = ((query: string) => ({
    get matches() {
      return matches.get(query) ?? false;
    },
    media: query,
    addEventListener: (_: string, l: Listener) => {
      if (!listeners.has(query)) listeners.set(query, new Set());
      listeners.get(query)!.add(l);
    },
    removeEventListener: (_: string, l: Listener) => listeners.get(query)?.delete(l),
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("lang");
});
