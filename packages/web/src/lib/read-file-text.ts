import type { ParseProgress } from "./parse-protocol.js";

/** Streams a file (gunzipping `.gz`) into one string without holding two copies of the text. */
export async function readFileText(
  file: File,
  isGzip: boolean,
  report?: (progress: ParseProgress, force?: boolean) => void
): Promise<string> {
  const phase = isGzip ? "decompressing" : "reading";
  let loaded = 0;
  const counter = new TransformStream<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>>({
    transform(chunk, controller) {
      loaded += chunk.byteLength;
      report?.({ phase, loaded, total: file.size });
      controller.enqueue(chunk);
    },
  });

  let bytes: ReadableStream<Uint8Array<ArrayBuffer>> = file.stream().pipeThrough(counter);
  if (isGzip) bytes = bytes.pipeThrough(new DecompressionStream("gzip"));
  const text = bytes.pipeThrough(new TextDecoderStream());

  const parts: string[] = [];
  const reader = text.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  report?.({ phase, loaded: file.size, total: file.size }, true);
  return parts.join("");
}
