import { useCallback, useState } from "react";

const JOURNEYS_STORAGE_KEY = "htv-journeys";

function readStored(): boolean {
  try {
    return window.localStorage.getItem(JOURNEYS_STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

/**
 * Whether the builder offers multi-page journeys (several HAR files, one per page). Off by
 * default: most flows come from one HAR. The choice is kept like the theme.
 */
export function useJourneys(): [boolean, (on: boolean) => void] {
  const [journeys, setState] = useState(readStored);
  const setJourneys = useCallback((on: boolean) => {
    try {
      if (on) window.localStorage.setItem(JOURNEYS_STORAGE_KEY, "on");
      else window.localStorage.removeItem(JOURNEYS_STORAGE_KEY);
    } catch {
      // Storage is unavailable (private mode, blocked site data): the choice lasts for this page only.
    }
    setState(on);
  }, []);
  return [journeys, setJourneys];
}
