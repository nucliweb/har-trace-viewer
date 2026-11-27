import { ensureFreshBundle } from "./helpers/fresh-bundle";

/** The CLI tests run the built bundle: build it when it is missing or older than its sources. */
export default function globalSetup() {
  ensureFreshBundle();
}
