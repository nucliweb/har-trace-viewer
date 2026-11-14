import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { CompareView } from "../src/components/CompareView.js";
import { DiagramView } from "../src/components/DiagramView.js";
import { ca } from "../src/i18n/ca.js";
import { MessagesContext } from "../src/i18n/context.js";
import type { Messages } from "../src/i18n/en.js";
import { es } from "../src/i18n/es.js";
import { makeCompareFlows, makeFlow } from "./fixtures.js";

const inLanguage = (messages: Messages, children: ReactNode) => (
  <MessagesContext.Provider value={messages}>{children}</MessagesContext.Provider>
);

describe("DiagramView in Spanish", () => {
  const flow = makeFlow();

  it("names the step track and the step controls", () => {
    render(inLanguage(es, <DiagramView flow={flow} />));
    expect(screen.getByText(`Paso 1 / ${flow.steps.length}`)).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "Pasos" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^Paso 1: / })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Siguiente →" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reproducir automáticamente" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Velocidad de reproducción" })).toBeInTheDocument();
  });

  it("opens each drawer under its Spanish name", async () => {
    const user = userEvent.setup();
    render(inLanguage(es, <DiagramView flow={flow} />));
    const drawers: [string, string][] = [
      ["Mostrar u ocultar los hallazgos", "Cerrar los hallazgos"],
      ["Mostrar u ocultar la cascada", "Cerrar la cascada"],
      ["Mostrar u ocultar los saltos", "Cerrar los saltos"],
      ["Mostrar u ocultar el resumen de métricas", "Cerrar el resumen de métricas"],
      ["Mostrar u ocultar el análisis de caché", "Cerrar el análisis de caché"],
    ];
    for (const [toggle, close] of drawers) {
      await user.click(screen.getByRole("button", { name: new RegExp(`^${toggle}`) }));
      await user.click(await screen.findByRole("button", { name: close }));
    }
  });

  it("speaks Spanish inside the drawers", async () => {
    const user = userEvent.setup();
    render(inLanguage(es, <DiagramView flow={flow} />));

    await user.click(screen.getByRole("button", { name: "Mostrar u ocultar la cascada" }));
    expect(
      await screen.findByRole("searchbox", { name: "Filtrar las peticiones" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tabla" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Mostrar u ocultar los saltos" }));
    const hops = await screen.findByRole("table", { name: "Saltos por host" });
    expect(within(hops).getByRole("columnheader", { name: "Proveedor" })).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Mostrar u ocultar el análisis de caché" })
    );
    expect(await screen.findByText("Caché del navegador")).toBeInTheDocument();
  });
});

describe("CompareView in Catalan", () => {
  const [a, b] = makeCompareFlows();

  it("names the comparison, its deltas and its step controls", async () => {
    const user = userEvent.setup();
    render(inLanguage(ca, <CompareView a={a} b={b} />));
    expect(screen.getByRole("region", { name: "Comparació" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "← Anterior" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Mostra o amaga les diferències" }));
    expect(screen.getByRole("table", { name: "Diferències de mètriques" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tanca les diferències" })).toBeInTheDocument();
  });
});
