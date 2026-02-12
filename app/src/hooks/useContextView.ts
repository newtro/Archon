import { useState, useCallback, useRef } from "react";
import type {
  ContextViewState,
  ContextWindowSnapshot,
  BriefingDiff,
  TokenUsageUpdate,
  ContextClassification,
  ContextViewEvent,
} from "../lib/types";

const INITIAL_STATE: ContextViewState = {
  latestSnapshot: null,
  snapshots: [],
  briefingDiffs: [],
  tokenUsageUpdates: [],
  classifications: [],
  contextState: null,
  cumulativeStats: {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCost: 0,
  },
  budgetWarning: "none",
};

/** Max entries to keep in history arrays to prevent unbounded growth */
const MAX_HISTORY = 200;

function computeBudgetWarning(percentFull: number): "none" | "yellow" | "red" {
  if (percentFull >= 90) return "red";
  if (percentFull >= 75) return "yellow";
  return "none";
}

export function useContextView() {
  const [contextViewState, setContextViewState] = useState<ContextViewState>(INITIAL_STATE);
  const stateRef = useRef(contextViewState);
  stateRef.current = contextViewState;

  const handleContextWindowSnapshot = useCallback((snapshot: ContextWindowSnapshot) => {
    setContextViewState((prev) => ({
      ...prev,
      latestSnapshot: snapshot,
      snapshots: [...prev.snapshots.slice(-(MAX_HISTORY - 1)), snapshot],
      budgetWarning: computeBudgetWarning(snapshot.percentFull),
    }));
  }, []);

  const handleBriefingDiff = useCallback((diff: BriefingDiff) => {
    setContextViewState((prev) => ({
      ...prev,
      briefingDiffs: [...prev.briefingDiffs.slice(-(MAX_HISTORY - 1)), diff],
    }));
  }, []);

  const handleTokenUsageUpdate = useCallback((update: TokenUsageUpdate) => {
    setContextViewState((prev) => ({
      ...prev,
      tokenUsageUpdates: [...prev.tokenUsageUpdates.slice(-(MAX_HISTORY - 1)), update],
      cumulativeStats: update.cumulativeSession,
    }));
  }, []);

  const handleClassification = useCallback((classification: ContextClassification) => {
    setContextViewState((prev) => ({
      ...prev,
      classifications: [...prev.classifications.slice(-(MAX_HISTORY - 1)), classification],
    }));
  }, []);

  const handleContextStateUpdate = useCallback((state: unknown) => {
    setContextViewState((prev) => ({
      ...prev,
      contextState: state,
    }));
  }, []);

  /** Dispatch a context view event from the WebSocket handler */
  const handleContextViewEvent = useCallback((event: ContextViewEvent) => {
    switch (event.type) {
      case "context_window_snapshot":
        handleContextWindowSnapshot(event);
        break;
      case "briefing_diff":
        handleBriefingDiff(event);
        break;
      case "token_usage_update":
        handleTokenUsageUpdate(event);
        break;
    }
  }, [handleContextWindowSnapshot, handleBriefingDiff, handleTokenUsageUpdate]);

  const resetContextView = useCallback(() => {
    setContextViewState(INITIAL_STATE);
  }, []);

  return {
    contextViewState,
    handleContextViewEvent,
    handleClassification,
    handleContextStateUpdate,
    resetContextView,
  };
}
