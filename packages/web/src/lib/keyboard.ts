const EDITABLE = "input, select, textarea, [contenteditable]:not([contenteditable='false'])";

/**
 * Whether a key press may run a shortcut: nothing handled it yet, no Ctrl, Cmd or Alt is held
 * (Shift is, for "?"), and the focus is not in a field being typed in.
 */
export function isShortcutEvent(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return false;
  const target = event.target instanceof Element ? event.target : null;
  return !target?.closest(EDITABLE);
}

/** A modal dialog is open: its keys are its own. */
export function isModalOpen(): boolean {
  return document.querySelector("dialog[open]") !== null;
}

/** Enters fullscreen, or leaves it; a browser that refuses (or lacks the API) changes nothing. */
export function toggleFullscreen(): void {
  const request = document.fullscreenElement
    ? document.exitFullscreen?.()
    : document.documentElement.requestFullscreen?.();
  request?.catch(() => undefined);
}
