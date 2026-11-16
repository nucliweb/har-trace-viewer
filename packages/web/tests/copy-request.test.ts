import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText, curlCommand } from "../src/lib/copy-request.js";

afterEach(() => {
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("curlCommand", () => {
  it("quotes the URL in single quotes", () => {
    expect(curlCommand({ url: "https://example.com/a?b=1&c=2", method: "GET" })).toBe(
      "curl 'https://example.com/a?b=1&c=2'"
    );
  });

  it("escapes a single quote inside the URL, so the shell cannot be left early", () => {
    expect(curlCommand({ url: "https://example.com/it's$(id)`x`", method: null })).toBe(
      "curl 'https://example.com/it'\\''s$(id)`x`'"
    );
  });

  it("names a method other than GET, and does not guess one a HAR lacks", () => {
    expect(curlCommand({ url: "https://e.com/", method: "POST" })).toBe(
      "curl -X 'POST' 'https://e.com/'"
    );
    expect(curlCommand({ url: "https://e.com/", method: "HEAD" })).toBe(
      "curl --head 'https://e.com/'"
    );
    expect(curlCommand({ url: "https://e.com/", method: null })).toBe("curl 'https://e.com/'");
  });
});

describe("copyText", () => {
  it("writes to the clipboard and says so", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await expect(copyText("hello")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("reports a clipboard that refuses", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await expect(copyText("hello")).resolves.toBe(false);
  });

  it("reports a missing clipboard (insecure context)", async () => {
    await expect(copyText("hello")).resolves.toBe(false);
  });
});
