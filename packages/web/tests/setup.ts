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
});
