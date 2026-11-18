import { useCallback, useEffect, useState } from "react";

/** How long each step of a request's sequence stays on its own while it plays. */
export const SEQUENCE_STEP_MS = 900;

export interface SequencePlayback {
  /** The index of the step just revealed, the ones after it still to come; null shows them all. */
  current: number | null;
  isPlaying: boolean;
  togglePlay: () => void;
  step: () => void;
  reset: () => void;
}

/**
 * Plays the steps of a request one after another, or one at a time by hand, the way a protocol
 * explainer reveals its messages. It starts with the whole sequence, so nothing hides until
 * asked; the last step stays marked until the whole sequence is asked back, and a play or a step
 * from there starts over from the first step.
 */
export function useSequencePlayback(total: number): SequencePlayback {
  const [current, setCurrent] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const last = total - 1;

  const step = useCallback(() => {
    setIsPlaying(false);
    setCurrent((i) => (i === null || i >= last ? 0 : i + 1));
  }, [last]);

  const togglePlay = useCallback(() => {
    if (isPlaying) return setIsPlaying(false);
    if (current === null || current >= last) setCurrent(0);
    // A single step has nothing to play after it.
    setIsPlaying(last > 0);
  }, [isPlaying, current, last]);

  const reset = useCallback(() => {
    setIsPlaying(false);
    setCurrent(null);
  }, []);

  useEffect(() => {
    if (!isPlaying || current === null) return;
    const timer = setTimeout(() => {
      setCurrent(current + 1);
      if (current + 1 >= last) setIsPlaying(false);
    }, SEQUENCE_STEP_MS);
    return () => clearTimeout(timer);
  }, [isPlaying, current, last]);

  return { current, isPlaying, togglePlay, step, reset };
}
