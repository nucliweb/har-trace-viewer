import { useEffect } from "react";
import { isModalOpen } from "../lib/keyboard.js";

/**
 * Closes a drawer on Escape while it is open. With `within`, only when the focus is in one of
 * those elements or on nothing (the page): a comparison has a drawer per pane. A key something
 * else handled (the export menu, a dialog), or an Escape that clears a field, is left alone.
 */
export function useEscapeToClose(
  open: boolean,
  onClose: () => void,
  within?: () => (Element | null)[]
): void {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || isModalOpen()) return;
      const active = document.activeElement;
      if (active instanceof HTMLInputElement && active.value !== "") return;
      if (within && active && active !== document.body) {
        if (!within().some((el) => el?.contains(active))) return;
      }
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, within]);
}
