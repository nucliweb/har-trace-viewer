import { useCallback, useState } from "react";

export type RedactionLevel = "off" | "secrets" | "mask-hosts";

const REDACTION_STORAGE_KEY = "htv-redact";

function readStored(): RedactionLevel {
  try {
    const value = window.localStorage.getItem(REDACTION_STORAGE_KEY);
    return value === "secrets" || value === "mask-hosts" ? value : "off";
  } catch {
    return "off";
  }
}

/**
 * How much the text exports redact: nothing, secrets (the CLI's --redact) or secrets plus
 * third-party hosts (--redact=mask-hosts). Off by default; the choice is kept like the theme.
 */
export function useRedaction(): [RedactionLevel, (level: RedactionLevel) => void] {
  const [level, setState] = useState(readStored);
  const setLevel = useCallback((next: RedactionLevel) => {
    try {
      if (next === "off") window.localStorage.removeItem(REDACTION_STORAGE_KEY);
      else window.localStorage.setItem(REDACTION_STORAGE_KEY, next);
    } catch {
      // Storage is unavailable (private mode, blocked site data): the choice lasts for this page only.
    }
    setState(next);
  }, []);
  return [level, setLevel];
}
