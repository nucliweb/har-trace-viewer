# Preact evaluation for the report runtime (task 2.6)

## Context

`@htv/web` is the viewer that the CLI copies into every report. It has no deployment of its own: its production build exists only inside `packages/cli/dist/web`, and from there inside each generated report (plain folder or `--bundle` single file). The only other way it runs is the Vite dev server used while developing the viewer.

A one-page `--bundle` report weighs about 359 KB, and the JavaScript is 60% of it (216 KB raw, 69 KB gzip). React and ReactDOM account for most of that JavaScript. The question is whether `preact/compat` can replace them, and whether that should apply only to the report build or to the whole package.

The evaluation ran on a copy of the repository; no source file of the repository changes as part of it.

## Method

- Copy: `/private/tmp/claude-501/-Users-joanleon-projects-har-trace-viewer/85b7eb7a-045b-4ce0-b41d-d8ba4990c66d/scratchpad/preact-eval` (rsync without `node_modules`, `.git` and `dist`, then `npm install`).
- Runtimes: React 18.3.1 (baseline), Preact 10.29.8 (latest 10.x, published 2026-08-01) and Preact 11.0.2 (published 2026-10-23; 11.0.0 is from 2026-09-30, 11.1.0 from 2026-10-27).
- Variant A, report only: `vite.config.ts` becomes `defineConfig(({ mode }) => …)` and adds exact-match aliases (`react`, `react-dom` → `preact/compat`; `react-dom/client` → `preact/compat/client`; `react-dom/server` → `preact/compat/server`; `react-dom/test-utils` → `preact/test-utils`; `react/jsx-runtime` and `react/jsx-dev-runtime` → `preact/jsx-runtime` and `preact/jsx-dev-runtime`) only when `mode === "report"`. The CLI build runs `npm --prefix ../web run build -- --mode report`. Unit tests run with `vitest run --mode report`.
- Variant B, single runtime: `@preact/preset-vite` replaces `@vitejs/plugin-react` in every mode (the preset adds the same aliases, the JSX transform and Prefresh HMR). Dev, unit tests, build and e2e all run on Preact.
- Sizes: the CLI generates the `webperf-snippets` fixture (`packages/core/tests/fixtures`, one page with HAR and trace) both with `--bundle` and plain. Gzip sizes come from `gzip -9 -c file | wc -c`. The JSON, JS and CSS shares are measured by extracting the inline `<script>window.__HTV_FLOW__ …</script>`, `<script type="module">` and `<style>` blocks of the bundle. Script: `scratchpad/eval-scripts/measure.sh`.
- Behavior checks:
  - `npm test -w @htv/web` under each runtime (68 tests, including the `renderToStaticMarkup` geometry guard).
  - `npm run e2e` (16 Playwright tests over CLI-built reports: file:// offline, no network, step navigation, resource and cache lists, theme toggle, 12 px minimum, axe in both themes, plain report over HTTP, worker fallback), repeated 3 to 5 times per runtime.
  - Markup diff: every geometry-test state of `NodeRenderer` rendered with `renderToStaticMarkup` and with Testing Library `render` under React and under Preact, compared byte by byte.
  - DOM diff of the real report: a Playwright script drives both bundles through the same 15 states (every step, cache panel open, `<details>` toggled, resource list, metrics panel, theme toggle) and compares `#root` after normalizing attribute order. Script: `scratchpad/eval-scripts/dom-equivalence.mjs`.
  - `<details>` behavior: a second Playwright script opens the cached-visit report (`fixtures/webperf-snippets.nucliweb.net_Cache-20260519T123746.har`, built once with the React web build and once with the Preact one), visits every step, records the open state of each `<details>` group on mount, after clicking the first `<summary>`, and after a full app re-render (theme toggle). Script: `scratchpad/eval-scripts/details-check.mjs`.
  - Startup: time from navigation to `#diagram-svg` in the DOM, file:// bundle, 4x CPU throttling, median of 15 runs on an Apple Silicon laptop. Script: `scratchpad/eval-scripts/startup.mjs`.
  - Dev server: `vite` started in each variant, page loaded in headless Chromium, a component edited to check HMR.
- Typing: `tsc` with the existing `@types/react`, and a trial `tsconfig` whose `paths` point `react*` at the `preact/compat` types.

## Sizes

All values in bytes, one-page fixture report. The CSS row includes the three woff2 fonts inlined as base64.

| Artifact | React 18.3.1 raw | React gzip | Preact 10.29.8 raw | Preact gzip | Change raw | Change gzip |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Web JS bundle (`assets/index-*.js`) | 215,791 | 68,558 | 96,249 | 32,623 | -119,542 (-55.4%) | -35,935 (-52.4%) |
| Parse worker chunk | 7,060 | 2,969 | 7,060 | 2,969 | 0 | 0 |
| Web CSS file (`assets/index-*.css`) | 29,687 | 5,351 | 29,687 | 5,351 | 0 | 0 |
| `--bundle` report `index.html` | 358,665 | 139,674 | 239,123 | 104,246 | -119,542 (-33.3%) | -35,428 (-25.4%) |
| of which inline module JS | 215,792 | 68,550 | 96,250 | 32,616 | -119,542 | -35,934 |
| of which inline CSS with fonts | 105,413 | 63,242 | 105,413 | 63,242 | 0 | 0 |
| of which flow JSON | 36,791 | 6,944 | 36,791 | 6,944 | 0 | 0 |
| Plain report `index.html` (holds the JSON) | 37,886 | 7,489 | 37,886 | 7,489 | 0 | 0 |
| Plain report, all files | 347,268 | | 227,726 | | -119,542 (-34.4%) | |

Preact 11.0.2 gives the same result within noise: JS 96,061 raw and 32,711 gzip, bundle 238,935 raw and 104,338 gzip. Variant A and variant B produce byte-identical JS (96,249 bytes); the preset changes nothing in the production output.

Shares of the `--bundle` report:

| Part | React raw | React gzip | Preact raw | Preact gzip |
| --- | ---: | ---: | ---: | ---: |
| JS | 60.2% | 49.1% | 40.3% | 31.3% |
| CSS with fonts | 29.4% | 45.3% | 44.1% | 60.7% |
| Flow JSON | 10.3% | 5.0% | 15.4% | 6.7% |

With Preact the inlined fonts become the largest part of the compressed report: base64 woff2 does not compress, so 63 KB of the 104 KB gzip are CSS and fonts.

Startup (navigation to diagram in the DOM, 4x CPU throttling, 15 runs): React median 56.0 ms (53.7 to 76.0), Preact median 36.8 ms (35.4 to 38.1), about 19 ms (34%) less parse and render work.

The plan estimated about 40 KB gzip per report; the measured saving is 35.4 KB gzip on the bundle and 35.9 KB gzip on the JS file.

## Test and e2e results

| Check | React 18.3.1 | Preact 10.29.8 | Preact 11.0.2 |
| --- | --- | --- | --- |
| `@htv/web` unit tests (68) | 68 pass | 68 pass (after the Testing Library setup below) | 68 pass |
| `renderToStaticMarkup` geometry guard | pass | pass, markup byte-identical to React | pass, markup byte-identical to React |
| Client render of every `NodeRenderer` state | reference | identical `innerHTML` | identical `innerHTML` |
| e2e (16 tests) | 16 pass | 15 pass, 1 fail; 16 pass x5 runs after the `useTheme` fix | 16 pass x3 runs with the fix; the theme test fails 3 of 3 without it |
| Report DOM over 15 interaction states | reference | identical except `class=""` on 8 cells (see below) | not run |
| `<details>` states on the cached-visit report | reference | identical on every step (mount, toggle, re-render) | not run |
| Console errors in the report | none | none | none |
| `npm run typecheck`, `npm run lint`, `test:coverage` thresholds | pass | pass (variant B) | not run |
| Dev server and HMR | works | variant A: page loads, HMR does not update; variant B: HMR works | not run |

Features checked explicitly, all working under `preact/compat` with no code change:

- `React.memo` (`NodeRenderer`) and `useMemo`, `useCallback`, `useRef`, `useState`, `useEffect`.
- `useId` (`FlowBuilder` region `<label htmlFor>`): labels resolve in Testing Library queries; the generated id format differs (Preact `P0-0`, React `:r0:`) and nothing depends on it.
- `useSyncExternalStore`, `forwardRef`, `createPortal`, `Suspense`, `lazy`: not used in `src`.
- `<animateMotion>` with camelCase `keyPoints`, `keyTimes`, `calcMode`, `repeatCount`, `rotate`, `begin`, and `<mpath href>`: serialized with the same casing in SSR and client DOM; the e2e motion tests (default and reduced motion) pass. Preact's compat attribute rewriting only kebab-cases presentation attributes such as `strokeWidth`, not these.
- `<feGaussianBlur stdDeviation>`, `<feMergeNode in>` inside `<filter>`: identical output.
- `<details open>` and `<summary>` through the polymorphic `SidebarGroup as="details"`: same open state on mount (open up to 6 entries, closed above), toggling by click works, and an app re-render keeps the user's toggle, exactly as with React.
- `role`, `aria-*`, `tabIndex`, `htmlFor`, `className`: identical attributes; axe wcag2a/aa has no violations in both themes and with the cache panel open.
- `<select onChange>` and `<input type="file" onChange>`: work (unit tests and the e2e worker fallback test upload a HAR through the builder inside the report).
- CSS modules: unaffected (resolved by Vite before the runtime sees class names).
- `new Worker(new URL("../workers/parse.worker.ts", import.meta.url))`: unaffected; the worker chunk has no React code and is identical in both builds.
- `ReactDOM.createRoot` from `react-dom/client` → `preact/compat/client`: works.
- `React.StrictMode`: accepted; in Preact it is a plain Fragment (no double render in dev).
- `react-dom/server` `renderToStaticMarkup` → `preact/compat/server` (needs `preact-render-to-string`): works.
- Testing Library `render`, `screen`, `act`, `userEvent`, `cleanup`: work once Testing Library itself is resolved through the aliases.

## Incompatibilities found

| # | Symptom | Cause | Fix (applied in the copy) |
| --- | --- | --- | --- |
| 1 | e2e "theme toggle flips data-theme and the body background" fails deterministically: right after the click `data-theme` still holds the old value. | `useTheme` writes `data-theme` in `useEffect`. React flushes passive effects synchronously after a discrete event such as a click; Preact runs them after the next frame (`requestAnimationFrame` plus `setTimeout`). With Preact the page paints one frame with the new toggle icon and the old theme colors. | Write the attribute in `useLayoutEffect` (`packages/web/src/hooks/useTheme.ts`). One-line change, also correct under React: a DOM write that changes what is painted belongs before paint. With it the test passes 5 of 5 runs on Preact and still passes on React. |
| 2 | 41 of 68 unit tests fail with `Cannot read properties of undefined (reading '__H')`, then with `Expected ref to be a function…` from `react-dom.development.js`. | Vitest externalizes `@testing-library/react`, so `resolve.alias` never applies to it, and its `main` entry is CommonJS whose `require("react-dom")` loads the real ReactDOM, which then renders Preact components. | In the Vitest config: alias `^@testing-library/react$` to `@testing-library/react/dist/@testing-library/react.esm.js` and add `test.server.deps.inline: [/@testing-library\/react/]`. All 68 pass. The alternative is `@testing-library/preact`, which changes the imports of every test file. |
| 3 | `vitest.config.ts` stops loading in variant A. | `mergeConfig(viteConfig, …)` cannot merge a config function, and a mode-specific Vite config has to be a function. | Wrap it: `defineConfig((env) => mergeConfig(viteConfig(env), …))`. Not needed in variant B. |
| 4 | In variant A, `vite --mode report` loads the app, but editing a component logs "hot updated" and the page keeps the old content. | `@vitejs/plugin-react` injects React Refresh, which cannot patch Preact components. | Use `@preact/preset-vite` (Prefresh) whenever Preact runs in dev. Verified: the edit appears without a reload and component state survives. |
| 5 | After switching Preact versions in the copy, `npm ls preact` shows two copies (10.29.8 for `@htv/web`, 11.0.2 hoisted for `preact-render-to-string` and `@prefresh/*`). Two Preact instances break hooks (same `__H` error as #2). | `preact-render-to-string` and `@prefresh/core` declare `preact` as a peer, and npm resolved the peer to a different version than the workspace's. | Pin one version for the whole tree with a root `overrides: { "preact": "10.29.8" }` and reinstall from a clean lockfile; `npm ls preact` then shows a single deduped copy. |
| 6 | Report DOM differs on 8 cells of the metrics table: React writes `class=""`, Preact omits the attribute. | `className=""` for the `none` rating in `MetricsSummary`. | None needed: no selector or test relies on an empty class attribute. |
| 7 | Typechecking `src` against the `preact/compat` types (instead of `@types/react`) reports 23 errors: `e.target` is `EventTarget \| null` in `onChange` handlers (`FlowBuilder`, `StepPanel`), `TargetedDragEvent` needs a type argument, and `ElementType` rejects `selectedcontent` in the polymorphic `SidebarGroup`. | Preact's JSX event and element types are stricter and shaped differently from React's. | Keep typechecking against `@types/react` (it passes, and the code only uses APIs `preact/compat` implements). Moving the types to Preact is optional and would touch about 10 handlers. |

No incompatibility was found in `memo`, `useId`, SVG animation attributes, `<details>`, ARIA, CSS modules, the Worker import, `createRoot`, `StrictMode` or `renderToStaticMarkup`.

## Risks and maintenance cost

1. Two runtimes (variant A). Production runs Preact while dev and unit tests run React, so the runtime that ships is the one exercised least. Incompatibility #1 is that kind of bug: React's unit tests and dev server would never show it, and only the e2e suite catches it. Variant A needs a second unit-test run under the alias (`vitest run --mode report`, about 2 s) on top of the e2e suite, which already runs on the CLI build. Variant B has one runtime and no extra CI step.
2. Dev experience. Variant A keeps React DevTools and React Refresh in `npm run dev`, but `vite --mode report` without the preset has no HMR. Variant B uses Preact DevTools and Prefresh; `StrictMode` double invocation in dev no longer runs, so effects with missing cleanups are no longer surfaced there (the `react-hooks` lint rules still run).
3. Dependencies. Variant B adds `@preact/preset-vite` with `@babel/core` (34 packages, dev only) and `preact-render-to-string`; it removes `@vitejs/plugin-react`. `react` and `react-dom` stay installed only as peers of `@testing-library/react` and never reach the bundle. Variant A only adds `preact` and `preact-render-to-string`.
4. Types do not describe the runtime. `@types/react` accepts any React API, including ones `preact/compat` lacks (React 19 `use` in Preact 10, `useActionState`, `useOptimistic`, `useFormStatus`, `react-dom` resource preloading). The e2e suite and the unit tests are the only guard. A `no-restricted-imports` rule listing those names keeps them out at lint time.
5. Effect timing. Preact runs `useEffect` after paint and, in Preact 11, also defers unmount cleanups until after paint. Code that writes to the DOM outside the component tree (`document.documentElement`, focus, scroll) belongs in `useLayoutEffect`. Today only `useTheme` does this.
6. Duplicate Preact copies (#5). Peers of `preact-render-to-string` and `@prefresh/*` can resolve to another version on an upgrade. The root `overrides` pin and an `npm ls preact` check after each upgrade prevent it.
7. Upstream velocity. Preact 10.x has had no release since 2026-08-01, and new work lands on 11.x. Preact 11.0.0 shipped on 2026-09-30 with 11.0.1, 11.0.2 and 11.1.0 in the four weeks after it; it is ESM only, passes `ref` as a regular prop (React 19 semantics), moves `defaultProps` and numeric `px` suffixing into compat, drops `SuspenseList`, requires TypeScript 5.1+ and targets Chrome 71+, Safari 12.1+, Firefox 69+. Its compat layer reports React 19.0.0 and adds `use` and `useEffectEvent`. None of those changes touches this codebase: the full suite passes on 11.0.2 with the same single fix. Preact 10 matches the React 18 semantics the code is written for; Preact 11 matches React 19.
8. Task 3.7 (React 19). With variant B the React 19 upgrade reduces to `@types/react` 19 plus Preact 11, because the React runtime no longer ships. With variant A, 3.7 has to keep both runtimes in step, and Preact 10 compat does not implement React 19 APIs that React 19 types allow.
9. Reversibility. Source files keep importing from `react`; the switch lives in `vite.config.ts`, `vitest.config.ts` and `package.json`, plus the `useLayoutEffect` change, which is correct for React too. Going back to React is a config revert.

## Recommendation

Adopt Preact for both, as the single runtime of `@htv/web` (variant B).

- The saving is real and recurring: 119.5 KB raw and 35.4 KB gzip per `--bundle` report (-33% raw, -25% gzip), 119.5 KB per plain report, and about a third less startup work.
- Compatibility is high: the rendered DOM matches React's across every diagram state and every report interaction tested; the one behavioral difference (#1) has a one-line fix that is also correct for React; the rest is test and build configuration.
- Report only (variant A) does not fit this repository: the report is the only production artifact of `@htv/web`, so "report only" means shipping Preact while developing and unit-testing on React. That keeps the cost of two runtimes and tests the shipped one least.
- Start on Preact 10.29.8, which matches the React 18 semantics the code and `@types/react` 18 describe. Move to Preact 11 as part of task 3.7, together with `@types/react` 19, after 11.x has had a few patch releases in production use.

## Steps to adopt (variant B)

1. `packages/web/src/hooks/useTheme.ts`: import `useLayoutEffect` and write `data-theme` in it instead of `useEffect`, with a comment that the attribute changes what is painted. Run `npm test -w @htv/web` and `npm run e2e` on React first: both stay green.
2. Dependencies in `packages/web`:
   - `npm install -w @htv/web preact@10.29.8`
   - `npm install -w @htv/web -D @preact/preset-vite @babel/core preact-render-to-string`
   - `npm uninstall -w @htv/web @vitejs/plugin-react`
   - Move `react` and `react-dom` from `dependencies` to `devDependencies` (they stay for `@testing-library/react` and the types); keep `@types/react` and `@types/react-dom`.
3. Root `package.json`: add `"overrides": { "preact": "10.29.8" }`, run `npm install`, and confirm `npm ls preact` lists one deduped copy.
4. `packages/web/vite.config.ts`:

   ```ts
   import { defineConfig } from "vite";
   import preact from "@preact/preset-vite";

   // Preact runs the viewer: the preset aliases react / react-dom to preact/compat, compiles JSX
   // for Preact and provides Prefresh HMR in the dev server.
   export default defineConfig({
     plugins: [preact()],
     base: "./",
   });
   ```

5. `packages/web/vitest.config.ts`: inside the `defineConfig` passed to `mergeConfig`, add

   ```ts
   resolve: {
     alias: [
       // The CJS build of Testing Library would require() the real react-dom; its ESM build
       // goes through the preact/compat aliases instead.
       {
         find: /^@testing-library\/react$/,
         replacement: "@testing-library/react/dist/@testing-library/react.esm.js",
       },
     ],
   },
   ```

   and in `test`: `server: { deps: { inline: [/@testing-library\/react/] } }` with a comment that externalized dependencies skip `resolve.alias`.
6. `eslint.config.js`: add `no-restricted-imports` for `react` named imports that `preact/compat` 10 lacks (`use`, `useActionState`, `useOptimistic`, `useFormStatus`) and for `react-dom` resource APIs (`preload`, `preinit`, `prefetchDNS`, `preconnect`).
7. `README.md` and `packages/web` description: the viewer is "built with Preact (React API through preact/compat)".
8. Verify: `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:coverage`, `npm run build`, `npm run e2e`; open a `--bundle` report by double-click and walk the steps, the cache panel, the metrics panel and the theme toggle; run `npm run dev -w @htv/web`, edit a component and confirm HMR. Expected: `packages/web/dist/assets/index-*.js` about 96 KB raw and 33 KB gzip.
9. CI needs no new job: the existing `build`, `test` and `e2e` steps run on Preact. Optionally add `npm ls preact` after `npm ci` so a duplicate copy fails the build.

If the decision is report only instead (variant A), the copy keeps the exact files under `scratchpad/eval-scripts/`: `vite.config.alias.ts` (mode-specific aliases), `vitest.config.alias.ts` (function config plus Testing Library alias in `report` mode) and `cli-package.alias.json` (CLI `build` script with `-- --mode report`). CI then also needs `npm test -w @htv/web -- --mode report`.

## Artifacts

- Copy of the repository in variant B state: `/private/tmp/claude-501/-Users-joanleon-projects-har-trace-viewer/85b7eb7a-045b-4ce0-b41d-d8ba4990c66d/scratchpad/preact-eval`
- Scripts and variant A files: `/private/tmp/claude-501/-Users-joanleon-projects-har-trace-viewer/85b7eb7a-045b-4ce0-b41d-d8ba4990c66d/scratchpad/eval-scripts`
- Reports, markup and DOM dumps per runtime: `/private/tmp/claude-501/-Users-joanleon-projects-har-trace-viewer/85b7eb7a-045b-4ce0-b41d-d8ba4990c66d/scratchpad/measure`
