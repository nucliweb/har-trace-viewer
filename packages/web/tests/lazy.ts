import { preloadAll } from "../src/components/lazy.js";

/**
 * Loads what the app imports on demand, for a `beforeAll` of the tests that use it: the views,
 * their drawers and dialogs, and the parser that reads a dropped file on the main thread when no
 * worker can (as in jsdom). A test that clicks before such a module has arrived races its import,
 * which takes seconds on a busy machine; for a component React also holds the content back for at
 * least 300 ms after the Suspense fallback. That outlasts the 1 s a `findBy*` query waits, and a
 * `getBy*` right after the click only passes when an earlier test of the file happened to load the
 * module, so the result depends on the load of the machine and on the order of the tests. A test
 * that times out then keeps clicking in the next test's DOM, which fails that one too.
 */
export function loadOnDemandModules(): Promise<unknown> {
  return Promise.all([preloadAll(), import("../src/lib/main-thread-work.js")]);
}
