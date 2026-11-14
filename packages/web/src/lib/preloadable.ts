import { lazy } from "react";
import type { ComponentType, LazyExoticComponent } from "react";

export type Preloadable<P extends object> = LazyExoticComponent<ComponentType<P>> & {
  /** Loads the component's module ahead of its first render; resolves once it is ready. */
  preload: () => Promise<void>;
};

/**
 * A component loaded on demand, like React.lazy, that renders at once when it was preloaded.
 * React.lazy suspends on its first render even when the module is already there (a promise only
 * settles on a later tick), which commits the Suspense fallback and holds the content back for
 * React's 300 ms reveal throttle. Once loaded, this hands React.lazy a thenable that settles
 * synchronously instead, so the component renders in the same pass.
 */
export function preloadable<P extends object>(
  load: () => Promise<ComponentType<P>>
): Preloadable<P> {
  let loaded: { default: ComponentType<P> } | undefined;
  let loading: Promise<void> | undefined;
  const preload = () =>
    (loading ??= load().then(
      (component) => {
        loaded = { default: component };
      },
      (error: unknown) => {
        loading = undefined;
        throw error;
      }
    ));
  const component = lazy(() => {
    const ready = loaded;
    if (ready) {
      const settled = { then: (resolve: (module: typeof ready) => void) => resolve(ready) };
      return settled as unknown as Promise<typeof ready>;
    }
    return preload().then(() => loaded!);
  });
  return Object.assign(component, { preload });
}

/** Preloads the components once the browser is idle; returns a function that cancels it. */
export function preloadWhenIdle(components: readonly { preload: () => Promise<void> }[]) {
  const run = () => {
    // A failed load is left to the render that needs the component, which reports it.
    for (const component of components) component.preload().catch(() => undefined);
  };
  if (typeof requestIdleCallback === "function") {
    const handle = requestIdleCallback(run);
    return () => cancelIdleCallback(handle);
  }
  const timer = setTimeout(run, 1);
  return () => clearTimeout(timer);
}
