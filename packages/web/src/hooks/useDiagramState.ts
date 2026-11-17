import { useCallback, useEffect, useRef, useState } from "react";
import type { Flow } from "@htv/core";
import { parseViewState, setHashParams } from "../lib/view-state.js";

export type Speed = 400 | 800 | 1400 | 2000;

/** Position and playback over a sequence of `total` steps. */
export interface StepNavigation {
  total: number;
  stepIndex: number;
  isPlaying: boolean;
  speed: Speed;
  goTo: (index: number) => void;
  next: () => void;
  prev: () => void;
  togglePlay: () => void;
  setSpeed: (speed: Speed) => void;
}

export interface DiagramState extends StepNavigation {
  flow: Flow;
}

export function useDiagramState(flow: Flow): DiagramState {
  return { ...useStepNavigation(flow.steps.length), flow };
}

export function useStepNavigation(totalSteps: number): StepNavigation {
  // A link opens on its step (1-based; one past the end lands on the last), playback never.
  const [stepIndex, setStepIndex] = useState(() =>
    Math.min((parseViewState(window.location.hash).step ?? 1) - 1, totalSteps - 1)
  );
  // The link follows the step: the first step is the default and stays out of it.
  useEffect(() => setHashParams({ p: stepIndex > 0 ? String(stepIndex + 1) : null }), [stepIndex]);
  useEffect(() => () => setHashParams({ p: null }), []);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1400);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const goTo = useCallback(
    (index: number) => {
      setStepIndex(Math.max(0, Math.min(index, totalSteps - 1)));
    },
    [totalSteps]
  );

  const next = useCallback(() => {
    setStepIndex((i) => {
      if (i >= totalSteps - 1) {
        setIsPlaying(false);
        return i;
      }
      return i + 1;
    });
  }, [totalSteps]);

  const prev = useCallback(() => {
    setIsPlaying(false);
    setStepIndex((i) => Math.max(0, i - 1));
  }, []);

  const togglePlay = useCallback(() => {
    setIsPlaying((p) => {
      if (!p && stepIndex >= totalSteps - 1) {
        setStepIndex(0);
      }
      return !p;
    });
  }, [stepIndex, totalSteps]);

  useEffect(() => {
    if (!isPlaying) {
      clearTimer();
      return;
    }
    timerRef.current = setTimeout(() => {
      next();
    }, speed);
    return clearTimer;
  }, [isPlaying, stepIndex, speed, next, clearTimer]);

  return {
    total: totalSteps,
    stepIndex,
    isPlaying,
    speed,
    goTo,
    next,
    prev,
    togglePlay,
    setSpeed,
  };
}
