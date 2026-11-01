import type { HarTiming } from "../types.js";

/**
 * Time spent on the TCP handshake alone. HAR 1.2 counts TLS (`ssl`) inside `connect`, so
 * TCP is the difference; a value the HAR leaves out (-1, or 0 once parsed) counts as none.
 */
export function tcpConnectMs({ connect, ssl }: Pick<HarTiming, "connect" | "ssl">): number {
  return Math.max(0, Math.max(0, connect) - Math.max(0, ssl));
}
