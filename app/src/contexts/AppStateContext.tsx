import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useWebSocket } from "../hooks/useWebSocket";
import { useFlowExecution, type FlowExecutionState } from "../hooks/useFlowExecution";
import { useContextView } from "../hooks/useContextView";
import { useSidecarHealth } from "../hooks/useSidecarHealth";
import { clearCompletedTools } from "../lib/tool-completion-store";
import { getSetting, setSetting } from "../lib/store";
import { listFlows, loadFlow } from "../lib/flow-storage";
import { createSession, saveMessage, loadSessionMessages, deleteSession as deleteSessionDb } from "../lib/chat-storage";
import type { FlowDefinition } from "../lib/flow-types";
import type { HumanReviewRequest } from "../components/flow/HumanReviewModal";
import type {
  ChatMessage,
  WSMessageToSidecar,
  WSMessageFromSidecar,
  GitStatusData,
  FlowSummary,
  FlowExecutionEvent,
  RecentProject,
  ImageAttachment,
  LogEntry,
  LogEntryEvent,
  HistoryMessage,
  ContextViewState,
} from "../lib/types";

// ── Context value type ──────────────────────────────────────

export interface AppState {
  // Chat
  messages: ChatMessage[];
  handleSendMessage: (text: string, images?: ImageAttachment[]) => void;
  handleCancel: () => void;
  handleNewChat: () => void;
  handleLoadSession: (id: string) => void;
  handleDeleteSession: (id: string) => void;
  sessionId: string | null;
  isStreaming: boolean;
  isFlowRunning: boolean;

  // Connection
  isConnected: boolean;
  connectionStatus: string;
  send: (msg: WSMessageToSidecar) => void;

  // Model
  activeModel: string;
  handleModelChange: (model: string) => void;

  // Flows
  flows: FlowSummary[];
  selectedFlowId: string | null;
  setSelectedFlowId: (id: string | null) => void;
  previewFlow: FlowDefinition | null;
  refreshFlows: () => void;

  // Flow execution
  execState: FlowExecutionState;
  runFlow: (flow: FlowDefinition, input: string, history?: HistoryMessage[], sessionId?: string) => void;
  cancelFlow: () => void;
  resetFlow: () => void;

  // Context view
  contextViewState: ContextViewState;
  getRawMessages: (executionId: string, nodeId: string) => unknown[] | null;

  // Files
  openFile: { path: string; content: string } | null;
  handleFileSelect: (path: string, content: string) => void;

  // Project
  projectRoot: string | null;
  handleProjectRootChange: (path: string) => void;
  handleStartupOpenFolder: () => void;
  handleOpenRecentProject: (path: string) => void;
  handleRemoveRecentProject: (path: string) => void;
  recentProjects: RecentProject[];

  // Git
  gitStatus: GitStatusData | null;
  gitDiff: { path: string; diff: string; staged: boolean } | null;
  setGitDiff: React.Dispatch<React.SetStateAction<{ path: string; diff: string; staged: boolean } | null>>;
  lastGitMessage: WSMessageFromSidecar | null;

  // Logs
  logEntries: LogEntry[];
  clearLogs: () => void;

  // Settings callbacks
  handleApiKeyChange: (key: string) => void;
  handleOpenRouterKeyChange: (key: string) => void;
  handleAdoSettingsChange: (orgUrl: string, pat: string, defaultProject?: string) => void;

  // Modals
  pendingReview: HumanReviewRequest | null;
  setPendingReview: React.Dispatch<React.SetStateAction<HumanReviewRequest | null>>;
  publishingFlow: FlowDefinition | null;
  setPublishingFlow: React.Dispatch<React.SetStateAction<FlowDefinition | null>>;

  // Sidecar health
  sidecarLatency: number | null;

  // Navigation helpers — set by DockArea after dockview is ready
  openPanel: (component: string, options?: { id?: string; title?: string; params?: Record<string, unknown> }) => void;
  setOpenPanelFn: (fn: AppState["openPanel"]) => void;
  applyLayoutPreset: (preset: "chat" | "flow" | "review") => void;
  setApplyLayoutPresetFn: (fn: AppState["applyLayoutPreset"]) => void;
}

const AppStateContext = createContext<AppState | null>(null);

export function useAppState(): AppState {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used within AppStateProvider");
  return ctx;
}

// ── Provider ────────────────────────────────────────────────

export function AppStateProvider({ children }: { children: ReactNode }) {
  // ── Core state ──
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [openFile, setOpenFile] = useState<{ path: string; content: string } | null>(null);
  const [activeModel, setActiveModel] = useState<string>("sonnet");
  const [pendingReview, setPendingReview] = useState<HumanReviewRequest | null>(null);
  const [publishingFlow, setPublishingFlow] = useState<FlowDefinition | null>(null);

  // Git
  const [lastGitMessage, setLastGitMessage] = useState<WSMessageFromSidecar | null>(null);
  const [gitStatus, setGitStatus] = useState<GitStatusData | null>(null);
  const [gitDiff, setGitDiff] = useState<{ path: string; diff: string; staged: boolean } | null>(null);

  // Startup / recent projects
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [projectRoot, setProjectRoot] = useState<string | null>(null);
  const lastProjectRootRef = useRef<string | null>(null);

  // Chat session persistence
  const sessionIdRef = useRef<string | null>(null);
  const savedMessageIds = useRef<Set<string>>(new Set());

  // Flow selector
  const [flows, setFlows] = useState<FlowSummary[]>([]);
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);
  const [previewFlow, setPreviewFlow] = useState<FlowDefinition | null>(null);
  const flowChatMessageRef = useRef<string | null>(null);

  // Navigation helpers — set by DockArea
  const openPanelRef = useRef<AppState["openPanel"]>(() => {});
  const applyLayoutPresetRef = useRef<AppState["applyLayoutPreset"]>(() => {});
  const [, forceRender] = useState(0);

  const setOpenPanelFn = useCallback((fn: AppState["openPanel"]) => {
    openPanelRef.current = fn;
    forceRender((n) => n + 1);
  }, []);

  const setApplyLayoutPresetFn = useCallback((fn: AppState["applyLayoutPreset"]) => {
    applyLayoutPresetRef.current = fn;
  }, []);

  // ── Refresh flows ──
  const refreshFlows = useCallback(() => {
    listFlows()
      .then((list) => setFlows(list.map((f) => ({ id: f.id, name: f.name }))))
      .catch(() => {});
  }, []);

  // Load persisted model on mount
  useEffect(() => {
    getSetting<string>("model", "sonnet").then(setActiveModel);
  }, []);

  // Startup init
  useEffect(() => {
    async function init() {
      const recents = await getSetting<RecentProject[]>("recentProjects", []);
      setRecentProjects(recents);

      const lastRoot = await getSetting<string | null>("lastProjectRoot", null);
      if (lastRoot) {
        try {
          await invoke("allow_directory_scope", { path: lastRoot });
        } catch (e) {
          console.error("Failed to grant FS scope for restored project:", e);
        }
        lastProjectRootRef.current = lastRoot;
        setProjectRoot(lastRoot);
      }
    }
    init();
  }, []);

  // Persist a project opening
  const persistProjectOpen = useCallback(async (path: string) => {
    const name = path.split(/[/\\]/).pop() ?? path;
    await setSetting("lastProjectRoot", path);
    const recents = await getSetting<RecentProject[]>("recentProjects", []);
    const filtered = recents.filter((r) => r.path !== path);
    const updated = [{ path, name, lastOpened: Date.now() }, ...filtered].slice(0, 10);
    await setSetting("recentProjects", updated);
    setRecentProjects(updated);
  }, []);

  // Load flow list periodically
  useEffect(() => {
    refreshFlows();
  }, [refreshFlows]);

  // Load full flow definition when selected
  useEffect(() => {
    if (selectedFlowId) {
      loadFlow(selectedFlowId).then((f) => setPreviewFlow(f)).catch(() => setPreviewFlow(null));
    } else {
      setPreviewFlow(null);
    }
  }, [selectedFlowId]);

  // Persist finalized messages
  useEffect(() => {
    if (!sessionIdRef.current) return;
    const sid = sessionIdRef.current;
    for (const msg of messages) {
      if (!msg.isStreaming && !savedMessageIds.current.has(msg.id)) {
        savedMessageIds.current.add(msg.id);
        saveMessage(sid, msg).catch(() => {});
      }
    }
  }, [messages]);

  // ── Flow execution hook ──
  const sendRef = useRef<(msg: WSMessageToSidecar) => void>(() => {});

  const { execState, runFlow, cancelFlow, resetFlow, handleFlowEvent } = useFlowExecution(
    (msg: WSMessageToSidecar) => sendRef.current(msg),
  );

  const { contextViewState, handleContextViewEvent, handleClassification, handleContextStateUpdate, handleContextRawResponse, getRawMessages } = useContextView();

  // Wrap handleFlowEvent to also map flow events into chat messages
  const handleFlowEventWithChat = useCallback((event: FlowExecutionEvent) => {
    handleFlowEvent(event);

    const flowMsgId = flowChatMessageRef.current;
    if (!flowMsgId) return;

    switch (event.type) {
      case "node_streaming":
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== flowMsgId) return m;
            const blocks = [...(m.contentBlocks || [])];
            const lastBlock = blocks[blocks.length - 1];
            if (lastBlock && lastBlock.type === "text") {
              blocks[blocks.length - 1] = { type: "text", text: lastBlock.text + event.delta };
            } else {
              blocks.push({ type: "text", text: event.delta });
            }
            return { ...m, content: m.content + event.delta, contentBlocks: blocks };
          })
        );
        break;

      case "node_tool_call":
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== flowMsgId) return m;
            const blocks = [...(m.contentBlocks || [])];
            blocks.push({ type: "tool_call", toolCallId: event.toolCall.id });
            return {
              ...m,
              toolCalls: [...(m.toolCalls || []), event.toolCall],
              contentBlocks: blocks,
            };
          })
        );
        break;

      case "node_tool_args_update":
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== flowMsgId) return m;
            return {
              ...m,
              toolCalls: (m.toolCalls || []).map((tc) =>
                tc.id === event.toolCallId ? { ...tc, args: event.args } : tc
              ),
            };
          })
        );
        break;

      case "node_tool_result":
        console.log(`[flow-ui] node_tool_result: toolCallId=${event.toolCallId}, status=${event.status}, durationMs=${event.durationMs}, flowMsgId=${flowMsgId}`);
        setMessages((prev) => {
          const msg = prev.find((m) => m.id === flowMsgId);
          const matchedTc = msg?.toolCalls?.find((tc) => tc.id === event.toolCallId);
          console.log(`[flow-ui] message found: ${!!msg}, tool found: ${!!matchedTc}, toolIds: ${msg?.toolCalls?.map((tc) => tc.id).join(", ")}`);
          return prev.map((m) => {
            if (m.id !== flowMsgId) return m;
            return {
              ...m,
              toolCalls: (m.toolCalls || []).map((tc) =>
                tc.id === event.toolCallId
                  ? { ...tc, result: event.result, status: event.status, durationMs: event.durationMs }
                  : tc
              ),
            };
          });
        });
        break;

      case "flow_completed":
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== flowMsgId) return m;
            const toolCalls = (m.toolCalls || []).map((tc) =>
              tc.status === "loading"
                ? { ...tc, status: "success" as const, durationMs: tc.durationMs ?? Date.now() - tc.startedAt }
                : tc
            );
            const finalContent = event.result || m.content || "(Flow completed)";
            let blocks = m.contentBlocks;
            if (blocks && event.result && event.result !== m.content) {
              blocks = [...blocks];
              const lastBlock = blocks[blocks.length - 1];
              if (lastBlock && lastBlock.type === "text") {
                // Keep existing
              } else {
                blocks.push({ type: "text", text: event.result });
              }
            }
            return { ...m, content: finalContent, isStreaming: false, toolCalls, contentBlocks: blocks };
          })
        );
        flowChatMessageRef.current = null;
        break;

      case "flow_error":
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== flowMsgId) return m;
            const toolCalls = (m.toolCalls || []).map((tc) =>
              tc.status === "loading"
                ? { ...tc, status: "error" as const, durationMs: tc.durationMs ?? Date.now() - tc.startedAt }
                : tc
            );
            return { ...m, content: `Flow error: ${event.error}`, isStreaming: false, toolCalls };
          })
        );
        flowChatMessageRef.current = null;
        break;

      case "human_review_requested":
        setPendingReview({
          nodeId: event.nodeId,
          nodeLabel: event.nodeLabel,
          executionId: event.executionId,
          prompt: event.prompt,
          context: event.content,
          contentType: event.contentType,
        });
        break;
    }
  }, [handleFlowEvent]);

  // ── Log entry handler ──
  const handleLogEntry = useCallback((entryOrUpdate: LogEntryEvent) => {
    if ("update" in entryOrUpdate && entryOrUpdate.update) {
      const { correlationId, patch } = entryOrUpdate;
      setLogEntries((prev) => {
        const idx = prev.findIndex((e) => e.correlationId === correlationId);
        if (idx === -1) return prev;
        const updated = [...prev];
        updated[idx] = { ...updated[idx], ...patch };
        return updated;
      });
    } else {
      setLogEntries((prev) => [...prev, entryOrUpdate as LogEntry]);
    }
  }, []);

  // ── WebSocket ──
  const { send, connectionStatus } = useWebSocket({
    onMessage: (msg) => {
      setMessages((prev) => [...prev, msg]);
    },
    onStatusChange: setIsConnected,
    onFlowEvent: handleFlowEventWithChat,
    onLogEntry: handleLogEntry,
    onContextViewEvent: handleContextViewEvent,
    onContextClassification: handleClassification,
    onContextStateUpdate: handleContextStateUpdate,
    onContextRawResponse: handleContextRawResponse,
    onFlowPreview: (flow) => {
      setPreviewFlow(flow);
      refreshFlows();
    },
    onGitMessage: (msg) => {
      setLastGitMessage(msg);
      if (msg.type === "git_status_response" || msg.type === "git_status_update") {
        setGitStatus(msg.data);
      }
      if (msg.type === "git_diff_response") {
        setGitDiff((prev) => prev ? { ...prev, diff: msg.data } : null);
      }
      if (msg.type === "git_show_response") {
        setGitDiff((prev) => prev ? { ...prev, diff: msg.data } : null);
      }
    },
    onConnect: (directSend) => {
      getSetting<string>("apiKey", "").then((key) => {
        if (key) directSend({ type: "set_api_key", key });
      });
      getSetting<string>("openrouterApiKey", "").then((key) => {
        if (key) directSend({ type: "set_openrouter_key", key });
      });
      Promise.all([
        getSetting<string>("adoOrgUrl", ""),
        getSetting<string>("adoPat", ""),
        getSetting<string>("adoDefaultProject", ""),
      ]).then(([orgUrl, pat, defaultProject]) => {
        if (orgUrl && pat) {
          directSend({ type: "set_ado_settings", orgUrl, pat, defaultProject: defaultProject || undefined });
        }
      });
      if (lastProjectRootRef.current) {
        directSend({ type: "set_project_root", path: lastProjectRootRef.current });
      }
    },
  });

  // Sync project root
  useEffect(() => {
    if (projectRoot && isConnected) {
      send({ type: "set_project_root", path: projectRoot });
    }
  }, [projectRoot, isConnected, send]);

  sendRef.current = send;

  // Sidecar health
  const sidecarHealth = useSidecarHealth({
    isConnected,
    send: (msg) => send(msg as WSMessageToSidecar),
  });

  // ── Handlers ──

  const handleSendMessage = useCallback(async (text: string, images?: ImageAttachment[]) => {
    if (!sessionIdRef.current) {
      try {
        sessionIdRef.current = await createSession(text);
      } catch { /* DB error */ }
    }

    const history: HistoryMessage[] = messages
      .filter((m) => (m.role === "user" || m.role === "assistant") && m.content && !m.isStreaming)
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      timestamp: Date.now(),
      images,
    };
    setMessages((prev) => [...prev, userMessage]);

    handleLogEntry({
      id: `log-user-${userMessage.id}`,
      timestamp: userMessage.timestamp,
      level: "info",
      source: "user",
      message: `User: ${text.slice(0, 120)}${text.length > 120 ? "..." : ""}`,
      detail: text.length > 120 ? text : undefined,
      status: "complete",
    });

    if (selectedFlowId) {
      const flow = await loadFlow(selectedFlowId);
      if (flow) {
        clearCompletedTools();
        const flowMsgId = crypto.randomUUID();
        flowChatMessageRef.current = flowMsgId;
        const assistantMsg: ChatMessage = {
          id: flowMsgId,
          role: "assistant",
          content: "",
          timestamp: Date.now(),
          isStreaming: true,
          model: `Flow: ${flow.name}`,
          contentBlocks: [],
        };
        setMessages((prev) => [...prev, assistantMsg]);
        runFlow(flow, text, history, sessionIdRef.current ?? undefined);
      } else {
        setMessages((prev) => [...prev, {
          id: crypto.randomUUID(),
          role: "system" as const,
          content: "Flow not found. It may have been deleted.",
          timestamp: Date.now(),
        }]);
        setSelectedFlowId(null);
      }
    } else {
      clearCompletedTools();
      send({
        type: "user_message",
        content: text,
        images,
        sessionId: sessionIdRef.current ?? undefined,
        history: history.length > 0 ? history : undefined,
      });
    }
  }, [selectedFlowId, send, runFlow, messages, handleLogEntry]);

  const handleApiKeyChange = useCallback((key: string) => {
    send({ type: "set_api_key", key });
  }, [send]);

  const handleOpenRouterKeyChange = useCallback((key: string) => {
    send({ type: "set_openrouter_key", key });
  }, [send]);

  const handleModelChange = useCallback((model: string) => {
    setActiveModel(model);
  }, []);

  const handleAdoSettingsChange = useCallback((orgUrl: string, pat: string, defaultProject?: string) => {
    send({ type: "set_ado_settings", orgUrl, pat, defaultProject });
  }, [send]);

  const handleFileSelect = useCallback((path: string, content: string) => {
    setOpenFile({ path, content });
  }, []);

  const handleProjectRootChange = useCallback((path: string) => {
    send({ type: "set_project_root", path });
    setProjectRoot(path);
    lastProjectRootRef.current = path;
    persistProjectOpen(path);
  }, [send, persistProjectOpen]);

  const handleStartupOpenFolder = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false });
    if (selected) {
      const path = typeof selected === "string" ? selected : selected;
      send({ type: "set_project_root", path });
      setProjectRoot(path);
      lastProjectRootRef.current = path;
      persistProjectOpen(path);
      // Open chat panel after opening a project
      applyLayoutPresetRef.current("chat");
    }
  }, [send, persistProjectOpen]);

  const handleOpenRecentProject = useCallback(async (path: string) => {
    try {
      await invoke("allow_directory_scope", { path });
    } catch (e) {
      console.error("Failed to grant FS scope for recent project:", e);
    }
    send({ type: "set_project_root", path });
    setProjectRoot(path);
    lastProjectRootRef.current = path;
    persistProjectOpen(path);
    applyLayoutPresetRef.current("chat");
  }, [send, persistProjectOpen]);

  const handleRemoveRecentProject = useCallback(async (path: string) => {
    const recents = await getSetting<RecentProject[]>("recentProjects", []);
    const updated = recents.filter((r) => r.path !== path);
    await setSetting("recentProjects", updated);
    setRecentProjects(updated);
    const lastRoot = await getSetting<string | null>("lastProjectRoot", null);
    if (lastRoot === path) {
      const newLast = updated.length > 0 ? updated[0].path : null;
      await setSetting("lastProjectRoot", newLast);
    }
  }, []);

  const isFlowRunning = execState.status === "running" && flowChatMessageRef.current !== null;
  const isStreaming = messages.some((m) => m.isStreaming);

  const handleCancel = useCallback(() => {
    if (isFlowRunning) {
      cancelFlow();
    } else {
      send({ type: "cancel" });
    }
    setMessages((prev) =>
      prev.map((m) =>
        m.isStreaming
          ? {
              ...m,
              isStreaming: false,
              toolCalls: (m.toolCalls || []).map((tc) =>
                tc.status === "loading"
                  ? { ...tc, status: "error" as const, durationMs: tc.durationMs ?? Date.now() - tc.startedAt }
                  : tc
              ),
            }
          : m
      )
    );
  }, [isFlowRunning, cancelFlow, send]);

  const handleNewChat = useCallback(() => {
    setMessages([]);
    setLogEntries([]);
    clearCompletedTools();
    sessionIdRef.current = null;
    savedMessageIds.current = new Set();
    flowChatMessageRef.current = null;
  }, []);

  const handleLoadSession = useCallback(async (id: string) => {
    try {
      const msgs = await loadSessionMessages(id);
      setMessages(msgs);
      sessionIdRef.current = id;
      savedMessageIds.current = new Set(msgs.map((m) => m.id));
      flowChatMessageRef.current = null;
    } catch { /* DB error */ }
  }, []);

  const handleDeleteSession = useCallback(async (id: string) => {
    try {
      await deleteSessionDb(id);
      if (sessionIdRef.current === id) {
        setMessages([]);
        sessionIdRef.current = null;
        savedMessageIds.current = new Set();
      }
    } catch { /* DB error */ }
  }, []);

  const clearLogs = useCallback(() => setLogEntries([]), []);

  // ── Context value ──
  const value: AppState = {
    messages,
    handleSendMessage,
    handleCancel,
    handleNewChat,
    handleLoadSession,
    handleDeleteSession,
    sessionId: sessionIdRef.current,
    isStreaming,
    isFlowRunning,

    isConnected,
    connectionStatus,
    send,

    activeModel,
    handleModelChange,

    flows,
    selectedFlowId,
    setSelectedFlowId,
    previewFlow,
    refreshFlows,

    execState,
    runFlow,
    cancelFlow,
    resetFlow,

    contextViewState,
    getRawMessages,

    openFile,
    handleFileSelect,

    projectRoot,
    handleProjectRootChange,
    handleStartupOpenFolder,
    handleOpenRecentProject,
    handleRemoveRecentProject,
    recentProjects,

    gitStatus,
    gitDiff,
    setGitDiff,
    lastGitMessage,

    logEntries,
    clearLogs,

    handleApiKeyChange,
    handleOpenRouterKeyChange,
    handleAdoSettingsChange,

    pendingReview,
    setPendingReview,
    publishingFlow,
    setPublishingFlow,

    sidecarLatency: sidecarHealth.latencyMs,

    openPanel: openPanelRef.current,
    setOpenPanelFn,
    applyLayoutPreset: applyLayoutPresetRef.current,
    setApplyLayoutPresetFn,
  };

  return (
    <AppStateContext.Provider value={value}>
      {children}
    </AppStateContext.Provider>
  );
}
