import { useEffect } from "react";
import { isShortcutEvent } from "../lib/keyboard.js";

/** Runs the action bound to a key pressed anywhere in the page, unless a field takes the key. */
export function useAppShortcuts(actions: Partial<Record<string, () => void>>): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = actions[event.key];
      if (!action || !isShortcutEvent(event)) return;
      event.preventDefault();
      action();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [actions]);
}
