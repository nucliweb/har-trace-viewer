import { useCallback, useState } from "react";

// The key keeps the name of the earlier three-level choice (off, secrets, mask-hosts): a stored
// "mask-hosts" reads as checked, any other value as unchecked (and is cleared).
const MASK_HOSTS_STORAGE_KEY = "htv-redact";
const MASK_HOSTS = "mask-hosts";

function readStored(): boolean {
  try {
    const value = window.localStorage.getItem(MASK_HOSTS_STORAGE_KEY);
    if (value !== null && value !== MASK_HOSTS)
      window.localStorage.removeItem(MASK_HOSTS_STORAGE_KEY);
    return value === MASK_HOSTS;
  } catch {
    return false;
  }
}

/**
 * Whether the text exports mask third-party hostnames. Their secrets are always masked, as the
 * files are read. Off by default; the choice is kept like the theme.
 */
export function useMaskHosts(): [boolean, (maskHosts: boolean) => void] {
  const [maskHosts, setState] = useState(readStored);
  const setMaskHosts = useCallback((next: boolean) => {
    try {
      if (next) window.localStorage.setItem(MASK_HOSTS_STORAGE_KEY, MASK_HOSTS);
      else window.localStorage.removeItem(MASK_HOSTS_STORAGE_KEY);
    } catch {
      // Storage is unavailable (private mode, blocked site data): the choice lasts for this page only.
    }
    setState(next);
  }, []);
  return [maskHosts, setMaskHosts];
}
