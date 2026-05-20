# Plan de implementación — HAR Trace Viewer (htv)

Spec de referencia: `/Users/joanleon/projects/FedEx/APAC/SPEC.md`

---

## Grafo de dependencias

```
types.ts
    ├── har-parser.ts
    │       └── step-generator.ts ──→ DiagramView (web) / render-html (CLI)
    ├── trace-parser.ts
    │       └── step-generator.ts
    └── node-detector.ts
            └── step-generator.ts
```

Los parsers son independientes entre sí y pueden desarrollarse en paralelo.
`step-generator` los consume todos — es el corazón de la lógica.
La UI consume solo `step-generator` — no conoce los parsers directamente.

---

## Fases e hitos

### Fase 1 — Fundación
Scaffolding del monorepo y lógica de parsing. Sin UI todavía.

**Tarea 1.1 — Scaffolding del monorepo**
- npm workspaces con `packages/core`, `packages/web`, `packages/cli`
- TypeScript strict en los tres paquetes
- Vitest configurado en `core`
- Verificación: `npm run build` en raíz compila sin errores

**Tarea 1.2 — Tipos compartidos**
- `types.ts`: `HarEntry`, `HarPage`, `TraceEvent`, `DiagramStep`, `DiagramNode`, `DiagramPath`, `PageFlow`, `Flow`, `Metric`
- Sin lógica, solo tipos
- Verificación: TypeScript compila sin errores

**Tarea 1.3 — HAR parser**
- Extrae del HAR: entries (URL, timing desglosado, status, headers de respuesta), `onContentLoad`, `onLoad`
- Identifica la entrada del documento principal (primer HTML)
- Calcula tiempos relativos a `startedDateTime` de la primera entry
- Tests con fixture: primeras 50 entries del HAR `en-cn_home_without-cache`
- Verificación: tests pasan, TTFB y onLoad extraídos correctamente

**Tarea 1.4 — Trace parser**
- Extrae: `navigationStart`, `firstContentfulPaint`, `LargestContentfulPaint::Candidate` (último), `MarkDOMContent`
- Soporta `.json` y `.json.gz`
- Calcula FCP y LCP relativos a `navigationStart`
- Tests con fixture: primeros 1000 eventos del Trace `en-cn_home_without-cache`
- Verificación: FCP y LCP extraídos, coinciden con lo que muestra DevTools

**Tarea 1.5 — Node detector**
- Detecta tipo de nodo desde response headers: Akamai, Cloudflare, Fastly, CloudFront, Google GFE
- Devuelve: `{ type, name, cdnProvider? }`
- Detecta si hay dominios de terceros (distinto dominio raíz al del documento)
- Tests con headers reales del HAR de FedEx
- Verificación: Akamai detectado en la entry del documento de FedEx APAC

---

### Checkpoint 1
**Criterio de paso:** Dado el HAR `en-cn_home_without-cache.har`, el sistema extrae:
- TTFB del documento principal
- onLoad de la página
- Tipo de nodo del servidor que responde (Akamai)

---

### Fase 2 — Primer diagrama visible (HAR only)
End-to-end: archivo HAR → pasos → diagrama visible en el navegador.

**Tarea 2.1 — Step generator (página única, sin Trace)**
- Genera la secuencia de pasos para una página a partir de los datos del HAR:
  1. DNS + conexión inicial
  2. Primera solicitud
  3. TTFB recibido
  4. Recursos críticos (JS/CSS bloqueantes)
  5. Recursos secundarios
  6. 3rd parties
  7. onLoad
- Cada paso incluye: `title`, `description`, `activeNodes`, `activePaths`, `metrics`
- Tests: flujo de 1 página sin Trace genera exactamente los pasos esperados
- Verificación: tests pasan

**Tarea 2.2 — Sistema de diseño (CSS)**
- CSS custom properties para dark mode (por defecto) y light mode
- Variables: colores, tipografías, tamaños
- Tamaños mínimos: nodo label 13px, métricas 14px bold, paso título 16px bold
- Sin componentes todavía — solo las variables y el reset
- Verificación: variables aplicadas, dark mode funciona en Chrome

**Tarea 2.3 — Scaffolding web app + layout base**
- React + Vite, TypeScript strict
- Layout: header + canvas SVG + panel inferior (estructura vacía)
- Color tokens aplicados
- Verificación: `npm run dev` abre en navegador sin errores

**Tarea 2.4 — NodeRenderer + topología estática**
- Renderiza los nodos SVG (Browser, Edge/CDN, Origin, 3rd Parties) en posición fija
- Cada nodo tiene su forma característica y color
- Estado activo/inactivo (opacidad)
- Verificación: nodos visibles en el diagrama con los datos del step-generator

**Tarea 2.5 — StepPanel + navegación**
- Panel inferior: título, descripción, métricas del paso
- Step track (circles numerados, estado done/active/pending)
- Botones: Prev, Next, Auto Play, Speed
- `useDiagramState` hook: estado del paso actual, autoplay
- Verificación: navegar por pasos cambia el contenido del panel y los nodos activos

**Tarea 2.6 — DropZone (un solo HAR)**
- Drag & drop o click para cargar un archivo `.har`
- Parsea el HAR, genera pasos, muestra el diagrama
- Muestra error claro si el archivo no es un HAR válido
- Verificación: cargar el HAR de FedEx muestra el diagrama con los pasos correctos

---

### Checkpoint 2
**Criterio de paso:** Abrir la web app, arrastrar `en-cn_home_without-cache.har`, ver el diagrama animado con los pasos de DNS, TTFB, recursos críticos y onLoad. Los nodos correctos (Akamai detectado) están en el diagrama.

---

### Fase 3 — Métricas de UX desde el Trace
Enriquecer el diagrama con FCP y LCP reales.

**Tarea 3.1 — Inserción de pasos FCP/LCP en el step-generator**
- `step-generator` acepta opcionalmente datos del Trace
- Inserta el paso FCP en la posición cronológica correcta
- Inserta el paso LCP en la posición cronológica correcta
- Si no hay Trace, la secuencia es idéntica a la Fase 2
- Tests: con Trace, los pasos FCP y LCP aparecen en orden; sin Trace, no aparecen
- Verificación: tests pasan

**Tarea 3.2 — MetricBadge**
- Badge SVG flotante sobre el diagrama
- Tres variantes: TTFB (amarillo), FCP (verde), LCP (naranja)
- Tamaño mínimo 14px bold
- Se muestra/oculta según el paso activo
- Verificación: badge FCP visible y posicionado sobre el nodo Browser en el paso FCP

**Tarea 3.3 — Carga del Trace en la DropZone**
- DropZone acepta un segundo archivo (Trace `.json` o `.json.gz`)
- Asociado al HAR ya cargado
- Reprocesa los pasos incluyendo FCP/LCP
- Verificación: cargar HAR + Trace muestra los pasos FCP y LCP; sin Trace, no aparecen

---

### Checkpoint 3
**Criterio de paso:** HAR + Trace del home de FedEx APAC → diagrama con paso FCP en el momento correcto (verificar contra el valor que muestra DevTools Performance), badge verde visible.

---

### Fase 4 — Topología animada
Rutas animadas entre nodos y detección real de topología.

**Tarea 4.1 — PathRenderer**
- Renderiza rutas SVG (`<path>`) entre nodos
- Estado activo: visible con glow filter
- Estado inactivo: opaco, sin glow
- Animación de paquetes moviéndose por la ruta (mismo mecanismo que los diagramas existentes)
- Verificación: al avanzar pasos, los paquetes se mueven por la ruta correcta

**Tarea 4.2 — Topología dinámica desde node-detector**
- El step-generator usa node-detector para determinar qué nodos hay
- Si se detecta Akamai: Browser → Akamai → Origin
- Si hay 3rd parties: nodo adicional con cuenta de dominios
- Si no se detecta CDN: Browser → Origin directamente
- Verificación: HAR de FedEx genera topología Browser → Akamai → Origin + 3rd Parties

**Tarea 4.3 — Zonas de red verticales en el diagrama**
- El diagrama muestra zonas de red como bandas verticales de fondo en el SVG
- Zonas: Client, Edge/CDN, Origin (las zonas presentes dependen de la topología detectada)
- La zona Client contiene una sub-zona "Cache" para recursos servidos desde disco
- Las zonas son un elemento visual pasivo: los nodos se posicionan dentro de su zona
- Cada zona tiene: label en la parte superior, color de fondo sutil diferenciado
- La estructura de zonas es genérica — funciona con cualquier dominio, no solo FedEx
- Verificación: HAR de FedEx muestra tres zonas; HAR sin CDN muestra solo Client y Origin

**Tarea 4.4 — Clasificación de recursos de caché en el step-generator**
- El step-generator clasifica cada recurso como `network` o `cache` usando el campo `cache` del HAR y los timings (`time ≈ 0` con `_fromCache: "disk"` o `"memory"`)
- Los pasos incluyen dos listas de recursos activos: `networkResources` y `cacheResources`
- El recuento de recursos de caché se agrupa por tipo (HTML, JS, CSS, imagen, fuente, otro) — misma taxonomía que el sidebar derecho
- Tests: dado un HAR con entradas `_fromCache: "disk"`, los recursos aparecen en `cacheResources` del paso correspondiente
- Verificación: tests pasan; el HAR de FedEx warm-cache tiene recursos correctamente clasificados

**Tarea 4.5 — CacheSidebar (sidebar izquierdo)**
- Sidebar izquierdo simétrico al `ResourceSidebar` derecho (misma estructura, distinto origen de datos)
- Muestra los recursos cargados desde caché en el paso actual, agrupados por tipo
- Cada grupo es colapsable; muestra URL, tamaño y tipo de caché (disk / memory)
- Solo visible cuando hay recursos de caché en el paso activo; oculto si no hay
- Verificación: al navegar a un paso con recursos de caché, el sidebar izquierdo se popula correctamente

---

### Checkpoint 4
**Criterio de paso:** El diagrama del HAR de FedEx muestra Browser → Akamai → Origin con paquetes animados, bandas verticales de zona con sub-zona Cache, y sidebars izquierdo/derecho con recursos de caché y red respectivamente.

---

### Fase 5 — Flujo multi-página
Encadenar múltiples páginas en un diagrama continuo.

**Tarea 5.1 — Flow data model + transiciones**
- `step-generator` acepta un array de páginas (`PageFlow[]`)
- Genera pasos de transición entre páginas: "→ Usuario navega a [nombre]"
- La secuencia de pasos es continua: Home steps → transición → Login steps
- Tests: flujo de 2 páginas genera pasos de ambas más 1 paso de transición
- Verificación: tests pasan

**Tarea 5.2 — Flow UI en DropZone**
- Interfaz para añadir múltiples páginas al flujo
- Cada página: nombre + archivo HAR + archivo Trace (opcional)
- Orden de las páginas ajustable (drag o botones up/down)
- Botón "Generate diagram" procesa el flujo completo
- Verificación: añadir 2 HAR con nombres distintos genera un diagrama con pasos de transición

---

### Checkpoint 5
**Criterio de paso:** Cargar los HAR+Trace de Home y Login de FedEx APAC como flujo. El diagrama muestra ~18 pasos: Home load → "Navega a Login" → Login load, con FCP/LCP de cada página marcados.

---

### Fase 6 — Accesibilidad y light mode

**Tarea 6.1 — Light mode completo**
- Variables CSS para light mode (colores, backgrounds)
- Colores de acento ajustados para mantener contraste sobre fondo claro
- Scanline overlay desactivado en light mode
- Toggle en el header: `☀` / `🌙`, responde a `prefers-color-scheme` al cargar
- Verificación: toggle funciona, diagrama es legible en ambos modos

**Tarea 6.2 — Auditoría de tipografía**
- Revisar todos los textos SVG y HTML del diagrama
- Garantizar mínimos del spec: 13px nodos, 14px métricas, 16px título de paso, 12px metadatos
- Verificación: ningún `font-size` por debajo de 12px en el output generado

**Tarea 6.3 — Contraste WCAG AA**
- Verificar ratio de contraste en dark mode y light mode para todos los elementos de texto
- Ajustar colores donde no se cumpla el ratio 4.5:1
- Verificación: DevTools Accessibility panel sin errores de contraste en ambos modos

---

### Fase 7 — CLI

**Tarea 7.1 — CLI básico (`htv`)**
- Comando: `htv --page "Name" --har file.har --output ./report`
- Genera `index.html` + assets en el directorio de output
- Verificación: abrir el HTML generado en Chrome sin errores de consola

**Tarea 7.2 — Flag `--bundle`**
- Inlina CSS, JS y fuentes en un único `.html` autocontenido
- Fuentes embebidas como base64
- Verificación: el `.html` funciona sin servidor y sin conexión a internet

**Tarea 7.3 — CLI multi-página**
- Sintaxis para múltiples páginas:
  `htv --page "Home" --har h.har --trace t.json.gz --page "Login" --har l.har --bundle`
- Verificación: genera diagrama con flujo completo

---

### Checkpoint final
**Criterio de paso:** Todos los criterios de aceptación del spec verificados:
- [x] Flujo de 3 páginas encadenado correctamente (FedEx Home × 2 + Login = 29 pasos)
- [x] Badges FCP/LCP en el paso correcto (FCP paso 5, badge 876ms)
- [x] Nodo Akamai detectado en HARs de FedEx (label "Akamai Edge")
- [x] CLI `--bundle` genera HTML sin servidor (file:// sin errores)
- [x] Sin Trace: no hay pasos FCP/LCP, sin errores (solo TTFB + onLoad)
- [x] TTFB coincide con valores del HAR (HAR wait 160ms = badge 160ms)
- [x] Funciona offline (file:// bundle sin red)
- [x] Ningún texto < 12px (0 violaciones en DOM + SVG)
- [x] Light/dark mode funciona en web y CLI output (toggle operativo)
- [x] WCAG AA en ambos modos (Lighthouse Accessibility 100/100 dark y light)

---

## Decisiones de arquitectura

**¿Por qué vertical slices y no capas?**
Cada fase termina con algo funcionando end-to-end. Si el proyecto se para en cualquier punto, lo construido hasta ese checkpoint es usable.

**¿Por qué `step-generator` como núcleo?**
Es el único componente que conoce tanto los datos (parsers) como la estructura de salida (pasos). La UI y la CLI son consumidores pasivos — no toman decisiones sobre qué mostrar.

**¿Por qué no geolocalización IP?**
El node-detector usa headers, no IPs. Es más fiable (los headers CDN son definitivos), no requiere base de datos externa, y funciona offline.
