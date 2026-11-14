import { preloadable } from "../lib/preloadable.js";

// What the start screen does not need, loaded when it is about to show. The public site fetches
// these as chunks; the build a report embeds inlines them into its one script.

export const DiagramView = preloadable(() =>
  import("./DiagramView.js").then((module) => module.DiagramView)
);
export const CompareView = preloadable(() =>
  import("./CompareView.js").then((module) => module.CompareView)
);

const drawers = () => import("./drawers.js");
export const CachePanel = preloadable(() => drawers().then((module) => module.CachePanel));
export const FindingsPanel = preloadable(() => drawers().then((module) => module.FindingsPanel));
export const HopsPanel = preloadable(() => drawers().then((module) => module.HopsPanel));
export const MetricsSummary = preloadable(() => drawers().then((module) => module.MetricsSummary));
export const ResourceSidebar = preloadable(() =>
  drawers().then((module) => module.ResourceSidebar)
);
export const WaterfallPanel = preloadable(() => drawers().then((module) => module.WaterfallPanel));
/** The views preload these once they show, so a drawer opens at once. */
export const DRAWERS = [
  CachePanel,
  FindingsPanel,
  HopsPanel,
  MetricsSummary,
  ResourceSidebar,
  WaterfallPanel,
];

const dialogs = () => import("./dialogs.js");
export const HelpModal = preloadable(() => dialogs().then((module) => module.HelpModal));
export const SettingsModal = preloadable(() => dialogs().then((module) => module.SettingsModal));
/** The app preloads these once it is idle, so a shortcut opens its dialog at once. */
export const DIALOGS = [HelpModal, SettingsModal];

/**
 * Loads everything above. A report does it before its first render: its build inlines these
 * modules, so this costs no request, and the embedded flow shows without a Suspense fallback.
 */
export function preloadAll(): Promise<unknown> {
  return Promise.all(
    [DiagramView, CompareView, ...DRAWERS, ...DIALOGS].map((component) => component.preload())
  );
}
