import { useCallback, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  analyzeHops,
  collectFindings,
  getStepCacheResources,
  getStepInferredCacheHits,
  getStepResources,
} from "@htv/core";
import type { Flow } from "@htv/core";
import { useBottomEdge } from "../hooks/useBottomEdge.js";
import { useDiagramState } from "../hooks/useDiagramState.js";
import { useEscapeToClose } from "../hooks/useEscapeToClose.js";
import { useStepKeyboard } from "../hooks/useStepKeyboard.js";
import { computeHistoricalPaths } from "../lib/historical-paths.js";
import { NodeRenderer } from "./NodeRenderer.js";
import { StepPanel } from "./StepPanel.js";
import { ResourceSidebar } from "./ResourceSidebar.js";
import { CacheSidebar } from "./CacheSidebar.js";
import { CachePanel } from "./CachePanel.js";
import { MetricsSummary } from "./MetricsSummary.js";
import { HopsPanel } from "./HopsPanel.js";
import { FindingsButton, FindingsPanel } from "./FindingsPanel.js";
import { WaterfallButton, WaterfallPanel } from "./WaterfallPanel.js";
import { ExportMenu } from "./ExportMenu.js";
import { BadgeRow } from "./BadgeRow.js";
import { useCoreLang, useMessages } from "../i18n/context.js";
import styles from "./DiagramView.module.css";

interface Props {
  flow: Flow;
}

type Drawer = "findings" | "waterfall" | "hops" | "metrics" | "cache" | "resources";

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
  const step = flow.steps[stepIndex];
  const { pageIndex } = step;
  // Steps reference their page entries by index: resolve them once per step.
  const resources = useMemo(() => getStepResources(flow, flow.steps[stepIndex]), [flow, stepIndex]);
  const cacheResources = useMemo(
    () => getStepCacheResources(flow, flow.steps[stepIndex]),
    [flow, stepIndex]
  );
  const inferredCacheHits = useMemo(
    () => getStepInferredCacheHits(flow, flow.steps[stepIndex]),
    [flow, stepIndex]
  );
  const hasCacheList = cacheResources.length + inferredCacheHits.length > 0;
  // Indexing keeps the analysis reference stable while the user stays on a page.
  const analysis = flow.pageAnalyses[pageIndex];
  const page = flow.pages[pageIndex];
  // Every drawer docks on the right, so only one is open at a time: none hides behind another.
  const [drawer, setDrawer] = useState<Drawer | null>(null);
  const toggleDrawer = (name: Drawer) => setDrawer((open) => (open === name ? null : name));
  // Closing hands the focus back to the drawer's toggle, or to the diagram when the toggle is
  // gone (the resource list stays open on a step that requests nothing, without its button).
  const closeDrawer = useCallback(() => {
    const view = viewRef.current;
    const toggle = view?.querySelector<HTMLElement>(`[data-drawer="${drawer}"]`);
    (toggle ?? view)?.focus();
    setDrawer(null);
  }, [drawer]);
  useEscapeToClose(drawer !== null, closeDrawer);
  // The resource list follows the steps that request something. Milestone steps (FCP, LCP)
  // request nothing, so the list stays on the last step that did, under that step's title.
  const [listedIndex, setListedIndex] = useState(stepIndex);
  if (drawer === "resources" && resources.length > 0 && listedIndex !== stepIndex) {
    setListedIndex(stepIndex);
  }
  const listedStep = flow.steps[listedIndex] ?? step;
  const listedPage = flow.pages[listedStep.pageIndex];
  const listedResources = useMemo(() => getStepResources(flow, listedStep), [flow, listedStep]);
  const hops = useMemo(() => analyzeHops(page.har, page.har.documentEntry.url), [page.har]);
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
        <ExportMenu containerRef={viewRef} pageName={page.name} stepNumber={stepIndex + 1} />
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
        <BadgeRow steps={flow.steps} pageIndex={pageIndex} stepIndex={stepIndex} />
        {hasCacheList && <CacheSidebar resources={cacheResources} inferred={inferredCacheHits} />}
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
          />
        )}
        {drawer === "hops" && (
          <HopsPanel
            hops={hops}
            thirdParties={analysis.thirdPartyReport}
            pageLabel={t.pageLabel(pageIndex + 1, page.name)}
            onClose={closeDrawer}
          />
        )}
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
