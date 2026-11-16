import type { FindingSeverity } from "@htv/core";

/** The glyph of each severity in the app. The terminal report draws its own, single-width ones. */
export const SEVERITY_ICON: Record<FindingSeverity, string> = {
  critical: "✕",
  warning: "⚠",
  info: "ℹ",
  good: "✓",
};
