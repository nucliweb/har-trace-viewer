import { firefoxEntry } from "./firefox-har";

/** Synthetic WebPageTest-shaped HAR: run 1 first view, run 1 repeat view and run 2 first view. */
export function wptHar() {
  const ids = ["page_1_0_1", "page_1_1_1", "page_2_0_1"];
  const titles = [
    "Run 1, First View for https://example.com/",
    "Run 1, Repeat View for https://example.com/",
    "Run 2, First View for https://example.com/",
  ];
  const sizes = [3, 2, 4];
  return {
    log: {
      pages: ids.map((id, i) => ({
        id,
        title: titles[i],
        startedDateTime: `2026-01-01T00:00:${String(i * 10).padStart(2, "0")}.000Z`,
        pageTimings: { onContentLoad: 100, onLoad: 200 },
      })),
      entries: ids.flatMap((id, i) => {
        const startedDateTime = `2026-01-01T00:00:${String(i * 10).padStart(2, "0")}.000Z`;
        return Array.from({ length: sizes[i] }, (_, n) =>
          n === 0
            ? firefoxEntry("https://example.com/", "text/html", { pageref: id, startedDateTime })
            : firefoxEntry(`https://example.com/a${n}.js`, "application/javascript", {
                pageref: id,
                startedDateTime,
              })
        );
      }),
    },
  };
}
