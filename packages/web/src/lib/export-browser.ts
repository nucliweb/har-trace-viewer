// Browser-only helpers (fetch, Image, canvas, object URLs): covered by e2e/export.spec.ts.

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function toDataUri(url: string): Promise<string> {
  if (url.startsWith("data:")) return url;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Font request failed: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return `data:font/woff2;base64,${bytesToBase64(bytes)}`;
}

let fontCssCache: Promise<string> | undefined;

async function buildFontFaceCss(): Promise<string> {
  const rules: { rule: CSSFontFaceRule; base: string }[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let cssRules: CSSRuleList;
    try {
      cssRules = sheet.cssRules;
    } catch {
      continue; // cross-origin sheet
    }
    for (const rule of Array.from(cssRules)) {
      if (rule instanceof CSSFontFaceRule) {
        rules.push({ rule, base: sheet.href ?? document.baseURI });
      }
    }
  }
  const css = await Promise.all(
    rules.map(async ({ rule, base }) => {
      const src = rule.style.getPropertyValue("src");
      const match = /url\(\s*(["']?)(.*?)\1\s*\)/.exec(src);
      if (!match) return "";
      try {
        const uri = await toDataUri(new URL(match[2], base).href);
        const get = (prop: string) => rule.style.getPropertyValue(prop) || "normal";
        return `@font-face{font-family:${get("font-family")};font-style:${get("font-style")};font-weight:${get("font-weight")};src:url(${uri}) format("woff2")}`;
      } catch {
        return "";
      }
    })
  );
  return css.filter(Boolean).join("\n");
}

/** Collects every `@font-face` of the page with its font file inlined as a data: URI. */
export function collectFontFaceCss(): Promise<string> {
  fontCssCache ??= buildFontFaceCss().catch((error: unknown) => {
    fontCssCache = undefined;
    throw error;
  });
  return fontCssCache;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function svgBlob(svg: string): Blob {
  return new Blob([svg], { type: "image/svg+xml" });
}

/** Rasterizes a standalone SVG at `scale` times its intrinsic size, independent of devicePixelRatio. */
export async function svgToPngBlob(svgString: string, scale = 2): Promise<Blob> {
  const root = new DOMParser().parseFromString(svgString, "image/svg+xml").documentElement;
  const width = Number(root.getAttribute("width"));
  const height = Number(root.getAttribute("height"));
  const url = URL.createObjectURL(svgBlob(svgString));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D context unavailable");
    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("PNG encoding failed"))),
        "image/png"
      )
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
