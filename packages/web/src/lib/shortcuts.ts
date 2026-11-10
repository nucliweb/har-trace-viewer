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
