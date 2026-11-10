import { useEffect } from "react";
import type { RefObject } from "react";
import { isModalOpen, isShortcutEvent } from "../lib/keyboard.js";
import type { StepNavigation } from "./useDiagramState.js";

type Actions = Pick<StepNavigation, "next" | "prev" | "goTo" | "togglePlay" | "total">;

/**
 * Step shortcuts: ArrowRight/ArrowLeft = next/prev, Home/End = first/last, Space = toggle autoplay.
 *
 * The same handler listens on the diagram container (so it works while the region is focused) and
 * on the document (so it works after a click on the canvas). It never acts when the event was
 * already handled (defaultPrevented, which also prevents double handling between the two
 * listeners), when a modifier key is held, when the focus is in an input, select, textarea or
 * contenteditable element (typing in the FlowBuilder), or while a modal dialog is open. Space is
 * also left alone on buttons, where it activates the button.
 */
function stepKeyAction(event: KeyboardEvent, actions: Actions): boolean {
  if (!isShortcutEvent(event) || isModalOpen()) return false;
  const target = event.target instanceof Element ? event.target : null;
  switch (event.key) {
    case "ArrowRight":
      actions.next();
      return true;
    case "ArrowLeft":
      actions.prev();
      return true;
    case "Home":
      actions.goTo(0);
      return true;
    case "End":
      actions.goTo(actions.total - 1);
      return true;
    case " ":
      if (target?.closest("button")) return false;
      actions.togglePlay();
      return true;
    default:
      return false;
  }
}

export function useStepKeyboard(
  containerRef: RefObject<HTMLElement | null>,
  state: StepNavigation
): void {
  const { next, prev, goTo, togglePlay, total } = state;
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (stepKeyAction(event, { next, prev, goTo, togglePlay, total })) event.preventDefault();
    };
    const container = containerRef.current;
    container?.addEventListener("keydown", handler);
    document.addEventListener("keydown", handler);
    return () => {
      container?.removeEventListener("keydown", handler);
      document.removeEventListener("keydown", handler);
    };
  }, [containerRef, next, prev, goTo, togglePlay, total]);
}
