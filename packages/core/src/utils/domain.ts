const MULTI_LABEL_SUFFIXES = new Set([
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "com.au",
  "net.au",
  "org.au",
  "co.jp",
  "ne.jp",
  "or.jp",
  "com.br",
  "com.cn",
  "net.cn",
  "com.mx",
  "com.ar",
  "co.nz",
  "co.za",
  "co.kr",
  "com.tr",
  "com.sg",
  "com.hk",
  "com.tw",
  "co.in",
  "co.id",
]);

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

export function getHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Returns the registrable domain of a URL: the public suffix plus one label.
 * IPs and single-label hosts (localhost) are returned as is; invalid URLs return the input.
 */
export function getRootDomain(url: string): string {
  const hostname = getHostname(url);
  if (hostname === null) return url;
  if (IPV4.test(hostname) || hostname.includes(":")) return hostname;

  const labels = hostname.split(".");
  if (labels.length <= 2) return hostname;

  const suffix = labels.slice(-2).join(".");
  const keep = MULTI_LABEL_SUFFIXES.has(suffix) ? 3 : 2;
  return labels.slice(-keep).join(".");
}
