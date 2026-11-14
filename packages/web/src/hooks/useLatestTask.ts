import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Runs async work whose outcome only the latest run may deliver: a newer run, `cancel` or
 * unmounting drops the outcome of the one before, so a slow result never overwrites newer state.
 */
export function useLatestTask() {
  const [running, setRunning] = useState(false);
  const latest = useRef(0);
  useEffect(
    () => () => {
      latest.current += 1;
    },
    []
  );

  const run = useCallback(
    <T>(
      task: () => Promise<T>,
      onDone: (result: T) => void,
      onError: (error: unknown) => void
    ): Promise<void> => {
      const id = ++latest.current;
      const isLatest = () => id === latest.current;
      setRunning(true);
      return Promise.resolve()
        .then(task)
        .then(
          (result) => isLatest() && onDone(result),
          (error: unknown) => isLatest() && onError(error)
        )
        .then(() => {
          if (isLatest()) setRunning(false);
        });
    },
    []
  );

  const cancel = useCallback(() => {
    latest.current += 1;
    setRunning(false);
  }, []);

  return { running, run, cancel };
}
