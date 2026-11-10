interface Shortcut {
  keys: string[];
  action: string;
}

/** Every keyboard shortcut of the app, as the help lists them. */
export const SHORTCUT_GROUPS: { title: string; shortcuts: Shortcut[] }[] = [
  {
    title: "General",
    shortcuts: [
      { keys: ["t"], action: "Toggle theme" },
      { keys: ["c"], action: "Settings" },
      { keys: ["?"], action: "Keyboard shortcuts and about" },
      { keys: ["f"], action: "Fullscreen" },
      { keys: ["Esc"], action: "Close the dialog" },
    ],
  },
  {
    title: "Steps",
    shortcuts: [
      { keys: ["→"], action: "Next step" },
      { keys: ["←"], action: "Previous step" },
      { keys: ["Home"], action: "First step" },
      { keys: ["End"], action: "Last step" },
      { keys: ["Space"], action: "Play or pause" },
    ],
  },
];
