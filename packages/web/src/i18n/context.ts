import { createContext, useContext } from "react";
import { en } from "./en.js";
import type { Messages } from "./en.js";

// English outside a provider: a component rendered on its own (in a test, say) still has texts.
export const MessagesContext = createContext<Messages>(en);

/** The interface texts in the active language. */
export function useMessages(): Messages {
  return useContext(MessagesContext);
}

/**
 * The lang attribute for a text from @htv/core, which is always English: "en" inside a Spanish
 * or Catalan interface, so a screen reader switches voice, and nothing in an English one.
 */
export function useCoreLang(): "en" | undefined {
  return useMessages().lang === "en" ? undefined : "en";
}
