import { expandPageFlows, generateFlow, parseHarPages } from "@htv/core";
import type { Flow } from "@htv/core";
import { firefoxHar } from "../../core/tests/helpers/firefox-har";

/** A Firefox HAR: no initiators, no priorities, no Server-Timing, and no trace. */
export function makeFirefoxFlow(): Flow {
  return generateFlow(
    expandPageFlows({ name: "Firefox", har: parseHarPages(firefoxHar() as never) })
  );
}
