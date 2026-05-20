# TODO — HAR Trace Viewer (htv)

## Fase 1 — Fundación

- [x] **1.1** Scaffolding monorepo (npm workspaces, TypeScript, Vitest)
- [x] **1.2** Tipos compartidos (`types.ts`: Flow, Page, Step, Node, Metric, HarEntry, TraceEvent)
- [x] **1.3** HAR parser + tests con fixture FedEx APAC
- [x] **1.4** Trace parser (FCP, LCP, gz support) + tests con fixture FedEx APAC
- [x] **1.5** Node detector (Akamai, Cloudflare, Fastly, CloudFront, GFE) + tests

### ✓ Checkpoint 1
TTFB, onLoad y tipo de nodo correctos para `en-cn_home_without-cache.har`

---

## Fase 2 — Primer diagrama visible

- [x] **2.1** Step generator — página única sin Trace + tests
- [x] **2.2** Sistema de diseño CSS (tokens dark/light, tipografía, tamaños mínimos)
- [x] **2.3** Scaffolding web app React + Vite + layout base
- [x] **2.4** NodeRenderer (Browser, Edge, Origin, 3rd Parties) en SVG
- [x] **2.5** StepPanel + navegación (Prev/Next/AutoPlay) + `useDiagramState`
- [x] **2.6** DropZone (un solo HAR) → diagrama visible

### ✓ Checkpoint 2
Cargar HAR de FedEx → diagrama animado con nodo Akamai y pasos correctos

---

## Fase 3 — Métricas de UX (Trace)

- [x] **3.1** Step generator — inserción de pasos FCP/LCP + tests
- [x] **3.2** MetricBadge (TTFB / FCP / LCP) sobre el SVG
- [x] **3.3** DropZone acepta Trace + reprocesa pasos

### ✓ Checkpoint 3
HAR + Trace → paso FCP en la posición cronológica correcta, badge verde visible

---

## Fase 4 — Topología animada

- [x] **4.1** PathRenderer + animación de paquetes (glow filter en paths activos)
- [x] **4.2** Topología dinámica desde node-detector en el step-generator
- [x] **4.3** Zonas de red verticales como bandas de fondo en el SVG (Client con sub-zona Cache / Edge / Origin)
- [x] **4.4** Clasificación de recursos `network` vs `cache` en el step-generator + tests
- [x] **4.5** CacheSidebar (sidebar izquierdo) — recursos de caché por paso, agrupados por tipo

### ✓ Checkpoint 4
HAR FedEx → Browser → Akamai → Origin con paquetes animados, zonas verticales con sub-zona Cache, sidebars izquierdo (caché) y derecho (red)

---

## Fase 5 — Flujo multi-página

- [x] **5.1** Flow data model + pasos de transición entre páginas + tests
- [x] **5.2** Flow UI en DropZone (añadir páginas, nombrar, ordenar)

### ✓ Checkpoint 5
Home + Login FedEx → diagrama continuo con pasos de transición y FCP/LCP de cada página

---

## Fase 6 — Accesibilidad y light mode

- [x] **6.1** Light mode completo + toggle (responde a `prefers-color-scheme`)
- [x] **6.2** Auditoría tipografía — garantizar mínimos del spec
- [x] **6.3** Contraste WCAG AA verificado en dark y light mode

---

## Fase 7 — CLI

- [x] **7.1** CLI básico `htv --page --har --output`
- [x] **7.2** Flag `--bundle` (HTML autocontenido, fuentes base64)
- [x] **7.3** CLI multi-página

### ✓ Checkpoint final
Todos los criterios de aceptación del spec verificados
