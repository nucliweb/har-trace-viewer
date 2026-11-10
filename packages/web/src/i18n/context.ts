import { createContext, useContext } from "react";
import { en } from "./en.js";
import type { Messages } from "./en.js";

// English outside a provider: a component rendered on its own (in a test, say) still has texts.
export const MessagesContext = createContext<Messages>(en);

/** The interface texts in the active language. */
export function useMessages(): Messages {
  return useContext(MessagesContext);
}
