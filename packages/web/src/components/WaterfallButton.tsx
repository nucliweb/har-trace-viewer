import { useMessages } from "../i18n/context.js";

/** The toolbar button that opens the waterfall. */
export function WaterfallButton({
  active,
  drawer,
  onClick,
  className,
  activeClassName,
}: {
  active: boolean;
  /** Marks the button as the toggle of this drawer, which hands the focus back to it on close. */
  drawer?: string;
  onClick: () => void;
  className: string;
  activeClassName: string;
}) {
  const t = useMessages().waterfall;
  return (
    <button
      className={`${className} ${active ? activeClassName : ""}`}
      onClick={onClick}
      data-drawer={drawer}
      aria-label={t.toggle}
      aria-expanded={active}
      title={t.buttonTitle}
    >
      {t.title}
    </button>
  );
}
