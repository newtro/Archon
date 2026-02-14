/**
 * Global store for completed tool calls.
 *
 * This bypasses React's state pipeline entirely. The sidecar's WebSocket
 * handler writes to this store when a tool finishes, and ToolCallCard
 * reads from it on every render tick. This guarantees tool completion
 * is reflected in the UI even if setMessages-based updates are lost to
 * React batching or other state management issues.
 */

import type { ToolCallStatus } from "./types";

export interface CompletedToolInfo {
  result: string;
  status: ToolCallStatus;
  durationMs: number;
}

const store = new Map<string, CompletedToolInfo>();

/** Record a tool as completed. Called from WebSocket message handler. */
export function markToolCompleted(toolCallId: string, info: CompletedToolInfo): void {
  store.set(toolCallId, info);
}

/** Check if a tool has been completed. Called from ToolCallCard on every render. */
export function getToolCompletion(toolCallId: string): CompletedToolInfo | undefined {
  return store.get(toolCallId);
}

/** Clear all completed tool data (call when starting a new session/flow). */
export function clearCompletedTools(): void {
  store.clear();
}
