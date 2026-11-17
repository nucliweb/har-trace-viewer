import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { HarTiming } from "@htv/core";
import { WaterfallPanel } from "../src/components/WaterfallPanel.js";
import { MessagesContext } from "../src/i18n/context.js";
import { es } from "../src/i18n/es.js";
import { makeEntry, makeHar } from "../../core/tests/helpers/synthetic-har";

const timing = (phases: Partial<HarTiming>): HarTiming => ({
  blocked: 0,
  dns: 0,
  connect: 0,
  ssl: 0,
  send: 0,
  wait: 0,
  receive: 0,
  ...phases,
});

// The first request to the CDN opens the connection; the second reuses it.
const first = makeEntry({
  url: "https://cdn.example.com/first.js",
  method: "GET",
  startTime: 20,
  httpVersion: "h2",
  connectionId: "7",
  contentEncoding: "br",
  transferSize: 4_000,
  timing: timing({ blocked: 2, dns: 10, connect: 50, ssl: 26, send: 1, wait: 40, receive: 7 }),
});
const second = makeEntry({
  url: "https://cdn.example.com/second.js",
  method: "GET",
  startTime: 120,
  httpVersion: "h2",
  connectionId: "7",
  timing: timing({ send: 0.2, wait: 30, receive: 2 }),
});
const quic = makeEntry({
  url: "https://h3.example.net/tag.js",
  method: "GET",
  startTime: 140,
  httpVersion: "h3",
  timing: timing({ connect: 30, ssl: 30, send: 1, wait: 20, receive: 4 }),
});
const cached = makeEntry({
  url: "https://example.com/logo.svg",
  startTime: 160,
  fromCache: "disk",
});
const moved = makeEntry({
  url: "https://example.com/old",
  startTime: 180,
  status: 301,
  redirectURL: "https://example.com/new",
  timing: timing({ wait: 5 }),
});
// Two requests on a connection the recording never saw open; the first is a 304.
const unchanged = makeEntry({
  url: "https://api.example.com/data.json",
  startTime: 200,
  status: 304,
  connectionId: "9",
  timing: timing({ send: 1, wait: 8, receive: 1 }),
});
const more = makeEntry({
  url: "https://api.example.com/more.json",
  startTime: 220,
  connectionId: "9",
});
const har = makeHar([first, second, quic, cached, moved, unchanged, more]);

const items = () => [...document.querySelectorAll<HTMLElement>("ol:first-of-type > li")];
const rowNamed = (name: string) =>
  items().find((item) => item.querySelector("[data-name]")?.textContent?.startsWith(name))!;

async function open(name: string, messages?: typeof es) {
  const panel = <WaterfallPanel har={har} pageLabel="Page 1" onClose={() => undefined} />;
  render(
    messages ? <MessagesContext.Provider value={messages}>{panel}</MessagesContext.Provider> : panel
  );
  await userEvent.setup().click(within(rowNamed(name)).getAllByRole("button")[0]);
}

const sequence = (name = /^Sequence/) => screen.getByRole("group", { name });
const steps = (group: HTMLElement) =>
  within(within(group).getByRole("list"))
    .getAllByRole("listitem")
    .map((li) => li.textContent);

describe("RequestDetail: the sequence of a request", () => {
  it("tells each step of a new connection, with its start, its time and what happens", async () => {
    await open("first.js");
    const group = sequence(/^Sequence · h2$/);

    expect(within(group).getByText("Browser")).toBeInTheDocument();
    expect(within(group).getByText("DNS resolver")).toBeInTheDocument();
    expect(within(group).getByText("cdn.example.com")).toBeInTheDocument();
    expect(steps(group)).toEqual([
      expect.stringMatching(/^0 ms.*Queued.*2 ms.*Waits in the browser/),
      expect.stringMatching(/^2 ms.*DNS lookup.*10 ms.*cdn\.example\.com/),
      expect.stringMatching(/^12 ms.*TCP handshake.*24 ms.*SYN, SYN-ACK, ACK/),
      expect.stringMatching(/^36 ms.*TLS handshake.*26 ms.*certificate/),
      expect.stringMatching(/^62 ms.*GET \/first\.js.*1 ms/),
      expect.stringMatching(/^63 ms.*Server works.*40 ms.*about 24 ms are the round trip/),
      expect.stringMatching(/^103 ms.*200 · 4\.0 KB · br.*7 ms/),
    ]);
    expect(group).toHaveTextContent("Opens a new connection; 1 more request reuses it.");
    expect(group).toHaveTextContent("About 24 ms per round trip to cdn.example.com.");
  });

  it("says which request opened a reused connection, and leaves out the resolver", async () => {
    await open("second.js");
    const group = sequence();

    expect(group).toHaveTextContent(
      "Reuses the connection first.js opened: no DNS lookup or handshakes."
    );
    expect(within(group).queryByText("DNS resolver")).not.toBeInTheDocument();
    expect(steps(group)).toHaveLength(3);
    // Sent in a fifth of a millisecond: less than one, not nothing.
    expect(steps(group)[0]).toMatch(/GET \/second\.js <1 ms/);
    expect(steps(group)[1]).toMatch(/about 24 ms are the round trip and 6 ms the server/);
  });

  it("draws one QUIC handshake over HTTP/3", async () => {
    await open("tag.js");
    expect(steps(sequence(/· h3$/))[0]).toMatch(/QUIC handshake.*30 ms.*one round trip/);
  });

  it("says a browser-cache hit never reached the network, with no steps", async () => {
    await open("logo.svg");
    const group = sequence();

    expect(group).toHaveTextContent("Served from the browser cache: it never reached the network.");
    expect(within(group).queryByRole("list")).not.toBeInTheDocument();
  });

  it("says where a redirect points", async () => {
    await open("old");
    expect(sequence()).toHaveTextContent(
      "The server answers with a redirect to https://example.com/new: the browser requests it next."
    );
  });

  it("says a 304 kept the browser's copy, on a connection open before the recording", async () => {
    await open("data.json");
    const group = sequence(/^Sequence$/);

    expect(group).toHaveTextContent("The server answers 304 Not Modified");
    expect(group).toHaveTextContent(
      "Reuses a connection opened before the recording started: no DNS lookup or handshakes. 2 requests share it."
    );
    expect(group).not.toHaveTextContent("per round trip");
    expect(steps(group)[1]).toMatch(/Time to first byte: the trip to the server and back/);
  });

  it("speaks Spanish", async () => {
    await open("first.js", es);
    const group = sequence(/^Secuencia · h2$/);

    expect(within(group).getByText("Navegador")).toBeInTheDocument();
    expect(steps(group)[1]).toMatch(/Consulta DNS/);
  });
});
