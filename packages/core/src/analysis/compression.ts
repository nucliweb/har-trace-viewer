import { networkRequests } from "./network-requests.js";
import { parseContentEncoding } from "../parsers/har-parser.js";
import { formatBytes } from "../utils/format.js";
import type {
  CompressibleType,
  CompressionByType,
  CompressionReport,
  ContentEncoding,
  EncodedImage,
  GzipResponse,
  HarEntry,
  ImageFormat,
  ImageFormatUsage,
  LegacyImage,
  ParsedHar,
  Recommendation,
  UncompressedResponse,
} from "../types.js";

// Below this body size compression gains less than it costs; servers rightly skip it.
const MIN_COMPRESSIBLE_BYTES = 1_000;
// gzip responses this big on the wire, or bigger, are worth moving to Brotli.
const MIN_GZIP_WIRE_BYTES = 10_000;
// JPEG and PNG images this big, or bigger, are worth converting.
const MIN_LEGACY_IMAGE_BYTES = 20_000;
// Typical savings: text compression, Brotli over gzip, WebP and AVIF over JPEG or PNG.
const TEXT_SAVINGS = 0.7;
const BROTLI_OVER_GZIP_SAVINGS = 0.15;
const WEBP_SAVINGS = 0.3;
const AVIF_SAVINGS = 0.5;
// From this many bytes to save, uncompressed text is critical and legacy images a warning.
const CRITICAL_TEXT_SAVINGS = 100_000;
const WARNING_IMAGE_SAVINGS = 100_000;

const MODERN_ENCODINGS: readonly ContentEncoding[] = ["br", "zstd"];
const UNCOMPRESSED: readonly ContentEncoding[] = ["none", "identity"];
const TYPE_ORDER: readonly CompressibleType[] = ["html", "css", "js", "json", "svg", "text"];

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

/** The entry's Content-Encoding, read from its header for flows parsed before it was kept. */
function encodingOf(entry: HarEntry): ContentEncoding {
  return entry.contentEncoding ?? parseContentEncoding(entry.responseHeaders["content-encoding"]);
}

function compressibleType(entry: HarEntry): CompressibleType | null {
  const mime = entry.mimeType.toLowerCase();
  if (mime.includes("image/svg")) return "svg";
  if (mime.includes("text/html")) return "html";
  if (mime.includes("text/css")) return "css";
  if (mime.includes("javascript") || mime.includes("ecmascript")) return "js";
  if (mime.includes("json")) return "json";
  if (mime.startsWith("text/") || mime.includes("xml")) return "text";
  return null;
}

function imageFormat(entry: HarEntry): ImageFormat | null {
  const mime = entry.mimeType.toLowerCase();
  if (!mime.startsWith("image/")) return null;
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpeg";
  if (mime.includes("png")) return "png";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("avif")) return "avif";
  if (mime.includes("svg")) return "svg";
  return "other";
}

/**
 * A response body this load downloaded: a 2xx with content, from the network. Browser-cache
 * hits, 304s, beacons' 204 and 205, and entries the HAR recorded without a body are left out.
 */
function isDownloadedBody(entry: HarEntry): boolean {
  const { status } = entry;
  return status >= 200 && status < 300 && status !== 204 && status !== 205 && entry.bodySize > 0;
}

const byBytes = <T extends { bytes: number }>(a: T, b: T) => b.bytes - a.bytes;

function summarizeByType(texts: { entry: HarEntry; type: CompressibleType }[]) {
  const groups = new Map<CompressibleType, CompressionByType>();
  for (const { entry, type } of texts) {
    const group = groups.get(type) ?? {
      type,
      requests: 0,
      uncompressedBytes: 0,
      wireBytes: 0,
      encodings: {},
    };
    group.requests++;
    group.uncompressedBytes += entry.bodySize;
    group.wireBytes += entry.transferSize;
    const encoding = encodingOf(entry);
    group.encodings[encoding] = (group.encodings[encoding] ?? 0) + 1;
    groups.set(type, group);
  }
  return [...groups.values()].sort(
    (a, b) => b.wireBytes - a.wireBytes || TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type)
  );
}

function summarizeImages(images: { entry: HarEntry; format: ImageFormat }[]) {
  const formats = new Map<ImageFormat, ImageFormatUsage>();
  const legacy: LegacyImage[] = [];
  const encoded: EncodedImage[] = [];
  for (const { entry, format } of images) {
    const usage = formats.get(format) ?? { format, requests: 0, bytes: 0 };
    usage.requests++;
    usage.bytes += entry.transferSize;
    formats.set(format, usage);

    const bytes = entry.transferSize;
    if ((format === "jpeg" || format === "png") && bytes >= MIN_LEGACY_IMAGE_BYTES) {
      legacy.push({
        url: entry.url,
        format,
        bytes,
        webpSavings: Math.round(bytes * WEBP_SAVINGS),
        avifSavings: Math.round(bytes * AVIF_SAVINGS),
      });
    }
    // SVG is text and is counted with the compressible responses.
    const encoding = encodingOf(entry);
    if (format !== "svg" && !UNCOMPRESSED.includes(encoding)) {
      encoded.push({ url: entry.url, format, encoding, bytes });
    }
  }
  return {
    byFormat: [...formats.values()].sort(byBytes),
    legacy: legacy.sort(byBytes),
    encoded: encoded.sort(byBytes),
  };
}

// ── Recommendations ──────────────────────────────────────────────────────────

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

function uncompressedRecommendation(list: UncompressedResponse[]): Recommendation | null {
  if (list.length === 0) return null;
  const savings = sum(list.map((r) => r.potentialSavings));
  return {
    label: "Text responses served uncompressed",
    description: `${list.length} text ${plural(list.length, "response was", "responses were")} sent without compression: ${formatBytes(sum(list.map((r) => r.bytes)))} that Brotli or gzip would cut by about 70%, some ${formatBytes(savings)} less to download. Enable Brotli (or gzip) on the server or CDN for HTML, CSS, JavaScript, JSON and SVG.`,
    severity: savings >= CRITICAL_TEXT_SAVINGS ? "critical" : "warning",
    resources: list.map((r) => ({
      url: r.url,
      transferSize: r.wireBytes,
      detail: `${formatBytes(r.bytes)} uncompressed · ~${formatBytes(r.potentialSavings)} to save`,
    })),
  };
}

function gzipRecommendation(list: GzipResponse[]): Recommendation | null {
  if (list.length === 0) return null;
  const savings = sum(list.map((r) => r.potentialSavings));
  return {
    label: "Brotli would shrink gzip responses",
    description: `${list.length} text ${plural(list.length, "response is", "responses are")} compressed with ${list.every((r) => r.encoding === "gzip") ? "gzip" : "gzip or deflate"} only. Brotli, which every current browser accepts, typically makes them 15–20% smaller than gzip: about ${formatBytes(savings)} here. Serve Brotli (or Zstandard) to the browsers that ask for it, precompressing static files at the highest level.`,
    severity: "info",
    resources: list.map((r) => ({
      url: r.url,
      transferSize: r.wireBytes,
      detail: `${r.encoding} · ~${formatBytes(r.potentialSavings)} to save`,
    })),
  };
}

function legacyImagesRecommendation(list: LegacyImage[]): Recommendation | null {
  if (list.length === 0) return null;
  const webp = sum(list.map((i) => i.webpSavings));
  const avif = sum(list.map((i) => i.avifSavings));
  return {
    label: "Legacy image formats",
    description: `${list.length} ${plural(list.length, "image is", "images are")} served as JPEG or PNG. WebP would save about ${formatBytes(webp)} and AVIF about ${formatBytes(avif)}, with the same visual quality. Serve modern formats through <picture> or content negotiation on Accept, as image CDNs do.`,
    severity: webp >= WARNING_IMAGE_SAVINGS ? "warning" : "info",
    resources: list.map((i) => ({
      url: i.url,
      transferSize: i.bytes,
      detail: `${i.format} · ~${formatBytes(i.webpSavings)} as WebP, ~${formatBytes(i.avifSavings)} as AVIF`,
    })),
  };
}

function encodedImagesRecommendation(list: EncodedImage[]): Recommendation | null {
  if (list.length === 0) return null;
  return {
    label: "Images double-encoded",
    description: `${list.length} ${plural(list.length, "image was", "images were")} sent with a Content-Encoding. Image formats are compressed already: gzip or Brotli on top saves next to nothing and costs CPU on the server and in the browser. Leave images out of the server's compression rules.`,
    severity: "info",
    resources: list.map((i) => ({ url: i.url, transferSize: i.bytes, detail: i.encoding })),
  };
}

function goodRecommendation(
  texts: { entry: HarEntry }[],
  images: { format: ImageFormat }[]
): Recommendation | null {
  const judged = texts.filter(({ entry }) => entry.bodySize >= MIN_COMPRESSIBLE_BYTES);
  if (judged.length === 0) return null;
  if (!judged.every(({ entry }) => MODERN_ENCODINGS.includes(encodingOf(entry)))) return null;
  const modernImages = images.filter((i) => ["webp", "avif", "svg"].includes(i.format)).length;
  return {
    label: "Text compressed with Brotli or Zstandard, images in modern formats",
    description: `Every text response of 1 KB or more is compressed with Brotli or Zstandard${images.length > 0 ? `, and ${modernImages} of ${images.length} ${plural(images.length, "image is", "images are")} WebP, AVIF or SVG, with no large JPEG or PNG left` : ""}.`,
    severity: "good",
  };
}

/**
 * How the page's downloads were compressed: the encoding and the bytes of each text type, the
 * text responses sent uncompressed or with gzip only, the image formats, the JPEG and PNG
 * images a modern format would shrink and the images sent with a pointless Content-Encoding,
 * with the bytes that could be saved and a recommendation for each finding.
 */
export function analyzeCompression(har: ParsedHar): CompressionReport {
  const downloads = networkRequests(har).filter(isDownloadedBody);
  const texts = downloads.flatMap((entry) => {
    const type = compressibleType(entry);
    return type ? [{ entry, type }] : [];
  });
  const imageEntries = downloads.flatMap((entry) => {
    const format = imageFormat(entry);
    return format ? [{ entry, format }] : [];
  });

  const uncompressed: UncompressedResponse[] = texts
    .filter(
      ({ entry }) =>
        UNCOMPRESSED.includes(encodingOf(entry)) && entry.bodySize >= MIN_COMPRESSIBLE_BYTES
    )
    .map(({ entry, type }) => ({
      url: entry.url,
      type,
      bytes: entry.bodySize,
      wireBytes: entry.transferSize,
      potentialSavings: Math.round(entry.bodySize * TEXT_SAVINGS),
    }))
    .sort(byBytes);

  const gzipOnly: GzipResponse[] = texts
    .flatMap(({ entry, type }) => {
      const encoding = encodingOf(entry);
      if (encoding !== "gzip" && encoding !== "deflate") return [];
      if (entry.transferSize < MIN_GZIP_WIRE_BYTES) return [];
      return [
        {
          url: entry.url,
          type,
          encoding,
          bytes: entry.bodySize,
          wireBytes: entry.transferSize,
          potentialSavings: Math.round(entry.transferSize * BROTLI_OVER_GZIP_SAVINGS),
        },
      ];
    })
    .sort((a, b) => b.wireBytes - a.wireBytes);

  const images = summarizeImages(imageEntries);
  const potentialSavings = sum([
    ...uncompressed.map((r) => r.potentialSavings),
    ...gzipOnly.map((r) => r.potentialSavings),
    ...images.legacy.map((i) => i.webpSavings),
  ]);

  const findings = [
    uncompressedRecommendation(uncompressed),
    gzipRecommendation(gzipOnly),
    legacyImagesRecommendation(images.legacy),
    encodedImagesRecommendation(images.encoded),
  ].filter((rec): rec is Recommendation => rec !== null);
  const good = findings.length === 0 ? goodRecommendation(texts, imageEntries) : null;

  return {
    byType: summarizeByType(texts),
    uncompressed,
    gzipOnly,
    images,
    potentialSavings,
    recommendations: good ? [good] : findings,
  };
}
