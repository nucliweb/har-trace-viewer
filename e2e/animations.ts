import type { Page } from "@playwright/test";

// Resolves once no CSS animation or transition is still running. A drawer sliding in fades from
// transparent, and a hovered button eases its colours, so axe's colour-contrast rule would measure
// them half-way. Wait for the element that starts them first: this sees only those already begun.
export async function animationsSettled(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState === "finished")
  );
}
