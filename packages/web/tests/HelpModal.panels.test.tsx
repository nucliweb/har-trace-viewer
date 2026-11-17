import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HelpModal } from "../src/components/HelpModal.js";
import { MessagesContext } from "../src/i18n/context.js";
import { ca } from "../src/i18n/ca.js";
import { en } from "../src/i18n/en.js";
import { es } from "../src/i18n/es.js";

describe("HelpModal: panel shortcuts", () => {
  it.each([
    ["English", en, "Panels", "Filter the waterfall requests"],
    ["Spanish", es, "Paneles", "Filtrar las peticiones de la cascada"],
    ["Catalan", ca, "Panells", "Filtra les peticions de la cascada"],
  ])("lists the drawer keys and the filter key in %s", (_name, messages, group, filter) => {
    render(
      <MessagesContext.Provider value={messages}>
        <HelpModal onClose={() => undefined} />
      </MessagesContext.Provider>
    );

    const section = screen.getByRole("region", { name: group });
    const keys = within(section)
      .getAllByRole("term")
      .map((term) => term.textContent);
    expect(keys).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "/"]);
    expect(within(section).getByText(filter)).toBeInTheDocument();
  });
});
