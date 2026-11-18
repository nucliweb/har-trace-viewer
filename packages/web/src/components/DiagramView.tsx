import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  analyzeHops,
  pageAnalysisAt,
  pageAt,
  stepAt,
  protocolsInUse,
  collectFindings,
  getStepCacheResources,
  getStepInferredCacheHits,
  getStepResources,
  pageDocument,
} from "@htv/core";
import type { Flow } from "@htv/core";
import { useBottomEdge } from "../hooks/useBottomEdge.js";
import { useDiagramState } from "../hooks/useDiagramState.js";
import { useEscapeToClose } from "../hooks/useEscapeToClose.js";
import { useAppShortcuts } from "../hooks/useAppShortcuts.js";
import { useStepKeyboard } from "../hooks/useStepKeyboard.js";
import { computeHistoricalPaths } from "../lib/historical-paths.js";
import { preloadWhenIdle } from "../lib/preloadable.js";
import { NodeRenderer } from "./NodeRenderer.js";
import { StepPanel } from "./StepPanel.js";
import { CacheSidebar } from "./CacheSidebar.js";
import { FindingsButton } from "./FindingsButton.js";
import { WaterfallButton } from "./WaterfallButton.js";
import {
  AnalysisPanel,
  CachePanel,
  DRAWERS,
  FindingsPanel,
  HopsPanel,
  MetricsSummary,
  ResourceSidebar,
  WaterfallPanel,
} from "./lazy.js";
import { ExportMenu } from "./ExportMenu.js";
import { BadgeRow } from "./BadgeRow.js";
import { useCoreLang, useMessages } from "../i18n/context.js";
import {
  LINKED_DRAWERS,
  isAnalysisView,
  parseViewState,
  setHashParams,
} from "../lib/view-state.js";
import type { AnalysisView } from "../lib/view-state.js";
import styles from "./DiagramView.module.css";

interface Props {
  flow: Flow;
}

// The analysis drawer is open under the name of the view it shows.
type Drawer = "findings" | "waterfall" | "hops" | "metrics" | "cache" | "resources" | AnalysisView;

export function DiagramView({ flow }: Props) {
  const t = useMessages().diagram;
  const coreLang = useCoreLang();
  const state = useDiagramState(flow);
  const viewRef = useRef<HTMLDivElement>(null);
  useStepKeyboard(viewRef, state);
  // On a phone the waterfall takes the screen below the toolbar, which stays in reach.
  const toolbarRef = useRef<HTMLDivElement>(null);
  const toolbarBottom = useBottomEdge(toolbarRef);
  const { stepIndex } = state;
  const step = stepAt(flow, stepIndex);
  const { pageIndex } = step;
  // Steps reference their page entries by index: resolve them once per step.
  const resources = useMemo(() => getStepResources(flow, step), [flow, step]);
  const cacheResources = useMemo(() => getStepCacheResources(flow, step), [flow, step]);
  const inferredCacheHits = useMemo(() => getStepInferredCacheHits(flow, step), [flow, step]);
  const hasCacheList = cacheResources.length + inferredCacheHits.length > 0;
  // Indexing keeps the analysis reference stable while the user stays on a page.
  const analysis = pageAnalysisAt(flow, pageIndex);
  const page = pageAt(flow, pageIndex);
  // Every drawer docks on the right, so only one is open at a time: none hides behind another.
  // A link names the drawer to open with, and follows the one that is open; leaving the view
  // takes the drawer out of the link.
  const [drawer, setDrawer] = useState<Drawer | null>(
    () => parseViewState(window.location.hash).drawer ?? null
  );
  useEffect(() => {
    const linked = (LINKED_DRAWERS as readonly (Drawer | null)[]).includes(drawer);
    setHashParams({ d: linked ? drawer : null });
  }, [drawer]);
  useEffect(() => () => setHashParams({ d: null }), []);
  const toggleDrawer = (name: Drawer) => setDrawer((open) => (open === name ? null : name));
  // The analysis button opens the view shown last.
  const [analysisView, setAnalysisView] = useState<AnalysisView>("connections");
  if (isAnalysisView(drawer) && drawer !== analysisView) setAnalysisView(drawer);
  // Closing hands the focus back to the drawer's toggle, or to the diagram when the toggle is
  // gone (the resource list stays open on a step that requests nothing, without its button).
  const closeDrawer = useCallback(() => {
    const view = viewRef.current;
    const name = isAnalysisView(drawer) ? "analysis" : drawer;
    const toggle = view?.querySelector<HTMLElement>(`[data-drawer="${name}"]`);
    (toggle ?? view)?.focus();
    setDrawer(null);
  }, [drawer]);
  useEscapeToClose(drawer !== null, closeDrawer);
  // Digits toggle the drawers in the order of the toolbar, "/" goes to the waterfall's filter. The
  // comparison leaves them unbound: its two panes each have drawers, and a key cannot pick one.
  const [filterRequested, setFilterRequested] = useState(false);
  const clearFilterRequest = useCallback(() => setFilterRequested(false), []);
  const drawerKeys = useMemo(() => {
    const toggleByKey = (name: Drawer) => () => (drawer === name ? closeDrawer() : setDrawer(name));
    return {
      "1": toggleByKey("findings"),
      "2": toggleByKey("waterfall"),
      "3": toggleByKey("hops"),
      "4": toggleByKey("metrics"),
      "5": toggleByKey("cache"),
      "6": toggleByKey("connections"),
      "7": toggleByKey("compression"),
      "8": toggleByKey("render"),
      "9": toggleByKey("critical-path"),
      "/": () => {
        setDrawer("waterfall");
        setFilterRequested(true);
      },
    };
  }, [drawer, closeDrawer]);
  useAppShortcuts(drawerKeys, true);
  useEffect(() => preloadWhenIdle(DRAWERS), []);
  // The resource list follows the steps that request something. Milestone steps (FCP, LCP)
  // request nothing, so the list stays on the last step that did, under that step's title.
  const [listedIndex, setListedIndex] = useState(stepIndex);
  if (drawer === "resources" && resources.length > 0 && listedIndex !== stepIndex) {
    setListedIndex(stepIndex);
  }
  const listedStep = flow.steps[listedIndex] ?? step;
  const listedPage = pageAt(flow, listedStep.pageIndex);
  const listedResources = useMemo(() => getStepResources(flow, listedStep), [flow, listedStep]);
  const hops = useMemo(() => analyzeHops(page.har, page.har.documentEntry.url), [page.har]);
  const protocols = useMemo(() => protocolsInUse(page.har), [page.har]);
  const allFindings = useMemo(() => collectFindings(flow), [flow]);
  const findings = useMemo(
    () => allFindings.filter((f) => f.page.index === pageIndex),
    [allFindings, pageIndex]
  );

  const historicalPaths = useMemo(
    () => computeHistoricalPaths(flow.steps, stepIndex),
    [flow.steps, stepIndex]
  );

  // The last step of a page is its overview ("Page loaded"). A transition step belongs to the
  // page it leads to, so the next step starting a new page also marks the end of this one.
  // Not tied to the title or the onload badge, which is absent when the load event never fired.
  const listedIsOverview = flow.steps[listedIndex + 1]?.pageIndex !== listedStep.pageIndex;

  return (
    <div
      ref={viewRef}
      className={styles.view}
      role="region"
      aria-label={t.region}
      // The region is focusable on purpose: it is the keyboard entry point for the step shortcuts.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      style={{ "--toolbar-bottom": `${toolbarBottom}px` } as CSSProperties}
    >
      {/* A band of its own above the diagram, so it never covers the zone captions. */}
      <div ref={toolbarRef} className={styles.toolbar}>
        <FindingsButton
          findings={findings}
          active={drawer === "findings"}
          drawer="findings"
          className={styles.findingsBtn}
          activeClassName={styles.cacheBtnActive}
          onClick={() => toggleDrawer("findings")}
        />
        <WaterfallButton
          active={drawer === "waterfall"}
          drawer="waterfall"
          className={styles.waterfallBtn}
          activeClassName={styles.cacheBtnActive}
          onClick={() => toggleDrawer("waterfall")}
        />
        <button
          className={`${styles.hopsBtn} ${drawer === "hops" ? styles.cacheBtnActive : ""}`}
          onClick={() => toggleDrawer("hops")}
          data-drawer="hops"
          aria-label={t.toggleHops}
          aria-expanded={drawer === "hops"}
          title={t.hopsTitle}
        >
          {t.hops}
        </button>
        <button
          className={`${styles.metricsBtn} ${drawer === "metrics" ? styles.cacheBtnActive : ""}`}
          onClick={() => toggleDrawer("metrics")}
          data-drawer="metrics"
          aria-label={t.toggleMetrics}
          aria-expanded={drawer === "metrics"}
          title={t.metricsTitle}
        >
          {t.metrics}
        </button>
        <button
          className={`${styles.cacheBtn} ${drawer === "cache" ? styles.cacheBtnActive : ""}`}
          onClick={() => toggleDrawer("cache")}
          data-drawer="cache"
          aria-label={t.toggleCache}
          aria-expanded={drawer === "cache"}
          title={t.cacheTitle}
        >
          {t.cache}
        </button>
        <button
          className={`${styles.cacheBtn} ${isAnalysisView(drawer) ? styles.cacheBtnActive : ""}`}
          onClick={() => setDrawer((open) => (isAnalysisView(open) ? null : analysisView))}
          data-drawer="analysis"
          aria-label={t.toggleAnalysis}
          aria-expanded={isAnalysisView(drawer)}
          title={t.analysisTitle}
        >
          {t.analysis}
        </button>
        {/* Last: the menu and its notes hang from its right edge on a phone. */}
        <ExportMenu
          flow={flow}
          containerRef={viewRef}
          pageName={page.name}
          stepNumber={stepIndex + 1}
        />
      </div>
      <div className={styles.canvas}>
        {/* The cache list docks on the left: the diagram moves aside so the browser and the
            hop to its cache stay in view. */}
        <div className={`${styles.diagram} ${hasCacheList ? styles.diagramBesideCache : ""}`}>
          <NodeRenderer
            nodes={analysis.nodes}
            paths={analysis.paths}
            activeNodes={step.activeNodes}
            activePaths={step.activePaths}
            pathTimings={step.pathTimings}
            pathDirections={step.pathDirections}
            historicalPaths={historicalPaths}
            label={step.title}
            description={step.description}
            lang={coreLang}
          />
        </div>
        {/* Badges belong to the active page: each page has its own TTFB, FCP, LCP and onLoad. */}
        <BadgeRow
          steps={flow.steps}
          pageIndex={pageIndex}
          stepIndex={stepIndex}
          className={styles.badges}
        />
        {hasCacheList && <CacheSidebar resources={cacheResources} inferred={inferredCacheHits} />}
        <Suspense fallback={null}>
          {drawer === "resources" && (
            <ResourceSidebar
              resources={listedResources}
              title={listedIsOverview ? t.allResources : listedStep.title}
              overview={listedIsOverview}
              onClose={closeDrawer}
              preconnectHints={listedPage.har.preconnectHints}
              documentHostname={new URL(listedPage.har.documentEntry.url).hostname}
              renderDeadline={listedPage.trace?.lcp ?? listedPage.trace?.fcp ?? null}
            />
          )}
          {drawer === "cache" && (
            <CachePanel
              report={analysis.cacheReport}
              network={analysis.networkReport}
              pageLabel={t.pageLabel(pageIndex + 1, page.name)}
              hasDocument={pageDocument(page.har) !== null}
              onClose={closeDrawer}
            />
          )}
          {drawer === "metrics" && <MetricsSummary flow={flow} onClose={closeDrawer} />}
          {drawer === "findings" && (
            <FindingsPanel
              findings={findings}
              pageLabel={t.pageLabel(pageIndex + 1, page.name)}
              onClose={closeDrawer}
            />
          )}
          {drawer === "waterfall" && (
            <WaterfallPanel
              har={page.har}
              trace={page.trace}
              pageLabel={t.pageLabel(pageIndex + 1, page.name)}
              onClose={closeDrawer}
              focusFilter={filterRequested}
              onFilterFocused={clearFilterRequest}
            />
          )}
          {isAnalysisView(drawer) && (
            <AnalysisPanel
              view={drawer}
              onViewChange={setDrawer}
              analysis={analysis}
              hasDocument={pageDocument(page.har) !== null}
              hasTrace={page.trace !== undefined}
              pageLabel={t.pageLabel(pageIndex + 1, page.name)}
              onClose={closeDrawer}
            />
          )}
          {drawer === "hops" && (
            <HopsPanel
              hops={hops}
              protocols={protocols}
              thirdParties={analysis.thirdPartyReport}
              pageLabel={t.pageLabel(pageIndex + 1, page.name)}
              onClose={closeDrawer}
            />
          )}
        </Suspense>
      </div>
      <StepPanel
        state={state}
        resources={resources}
        resourcesOpen={drawer === "resources"}
        onToggleResources={() => toggleDrawer("resources")}
      />
    </div>
  );
}
