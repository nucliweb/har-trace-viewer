import type { Messages } from "../i18n/en.js";

type Action = keyof Messages["help"]["actions"];

interface Shortcut {
  keys: string[];
  action: Action;
}

/** Every keyboard shortcut of the app, as the help lists them; the texts come from the messages. */
export const SHORTCUT_GROUPS: { title: keyof Messages["help"]["groups"]; shortcuts: Shortcut[] }[] =
  [
    {
      title: "general",
      shortcuts: [
        { keys: ["t"], action: "theme" },
        { keys: ["c"], action: "settings" },
        { keys: ["l"], action: "language" },
        { keys: ["?"], action: "help" },
        { keys: ["f"], action: "fullscreen" },
        { keys: ["Esc"], action: "close" },
      ],
    },
    {
      title: "panels",
      shortcuts: [
        { keys: ["1"], action: "findings" },
        { keys: ["2"], action: "waterfall" },
        { keys: ["3"], action: "hops" },
        { keys: ["4"], action: "metrics" },
        { keys: ["5"], action: "cache" },
        { keys: ["6"], action: "connections" },
        { keys: ["7"], action: "compression" },
        { keys: ["8"], action: "render" },
        { keys: ["9"], action: "criticalPath" },
        { keys: ["/"], action: "filter" },
      ],
    },
    {
      title: "steps",
      shortcuts: [
        { keys: ["→"], action: "next" },
        { keys: ["←"], action: "prev" },
        { keys: ["Home"], action: "first" },
        { keys: ["End"], action: "last" },
        { keys: ["Space"], action: "play" },
      ],
    },
  ];
