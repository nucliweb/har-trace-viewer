import { describe, expect, it } from "vitest";
import { fitText, labelScale } from "../src/components/diagram/labels.js";

describe("labelScale", () => {
  it("leaves the labels alone while 12-unit text renders at 10px or more", () => {
    expect(labelScale(900, 900)).toBe(1);
    expect(labelScale(1280, 900)).toBe(1);
    expect(labelScale(750, 900)).toBe(1);
  });

  it("grows them until the smallest renders at 10px when the drawing shrinks", () => {
    // A 360px phone shows the 900-unit drawing at 0.4: 12 units are 4.8px.
    expect(labelScale(360, 900) * 12 * (360 / 900)).toBeCloseTo(10);
    expect(labelScale(600, 900) * 12 * (600 / 900)).toBeCloseTo(10);
  });

  it("is 1 before the drawing is measured", () => {
    expect(labelScale(0, 900)).toBe(1);
  });
});

describe("fitText", () => {
  // Monospaced: each character is 0.6 of the font size wide.
  it("keeps a text that fits", () => {
    expect(fitText("Vercel Edge", 11 * 0.6 * 20, 20)).toBe("Vercel Edge");
  });

  it("cuts a longer one with an ellipsis, within the width", () => {
    const cut = fitText("Cloudflare · MAD", 11 * 0.6 * 20, 20);
    expect(cut).toBe("Cloudflare…");
    expect(cut.length).toBeLessThanOrEqual(11);
  });

  it("keeps at least one character and the ellipsis", () => {
    expect(fitText("Cloudflare", 5, 20)).toBe("C…");
  });

  it("counts the letter spacing of a spaced-out caption", () => {
    // 0.06em more per character: 13 characters at 20 units need 13 × 0.66 × 20 = 171.6.
    expect(fitText("UNITED STATES", 172, 20, 0.06)).toBe("UNITED STATES");
    expect(fitText("UNITED STATES", 160, 20, 0.06)).toBe("UNITED STAT…");
  });

  it("drops a space left before the ellipsis", () => {
    expect(fitText("Origin Server", 8 * 0.6 * 20, 20)).toBe("Origin…");
  });
});
