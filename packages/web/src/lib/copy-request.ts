/** A POSIX shell word: single quotes keep every character literal; a quote itself is closed, escaped and reopened. */
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

/**
 * The cURL command of a request, from what a parsed HAR keeps of it: the method and the URL.
 * Request headers and bodies are not kept, so none is invented; a missing method means GET.
 */
export function curlCommand({ url, method }: { url: string; method: string | null }): string {
  if (method === "HEAD") return `curl --head ${quote(url)}`;
  return method && method !== "GET"
    ? `curl -X ${quote(method)} ${quote(url)}`
    : `curl ${quote(url)}`;
}

/** Copies text to the clipboard; false when the page has no clipboard access (insecure context, permission). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
