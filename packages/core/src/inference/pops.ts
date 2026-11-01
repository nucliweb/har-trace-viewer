import type { NetworkRegion, PopDetection, PopProvider } from "../types.js";

export interface PopInfo {
  city: string;
  country: string; // ISO 3166-1 alpha-2
  region: NetworkRegion;
}

// Common CDN and hosting PoPs, keyed by lowercase IATA airport code. Oceania is
// grouped under "asia-pacific" and Canada and Mexico under "north-america"; the
// United States keeps its own region.
export const POPS: Record<string, PopInfo> = {
  hkg: { city: "Hong Kong", country: "HK", region: "asia-pacific" },
  hnd: { city: "Tokyo", country: "JP", region: "asia-pacific" },
  nrt: { city: "Tokyo", country: "JP", region: "asia-pacific" },
  kix: { city: "Osaka", country: "JP", region: "asia-pacific" },
  icn: { city: "Seoul", country: "KR", region: "asia-pacific" },
  sin: { city: "Singapore", country: "SG", region: "asia-pacific" },
  cgk: { city: "Jakarta", country: "ID", region: "asia-pacific" },
  kul: { city: "Kuala Lumpur", country: "MY", region: "asia-pacific" },
  bkk: { city: "Bangkok", country: "TH", region: "asia-pacific" },
  mnl: { city: "Manila", country: "PH", region: "asia-pacific" },
  tpe: { city: "Taipei", country: "TW", region: "asia-pacific" },
  tsa: { city: "Taipei", country: "TW", region: "asia-pacific" },
  pvg: { city: "Shanghai", country: "CN", region: "asia-pacific" },
  bom: { city: "Mumbai", country: "IN", region: "asia-pacific" },
  del: { city: "Delhi", country: "IN", region: "asia-pacific" },
  maa: { city: "Chennai", country: "IN", region: "asia-pacific" },
  blr: { city: "Bangalore", country: "IN", region: "asia-pacific" },
  hyd: { city: "Hyderabad", country: "IN", region: "asia-pacific" },
  ccu: { city: "Kolkata", country: "IN", region: "asia-pacific" },
  syd: { city: "Sydney", country: "AU", region: "asia-pacific" },
  mel: { city: "Melbourne", country: "AU", region: "asia-pacific" },
  per: { city: "Perth", country: "AU", region: "asia-pacific" },
  bne: { city: "Brisbane", country: "AU", region: "asia-pacific" },
  akl: { city: "Auckland", country: "NZ", region: "asia-pacific" },
  lhr: { city: "London", country: "GB", region: "europe" },
  lcy: { city: "London", country: "GB", region: "europe" },
  man: { city: "Manchester", country: "GB", region: "europe" },
  ams: { city: "Amsterdam", country: "NL", region: "europe" },
  fra: { city: "Frankfurt", country: "DE", region: "europe" },
  muc: { city: "Munich", country: "DE", region: "europe" },
  ham: { city: "Hamburg", country: "DE", region: "europe" },
  dus: { city: "Dusseldorf", country: "DE", region: "europe" },
  cdg: { city: "Paris", country: "FR", region: "europe" },
  mrs: { city: "Marseille", country: "FR", region: "europe" },
  mad: { city: "Madrid", country: "ES", region: "europe" },
  bcn: { city: "Barcelona", country: "ES", region: "europe" },
  mxp: { city: "Milan", country: "IT", region: "europe" },
  fco: { city: "Rome", country: "IT", region: "europe" },
  waw: { city: "Warsaw", country: "PL", region: "europe" },
  vie: { city: "Vienna", country: "AT", region: "europe" },
  zrh: { city: "Zurich", country: "CH", region: "europe" },
  arn: { city: "Stockholm", country: "SE", region: "europe" },
  cph: { city: "Copenhagen", country: "DK", region: "europe" },
  osl: { city: "Oslo", country: "NO", region: "europe" },
  hel: { city: "Helsinki", country: "FI", region: "europe" },
  dub: { city: "Dublin", country: "IE", region: "europe" },
  prg: { city: "Prague", country: "CZ", region: "europe" },
  bud: { city: "Budapest", country: "HU", region: "europe" },
  sof: { city: "Sofia", country: "BG", region: "europe" },
  ath: { city: "Athens", country: "GR", region: "europe" },
  otp: { city: "Bucharest", country: "RO", region: "europe" },
  bru: { city: "Brussels", country: "BE", region: "europe" },
  lis: { city: "Lisbon", country: "PT", region: "europe" },
  iad: { city: "Washington DC", country: "US", region: "united-states" },
  dca: { city: "Washington DC", country: "US", region: "united-states" },
  ewr: { city: "Newark", country: "US", region: "united-states" },
  jfk: { city: "New York", country: "US", region: "united-states" },
  bos: { city: "Boston", country: "US", region: "united-states" },
  ord: { city: "Chicago", country: "US", region: "united-states" },
  dfw: { city: "Dallas", country: "US", region: "united-states" },
  atl: { city: "Atlanta", country: "US", region: "united-states" },
  mia: { city: "Miami", country: "US", region: "united-states" },
  phx: { city: "Phoenix", country: "US", region: "united-states" },
  sjc: { city: "San Jose", country: "US", region: "united-states" },
  sfo: { city: "San Francisco", country: "US", region: "united-states" },
  lax: { city: "Los Angeles", country: "US", region: "united-states" },
  sea: { city: "Seattle", country: "US", region: "united-states" },
  pdx: { city: "Portland", country: "US", region: "united-states" },
  den: { city: "Denver", country: "US", region: "united-states" },
  msp: { city: "Minneapolis", country: "US", region: "united-states" },
  cle: { city: "Cleveland", country: "US", region: "united-states" },
  yyz: { city: "Toronto", country: "CA", region: "north-america" },
  yul: { city: "Montreal", country: "CA", region: "north-america" },
  yvr: { city: "Vancouver", country: "CA", region: "north-america" },
  mex: { city: "Mexico City", country: "MX", region: "north-america" },
  qro: { city: "Queretaro", country: "MX", region: "north-america" },
  gru: { city: "Sao Paulo", country: "BR", region: "south-america" },
  gig: { city: "Rio de Janeiro", country: "BR", region: "south-america" },
  eze: { city: "Buenos Aires", country: "AR", region: "south-america" },
  scl: { city: "Santiago", country: "CL", region: "south-america" },
  bog: { city: "Bogota", country: "CO", region: "south-america" },
  lim: { city: "Lima", country: "PE", region: "south-america" },
  jnb: { city: "Johannesburg", country: "ZA", region: "africa" },
  cpt: { city: "Cape Town", country: "ZA", region: "africa" },
  los: { city: "Lagos", country: "NG", region: "africa" },
  nbo: { city: "Nairobi", country: "KE", region: "africa" },
  cai: { city: "Cairo", country: "EG", region: "africa" },
  dxb: { city: "Dubai", country: "AE", region: "middle-east" },
  fjr: { city: "Fujairah", country: "AE", region: "middle-east" },
  tlv: { city: "Tel Aviv", country: "IL", region: "middle-east" },
  doh: { city: "Doha", country: "QA", region: "middle-east" },
  bah: { city: "Manama", country: "BH", region: "middle-east" },
};

export function lookupPop(code: string): PopInfo | null {
  return POPS[code.toLowerCase()] ?? null;
}

// KeyCDN names its locations with a country and a city code (e.g. "defr").
const KEYCDN_LOCATIONS: Record<string, string> = {
  defr: "fra",
  nlam: "ams",
  gblo: "lhr",
  frpa: "cdg",
  chzh: "zrh",
  sesk: "arn",
  plwa: "waw",
  esma: "mad",
  itmi: "mxp",
  usnj: "ewr",
  usny: "jfk",
  usda: "dfw",
  uschi: "ord",
  usch: "ord",
  ussf: "sfo",
  usla: "lax",
  uswa: "sea",
  usmi: "mia",
  usat: "atl",
  cato: "yyz",
  sgsg: "sin",
  jptk: "nrt",
  hkhk: "hkg",
  inmu: "bom",
  aume: "mel",
  ausy: "syd",
  brsp: "gru",
  zajb: "jnb",
};

function popFrom(code: string | undefined, provider: PopProvider): PopDetection | null {
  if (!code) return null;
  const lower = code.toLowerCase();
  const info = lookupPop(lower);
  return info ? { code: lower, ...info, provider } : null;
}

function fromCfRay(value: string): PopDetection | null {
  return popFrom(value.split("-").pop(), "cloudflare");
}

function fromAmzCfPop(value: string): PopDetection | null {
  return popFrom(value.slice(0, 3), "cloudfront");
}

// Fastly lists every cache node the request crossed, the one closest to the client
// last, e.g. "cache-iad-kcgs7200123-IAD, cache-ams21030-AMS".
function fromServedBy(value: string): PopDetection | null {
  const node = value.split(",").pop()?.trim() ?? "";
  if (!/^cache-/i.test(node)) return null;
  const suffix = /-([A-Za-z]{3})$/.exec(node)?.[1];
  const named = /^cache-([a-z]{3})[-\d]/i.exec(node)?.[1];
  return popFrom(suffix ?? named, "fastly");
}

// x-vercel-id lists the regions a request crossed and ends with a request id:
// "cdg1::pt4z5-1779186962459-6cff682e889a" (served by the edge) or
// "cdg1::iad1::w8x2k-..." (edge cdg1, function run in iad1). Region segments are an
// airport code and a number; anything else (the request id) is not a region.
function vercelRegions(value: string): string[] {
  return value
    .split("::")
    .map((segment) => /^([a-z]{3})\d{1,2}$/i.exec(segment.trim())?.[1])
    .filter((code): code is string => code !== undefined);
}

// The edge is the first region.
function fromVercelId(value: string): PopDetection | null {
  return popFrom(vercelRegions(value)[0], "vercel");
}

/**
 * Where a Vercel function ran: the last region of x-vercel-id after the edge. Null when
 * the edge served the request alone or the region is unknown.
 */
export function detectVercelFunctionRegion(value: string): PopDetection | null {
  const regions = vercelRegions(value);
  return regions.length > 1 ? popFrom(regions[regions.length - 1], "vercel") : null;
}

// "<ulid>-<region>"
function fromFlyRequestId(value: string): PopDetection | null {
  return popFrom(value.split("-").pop(), "fly");
}

function fromEdgeLocation(value: string): PopDetection | null {
  return popFrom(KEYCDN_LOCATIONS[value.trim().toLowerCase()], "keycdn");
}

// Azure CDN and Front Door put the edge node in "Ref B: AMS04EDGE1210". Plain
// x-azure-ref values are opaque, and yield no PoP.
function fromAzureRef(value: string): PopDetection | null {
  return popFrom(/Ref B:\s*([A-Za-z]{3})\d/.exec(value)?.[1], "azure-front-door");
}

// Detection order, most specific header first. Akamai exposes no PoP.
const POP_READERS: [header: string, read: (value: string) => PopDetection | null][] = [
  ["cf-ray", fromCfRay],
  ["x-amz-cf-pop", fromAmzCfPop],
  ["x-served-by", fromServedBy],
  ["x-vercel-id", fromVercelId],
  ["x-edge-location", fromEdgeLocation],
  ["x-msedge-ref", fromAzureRef],
  ["x-azure-ref", fromAzureRef],
  ["fly-request-id", fromFlyRequestId],
];

export function detectPop(headers: Record<string, string>): PopDetection | null {
  for (const [header, read] of POP_READERS) {
    const value = headers[header];
    if (value) {
      const pop = read(value);
      if (pop) return pop;
    }
  }
  return null;
}
