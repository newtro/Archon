import { useState, useCallback, useRef, useEffect, useLayoutEffect } from "react";
import { FileText } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { ChatPanel } from "./components/chat/ChatPanel";
import { GitPanel } from "./components/git/GitPanel";
import { DiffViewer } from "./components/git/DiffViewer";
import { Sidebar, type SidebarView } from "./components/layout/Sidebar";
import { StatusBar } from "./components/layout/StatusBar";
import { TitleBar } from "./components/layout/TitleBar";
import { SettingsPanel } from "./components/settings/SettingsPanel";
import { FileTreePanel } from "./components/files/FileTreePanel";
import { CodeViewer } from "./components/files/CodeViewer";
import { FlowDesigner } from "./components/flow/FlowDesigner";
import { FlowExecutionPanel } from "./components/flow/FlowExecutionPanel";
import { LogStreamPanel } from "./components/logs/LogStreamPanel";
import { FlowRegistryPanel } from "./components/registry/FlowRegistryPanel";
import { PublishFlowModal } from "./components/registry/PublishFlowModal";
import { StartupPage } from "./components/startup/StartupPage";
import { HumanReviewModal, type HumanReviewRequest } from "./components/flow/HumanReviewModal";
import { useWebSocket } from "./hooks/useWebSocket";
import { useFlowExecution } from "./hooks/useFlowExecution";
import { useContextView } from "./hooks/useContextView";
import { useSidecarHealth } from "./hooks/useSidecarHealth";
import { useWorkspace } from "./contexts/WorkspaceContext";
import { getSetting, setSetting } from "./lib/store";
import { listFlows, loadFlow } from "./lib/flow-storage";
import { createSession, saveMessage, loadSessionMessages, deleteSession as deleteSessionDb } from "./lib/chat-storage";
import type { FlowDefinition } from "./lib/flow-types";
import type { ChatMessage, WSMessageToSidecar, WSMessageFromSidecar, GitStatusData, FlowSummary, FlowExecutionEvent, RecentProject, ImageAttachment, LogEntry, LogEntryEvent, HistoryMessage } from "./lib/types";

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [activeView, setActiveView] = useState<SidebarView>("startup");
  const [openFile, setOpenFile] = useState<{ path: string; content: string } | null>(null);
  const [activeModel, setActiveModel] = useState<string>("sonnet");
  const [pendingReview, setPendingReview] = useState<HumanReviewRequest | null>(null);
  const [publishingFlow, setPublishingFlow] = useState<import("./lib/flow-types").FlowDefinition | null>(null);

  // Git message state — latest message from sidecar for the GitPanel
  const [lastGitMessage, setLastGitMessage] = useState<WSMessageFromSidecar | null>(null);
  const [gitStatus, setGitStatus] = useState<GitStatusData | null>(null);

  // Track diff content for the diff viewer
  const [gitDiff, setGitDiff] = useState<{ path: string; diff: string; staged: boolean } | null>(null);

  // Startup / recent projects
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [projectRoot, setProjectRoot] = useState<string | null>(null);
  const lastProjectRootRef = useRef<string | null>(null);

  // Chat session persistence
  const sessionIdRef = useRef<string | null>(null);
  const savedMessageIds = useRef<Set<string>>(new Set());

  // Flow selector state
  const [flows, setFlows] = useState<FlowSummary[]>([]);
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);
  const [previewFlow, setPreviewFlow] = useState<FlowDefinition | null>(null);
  const flowChatMessageRef = useRef<string | null>(null);

  /** Refresh the flow list from the database */
  const refreshFlows = useCallback(() => {
    listFlows()
      .then((list) => setFlows(list.map((f) => ({ id: f.id, name: f.name }))))
      .catch(() => {});
  }, []);

  const { layout } = useWorkspace();

  // Load persisted model on mount
  useEffect(() => {
    getSetting<string>("model", "sonnet").then(setActiveModel);
  }, []);

  // Startup init: load recent projects and auto-restore last project
  useEffect(() => {
    async function init() {
      const recents = await getSetting<RecentProject[]>("recentProjects", []);
      setRecentProjects(recents);

      const lastRoot = await getSetting<string | null>("lastProjectRoot", null);
      if (lastRoot) {
        // Grant FS scope for the restored path — dialog-granted scope doesn't persist across restarts
        try {
          await invoke("allow_directory_scope", { path: lastRoot });
        } catch (e) {
          console.error("Failed to grant FS scope for restored project:", e);
        }
        lastProjectRootRef.current = lastRoot;
        setProjectRoot(lastRoot);
        setActiveView("chat");
      }
    }
    init();
  }, []);

  // Persist a project opening to the store
  const persistProjectOpen = useCallback(async (path: string) => {
    const name = path.split(/[/\\]/).pop() ?? path;
    await setSetting("lastProjectRoot", path);

    const recents = await getSetting<RecentProject[]>("recentProjects", []);
    const filtered = recents.filter((r) => r.path !== path);
    const updated = [{ path, name, lastOpened: Date.now() }, ...filtered].slice(0, 10);
    await setSetting("recentProjects", updated);
    setRecentProjects(updated);
  }, []);

  // Load flow list on mount and when switching to chat view
  useEffect(() => {
    if (activeView === "chat" || activeView === "flows") {
      refreshFlows();
    }
  }, [activeView, refreshFlows]);

  // Load full flow definition when a flow is selected (for diagram preview)
  useEffect(() => {
    if (selectedFlowId) {
      loadFlow(selectedFlowId).then((f) => setPreviewFlow(f)).catch(() => setPreviewFlow(null));
    } else {
      setPreviewFlow(null);
    }
  }, [selectedFlowId]);

  // Persist finalized messages to SQLite
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

  // Use a ref so useFlowExecution can call send() without circular dependency
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
          prev.map((m) =>
            m.id === flowMsgId
              ? { ...m, content: m.content + event.delta }
              : m
          )
        );
        break;

      case "node_tool_call":
        setMessages((prev) =>
          prev.map((m) =>
            m.id === flowMsgId
              ? { ...m, toolCalls: [...(m.toolCalls || []), event.toolCall] }
              : m
          )
        );
        break;

      case "node_tool_result":
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== flowMsgId) return m;
            return {
              ...m,
              toolCalls: (m.toolCalls || []).map((tc) =>
                tc.id === event.toolCallId
                  ? { ...tc, result: event.result, status: event.status, durationMs: event.durationMs }
                  : tc
              ),
            };
          })
        );
        break;

      case "flow_completed":
        setMessages((prev) =>
          prev.map((m) =>
            m.id === flowMsgId
              ? { ...m, content: event.result || m.content || "(Flow completed)", isStreaming: false }
              : m
          )
        );
        flowChatMessageRef.current = null;
        break;

      case "flow_error":
        setMessages((prev) =>
          prev.map((m) =>
            m.id === flowMsgId
              ? { ...m, content: `Flow error: ${event.error}`, isStreaming: false }
              : m
          )
        );
        flowChatMessageRef.current = null;
        break;
    }
  }, [handleFlowEvent]);

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
      // AI created/modified a flow — show preview and refresh flow list
      setPreviewFlow(flow);
      refreshFlows();
    },
    onGitMessage: (msg) => {
      setLastGitMessage(msg);
      // Extract git status for StatusBar
      if (msg.type === "git_status_response" || msg.type === "git_status_update") {
        setGitStatus(msg.data);
      }
      // Extract diff for diff viewer (file diff or commit diff)
      if (msg.type === "git_diff_response") {
        setGitDiff((prev) => prev ? { ...prev, diff: msg.data } : null);
      }
      if (msg.type === "git_show_response") {
        setGitDiff((prev) => prev ? { ...prev, diff: msg.data } : null);
      }
    },
    onConnect: (directSend) => {
      // Send persisted API key to sidecar immediately on WebSocket open
      getSetting<string>("apiKey", "").then((key) => {
        if (key) {
          directSend({ type: "set_api_key", key });
        }
      });
      // Send project root immediately on connect (don't wait for useEffect)
      if (lastProjectRootRef.current) {
        directSend({ type: "set_project_root", path: lastProjectRootRef.current });
      }
    },
  });

  // Sync project root to sidecar whenever it changes or connection is (re-)established.
  // This fixes the startup race where WebSocket connects before the store finishes loading.
  useEffect(() => {
    if (projectRoot && isConnected) {
      send({ type: "set_project_root", path: projectRoot });
    }
  }, [projectRoot, isConnected, send]);

  // Keep the ref in sync with the actual send function
  sendRef.current = send;

  // Sidecar health check
  const sidecarHealth = useSidecarHealth({
    isConnected,
    send: (msg) => send(msg as WSMessageToSidecar),
  });

  const handleSendMessage = useCallback(async (text: string, images?: ImageAttachment[]) => {
    // Create session lazily on first message
    if (!sessionIdRef.current) {
      try {
        sessionIdRef.current = await createSession(text);
      } catch { /* DB error -- continue without persistence */ }
    }

    // Build conversation history from existing messages (before adding the new one)
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

    // Log user message
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
      // Route through flow execution
      const flow = await loadFlow(selectedFlowId);
      if (flow) {
        const flowMsgId = crypto.randomUUID();
        flowChatMessageRef.current = flowMsgId;
        const assistantMsg: ChatMessage = {
          id: flowMsgId,
          role: "assistant",
          content: "",
          timestamp: Date.now(),
          isStreaming: true,
          model: `Flow: ${flow.name}`,
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
      // Direct chat — include history for fallback, sessionId for SDK resume
      send({
        type: "user_message",
        content: text,
        images,
        sessionId: sessionIdRef.current ?? undefined,
        history: history.length > 0 ? history : undefined,
      });
    }
  }, [selectedFlowId, send, runFlow, messages]);

  const handleApiKeyChange = useCallback(
    (key: string) => {
      send({ type: "set_api_key", key });
    },
    [send],
  );

  const handleModelChange = useCallback((model: string) => {
    setActiveModel(model);
  }, []);

  const handleFileSelect = useCallback((path: string, content: string) => {
    setOpenFile({ path, content });
  }, []);

  const handleProjectRootChange = useCallback((path: string) => {
    send({ type: "set_project_root", path });
    setProjectRoot(path);
    lastProjectRootRef.current = path;
    persistProjectOpen(path);
  }, [send, persistProjectOpen]);

  // Startup page: open folder via dialog
  const handleStartupOpenFolder = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false });
    if (selected) {
      const path = typeof selected === "string" ? selected : selected;
      send({ type: "set_project_root", path });
      setProjectRoot(path);
      lastProjectRootRef.current = path;
      persistProjectOpen(path);
      setActiveView("chat");
    }
  }, [send, persistProjectOpen]);

  // Startup page: open a recent project
  const handleOpenRecentProject = useCallback(async (path: string) => {
    // Grant FS scope — recent projects bypass the dialog so scope isn't auto-granted
    try {
      await invoke("allow_directory_scope", { path });
    } catch (e) {
      console.error("Failed to grant FS scope for recent project:", e);
    }
    send({ type: "set_project_root", path });
    setProjectRoot(path);
    lastProjectRootRef.current = path;
    persistProjectOpen(path);
    setActiveView("chat");
  }, [send, persistProjectOpen]);

  // Startup page: remove a project from recents
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

  const handleNewChat = useCallback(() => {
    setMessages([]);
    setLogEntries([]);
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

  // Shared ChatPanel props
  const chatPanelProps = {
    messages,
    onSendMessage: handleSendMessage,
    isConnected,
    flows,
    selectedFlowId,
    onFlowSelect: setSelectedFlowId,
    isFlowRunning,
    onNewChat: handleNewChat,
    sessionId: sessionIdRef.current,
    onLoadSession: handleLoadSession,
    onDeleteSession: handleDeleteSession,
  };

  // ── Draggable vertical splitter ──────────────────────────────
  const [rightPanelWidth, setRightPanelWidth] = useState(400);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  // Attach mousemove/mouseup on mount (not per-render) so dragging is smooth
  useLayoutEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !splitContainerRef.current) return;
      const rect = splitContainerRef.current.getBoundingClientRect();
      const newRight = rect.right - e.clientX;
      // Clamp: min 200px, max 70% of container
      const clamped = Math.max(200, Math.min(newRight, rect.width * 0.7));
      setRightPanelWidth(clamped);
    };
    const onMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  const handleSplitterMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  const renderChatWithExecPanel = () => {
    // Always use the same DOM structure so ChatPanel never remounts when
    // tabs change.  Remounting would reset streaming state and abort queries.
    return (
      <div className="workspace-split" ref={splitContainerRef}>
        <div className="workspace-split-left" style={{ flex: 1, width: 0, minWidth: 0 }}>
          <ChatPanel {...chatPanelProps} />
        </div>
        <div
          className="workspace-splitter"
          onMouseDown={handleSplitterMouseDown}
        />
        <div style={{ width: rightPanelWidth, flexShrink: 0, height: "100%", overflow: "hidden" }}>
          <FlowExecutionPanel
            execState={execState}
            onCancel={cancelFlow}
            onReset={resetFlow}
            logEntries={logEntries}
            onClearLogs={() => setLogEntries([])}
            previewFlow={previewFlow}
            contextViewState={contextViewState}
            onRequestRawContext={(executionId, nodeId) => send({ type: "get_context_raw", executionId, nodeId })}
            getRawMessages={getRawMessages}
          />
        </div>
      </div>
    );
  };

  const renderMainContent = () => {
    if (activeView === "startup") {
      return (
        <StartupPage
          recentProjects={recentProjects}
          onOpenFolder={handleStartupOpenFolder}
          onOpenRecent={handleOpenRecentProject}
          onRemoveRecent={handleRemoveRecentProject}
          onGoToSettings={() => setActiveView("settings")}
          onGoToFlows={() => setActiveView("flows")}
        />
      );
    }

    // Workspace presets only apply when viewing chat or flows
    if (activeView === "chat" || activeView === "flows") {
      if (layout.preset === "review") {
        return (
          <div className="workspace-split">
            <div
              className="workspace-split-left"
              style={{ width: `${layout.chatWidth}%` }}
            >
              <ChatPanel {...chatPanelProps} />
            </div>
            <div
              className="workspace-split-right"
              style={{ width: `${100 - layout.chatWidth}%` }}
            >
              <FlowDesigner
                execState={execState}
                onRunFlow={runFlow}
                onCancelFlow={cancelFlow}
                onResetFlow={resetFlow}
              />
            </div>
          </div>
        );
      }

      if (layout.preset === "chat" && activeView === "chat") {
        return renderChatWithExecPanel();
      }

      if (layout.preset === "flow" && activeView === "flows") {
        return (
          <FlowDesigner
            execState={execState}
            onRunFlow={runFlow}
            onCancelFlow={cancelFlow}
            onResetFlow={resetFlow}
          />
        );
      }
    }

    // Standard single-view switching
    switch (activeView) {
      case "chat":
        return renderChatWithExecPanel();

      case "files":
        return (
          <div className="files-layout">
            <div className="files-sidebar">
              <FileTreePanel
                onFileSelect={handleFileSelect}
                onProjectRootChange={handleProjectRootChange}
                initialRootPath={projectRoot}
                gitStatus={gitStatus}
                onGitStage={(files) => send({ type: "git_stage", files })}
                onGitUnstage={(files) => send({ type: "git_unstage", files })}
                onGitDiscard={(files) => send({ type: "git_discard", files })}
                onGitViewDiff={(path, staged) => {
                  setActiveView("git");
                  setGitDiff({ path, diff: "", staged });
                  send({ type: "git_diff", file: path, staged });
                }}
              />
            </div>
            <div className="files-main">
              {openFile ? (
                <CodeViewer filePath={openFile.path} content={openFile.content} />
              ) : (
                <div className="files-empty">
                  <FileText size={40} strokeWidth={1.5} style={{ opacity: 0.2 }} />
                  <p className="files-empty-text">Select a file to view</p>
                </div>
              )}
            </div>
          </div>
        );

      case "git":
        return (
          <div className="git-layout">
            <div className="git-sidebar">
              <GitPanel
                send={send}
                isConnected={isConnected}
                onGitMessage={lastGitMessage}
                onViewDiff={(path, staged) => {
                  setGitDiff({ path, diff: "", staged });
                  send({ type: "git_diff", file: path, staged });
                }}
                onViewCommitDiff={(hash, message) => {
                  setGitDiff({ path: `commit: ${hash.slice(0, 8)} — ${message}`, diff: "", staged: false });
                  send({ type: "git_show", hash });
                }}
              />
            </div>
            <div className="git-main">
              {gitDiff && gitDiff.diff ? (
                <DiffViewer filePath={gitDiff.path} diff={gitDiff.diff} />
              ) : (
                <div className="files-empty">
                  <FileText size={40} strokeWidth={1.5} style={{ opacity: 0.2 }} />
                  <p className="files-empty-text">Click a file to view diff</p>
                </div>
              )}
            </div>
          </div>
        );

      case "flows":
        return (
          <FlowDesigner
            execState={execState}
            onRunFlow={runFlow}
            onCancelFlow={cancelFlow}
            onResetFlow={resetFlow}
            onPublishFlow={setPublishingFlow}
          />
        );

      case "logs":
        return <LogStreamPanel logEntries={logEntries} onClear={() => setLogEntries([])} />;

      case "registry":
        return <FlowRegistryPanel />;

      case "settings":
        return <SettingsPanel onApiKeyChange={handleApiKeyChange} onModelChange={handleModelChange} />;
    }
  };

  return (
    <div className="app-layout">
      <TitleBar />
      <Sidebar activeView={activeView} onViewChange={setActiveView} />
      <main className="main-content">{renderMainContent()}</main>
      <StatusBar
        isConnected={isConnected}
        connectionStatus={connectionStatus}
        messages={messages}
        activeModel={activeModel}
        sidecarLatency={sidecarHealth.latencyMs}
        gitStatus={gitStatus}
      />
      {pendingReview && (
        <HumanReviewModal
          review={pendingReview}
          onApprove={(feedback) => {
            send({ type: "user_message", content: feedback ? `[APPROVED] ${feedback}` : "[APPROVED]" });
            setPendingReview(null);
          }}
          onReject={(feedback) => {
            send({ type: "user_message", content: `[REJECTED] ${feedback}` });
            setPendingReview(null);
          }}
        />
      )}
      {publishingFlow && (
        <PublishFlowModal
          flow={publishingFlow}
          onClose={() => setPublishingFlow(null)}
        />
      )}
    </div>
  );
}

export default App;
