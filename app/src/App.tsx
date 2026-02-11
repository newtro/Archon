import { useState, useCallback, useRef, useEffect } from "react";
import { FileText } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { ChatPanel } from "./components/chat/ChatPanel";
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
import { StartupPage } from "./components/startup/StartupPage";
import { HumanReviewModal, type HumanReviewRequest } from "./components/flow/HumanReviewModal";
import { useWebSocket } from "./hooks/useWebSocket";
import { useFlowExecution } from "./hooks/useFlowExecution";
import { useSidecarHealth } from "./hooks/useSidecarHealth";
import { useWorkspace } from "./contexts/WorkspaceContext";
import { getSetting, setSetting } from "./lib/store";
import { listFlows, loadFlow } from "./lib/flow-storage";
import { createSession, saveMessage, loadSessionMessages, deleteSession as deleteSessionDb } from "./lib/chat-storage";
import type { ChatMessage, WSMessageToSidecar, FlowSummary, FlowExecutionEvent, RecentProject } from "./lib/types";

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [activeView, setActiveView] = useState<SidebarView>("startup");
  const [openFile, setOpenFile] = useState<{ path: string; content: string } | null>(null);
  const [activeModel, setActiveModel] = useState<string>("sonnet");
  const [pendingReview, setPendingReview] = useState<HumanReviewRequest | null>(null);

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
  const flowChatMessageRef = useRef<string | null>(null);

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
      listFlows()
        .then((list) => setFlows(list.map((f) => ({ id: f.id, name: f.name }))))
        .catch(() => {});
    }
  }, [activeView]);

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

  const { send, connectionStatus } = useWebSocket({
    onMessage: (msg) => {
      setMessages((prev) => [...prev, msg]);
    },
    onStatusChange: setIsConnected,
    onFlowEvent: handleFlowEventWithChat,
    onConnect: (directSend) => {
      // Send persisted API key to sidecar immediately on WebSocket open
      getSetting<string>("apiKey", "").then((key) => {
        if (key) {
          directSend({ type: "set_api_key", key });
        }
      });
      // Auto-restore project root from previous session
      if (lastProjectRootRef.current) {
        directSend({ type: "set_project_root", path: lastProjectRootRef.current });
      }
    },
  });

  // Keep the ref in sync with the actual send function
  sendRef.current = send;

  // Sidecar health check
  const sidecarHealth = useSidecarHealth({
    isConnected,
    send: (msg) => send(msg as WSMessageToSidecar),
  });

  const handleSendMessage = useCallback(async (text: string) => {
    // Create session lazily on first message
    if (!sessionIdRef.current) {
      try {
        sessionIdRef.current = await createSession(text);
      } catch { /* DB error -- continue without persistence */ }
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMessage]);

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
        runFlow(flow, text);
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
      // Direct chat (existing behavior)
      send({ type: "user_message", content: text });
    }
  }, [selectedFlowId, send, runFlow]);

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
  const handleOpenRecentProject = useCallback((path: string) => {
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

  const showExecPanel = execState.status !== "idle";

  const renderChatWithExecPanel = () => {
    if (!showExecPanel) {
      return <ChatPanel {...chatPanelProps} />;
    }
    return (
      <div className="workspace-split">
        <div className="workspace-split-left" style={{ flex: 1, width: "auto" }}>
          <ChatPanel {...chatPanelProps} />
        </div>
        <FlowExecutionPanel
          execState={execState}
          onCancel={cancelFlow}
          onReset={resetFlow}
        />
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
              <FileTreePanel onFileSelect={handleFileSelect} onProjectRootChange={handleProjectRootChange} initialRootPath={projectRoot} />
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

      case "flows":
        return (
          <FlowDesigner
            execState={execState}
            onRunFlow={runFlow}
            onCancelFlow={cancelFlow}
            onResetFlow={resetFlow}
          />
        );

      case "logs":
        return <LogStreamPanel messages={messages} />;

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
    </div>
  );
}

export default App;
