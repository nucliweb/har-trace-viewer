import { RESOURCE_QUERY_HELP } from "@htv/core";
import { BLANK, panel, seg, table, wrap } from "./lines.js";
import type { Line } from "./lines.js";

const KEYS: [string, string][] = [
  ["1-7, Tab, Shift+Tab", "switch tabs"],
  ["←/→", "walk the steps (Steps tab) or the pages of a multi-page flow"],
  ["p/P", "next and previous page"],
  [
    "↑/↓, PgUp/PgDn, Home/End, Space",
    "scroll, or move the cursor over the waterfall and the resources",
  ],
  ["Enter", "the details of the request under the cursor (Enter, Esc or q goes back)"],
  ["n/N", "the next and previous request, in the details"],
  ["a/b", "the side of a comparison shown"],
  ["/", "filter the waterfall and the resources (Enter keeps it, Esc clears it)"],
  ["f", "cycle the party: first, third, all"],
  ["z", "zoom the waterfall's axis on the page load and back"],
  ["s/S", "the column the resources sort by, and its direction"],
  ["e", "all the evidence of the findings, or the first three rows of each"],
  ["< >", "scroll the columns of a table wider than the terminal (Hosts tab)"],
  ["?", "this help (scrolls like a list; ?, q or Esc closes it)"],
  ["q, Ctrl+C", "quit; q closes the help and the details first"],
];

/** The keys of the terminal report and the syntax of the request filter, one panel each. */
export function helpRegion(width: number): Line[] {
  const inner = width - 4;
  return [
    ...panel(
      "Keys",
      table(
        ["Key", "Action"],
        KEYS.map(([key, action]) => [seg(key, { bold: true }), action])
      ),
      width
    ),
    ...panel(
      "Filter syntax",
      [
        ...wrap(
          "Terms separated by spaces, all of which a request must match. A bare word matches the URL, field:value narrows by a field, a leading - keeps what does not match, and double quotes keep spaces in a value. An unknown field reads as URL text.",
          inner
        ),
        BLANK,
        ...table(
          ["Field", "Values", "Example"],
          RESOURCE_QUERY_HELP.map((h) => [seg(h.field, { bold: true }), h.values, h.example])
        ),
        BLANK,
        ...wrap("Example: domain:*.cdn.com type:js -is:cached larger-than:50k", inner),
      ],
      width
    ),
  ];
}
