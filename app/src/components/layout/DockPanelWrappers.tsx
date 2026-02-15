import React, { useEffect } from "react";
import type { IDockviewPanelProps } from "dockview-react";
import { useAppState } from "../../contexts/AppStateContext";
import { useDockview } from "../../contexts/DockviewContext";
import { ChatPanel } from "../chat/ChatPanel";
import { FlowDesigner } from "../flow/FlowDesigner";
import { FlowExecutionPanel } from "../flow/FlowExecutionPanel";
import { FileTreePanel } from "../files/FileTreePanel";
import { CodeViewer } from "../files/CodeViewer";
import { GitPanel } from "../git/GitPanel";
import { DiffViewer } from "../git/DiffViewer";
import { LogStreamPanel } from "../logs/LogStreamPanel";
import { FlowRegistryPanel } from "../registry/FlowRegistryPanel";
import { SettingsPanel } from "../settings/SettingsPanel";
import { StartupPage } from "../startup/StartupPage";
import { openOrFocusPanel } from "../../lib/layout-persistence";
import { FileText } from "lucide-react";

// ── Chat ────────────────────────────────────────────────────

export const ChatPanelWrapper: React.FC<IDockviewPanelProps> = () => {
  const {
    messages, handleSendMessage, isConnected, flows, selectedFlowId,
    setSelectedFlowId, isFlowRunning, isStreaming, handleCancel,
    handleNewChat, sessionId, handleLoadSession, handleDeleteSession,
  } = useAppState();

  return (
    <ChatPanel
      messages={messages}
      onSendMessage={handleSendMessage}
      isConnected={isConnected}
      flows={flows}
      selectedFlowId={selectedFlowId}
      onFlowSelect={setSelectedFlowId}
      isFlowRunning={isFlowRunning}
      isStreaming={isStreaming}
      onCancel={handleCancel}
      onNewChat={handleNewChat}
      sessionId={sessionId}
      onLoadSession={handleLoadSession}
      onDeleteSession={handleDeleteSession}
    />
  );
};

// ── Flow Designer ───────────────────────────────────────────

export const FlowDesignerWrapper: React.FC<IDockviewPanelProps> = (props) => {
  const { execState, runFlow, cancelFlow, resetFlow, setPublishingFlow } = useAppState();

  // Trigger React Flow resize when dockview panel dimensions change
  useEffect(() => {
    const disposer = props.api.onDidDimensionsChange(() => {
      window.dispatchEvent(new Event("resize"));
    });
    return () => disposer.dispose();
  }, [props.api]);

  return (
    <FlowDesigner
      execState={execState}
      onRunFlow={runFlow}
      onCancelFlow={cancelFlow}
      onResetFlow={resetFlow}
      onPublishFlow={setPublishingFlow}
    />
  );
};

// ── Flow Execution Panel ────────────────────────────────────

export const FlowExecWrapper: React.FC<IDockviewPanelProps> = () => {
  const {
    execState, cancelFlow, resetFlow, logEntries, clearLogs,
    previewFlow, contextViewState, send, getRawMessages,
  } = useAppState();

  return (
    <FlowExecutionPanel
      execState={execState}
      onCancel={cancelFlow}
      onReset={resetFlow}
      logEntries={logEntries}
      onClearLogs={clearLogs}
      previewFlow={previewFlow}
      contextViewState={contextViewState}
      onRequestRawContext={(executionId, nodeId) => send({ type: "get_context_raw", executionId, nodeId })}
      getRawMessages={getRawMessages}
    />
  );
};

// ── File Tree ───────────────────────────────────────────────

export const FileTreeWrapper: React.FC<IDockviewPanelProps> = () => {
  const { projectRoot, handleProjectRootChange, gitStatus, send } = useAppState();
  const api = useDockview();

  const handleFileSelect = (path: string, content: string) => {
    if (!api) return;
    const panelId = `file:${path}`;
    const title = path.split(/[/\\]/).pop() || path;
    openOrFocusPanel(api, "codeViewer", { id: panelId, title, params: { path, content } });
  };

  const handleGitViewDiff = (path: string, staged: boolean) => {
    if (!api) return;
    const panelId = `diff:${path}`;
    const title = `Diff: ${path.split(/[/\\]/).pop() || path}`;
    openOrFocusPanel(api, "git", {});
    openOrFocusPanel(api, "diffViewer", { id: panelId, title, params: { path, diff: "", staged } });
    send({ type: "git_diff", file: path, staged });
  };

  return (
    <FileTreePanel
      onFileSelect={handleFileSelect}
      onProjectRootChange={handleProjectRootChange}
      initialRootPath={projectRoot}
      gitStatus={gitStatus}
      onGitStage={(files) => send({ type: "git_stage", files })}
      onGitUnstage={(files) => send({ type: "git_unstage", files })}
      onGitDiscard={(files) => send({ type: "git_discard", files })}
      onGitViewDiff={handleGitViewDiff}
    />
  );
};

// ── Code Viewer ─────────────────────────────────────────────

export const CodeViewerWrapper: React.FC<IDockviewPanelProps> = (props) => {
  const params = props.params as { path?: string; content?: string } | undefined;

  if (!params?.path || params.content === undefined) {
    return (
      <div className="files-empty">
        <FileText size={40} strokeWidth={1.5} style={{ opacity: 0.2 }} />
        <p className="files-empty-text">Select a file to view</p>
      </div>
    );
  }

  return <CodeViewer filePath={params.path} content={params.content} />;
};

// ── Git Panel ───────────────────────────────────────────────

export const GitPanelWrapper: React.FC<IDockviewPanelProps> = () => {
  const { send, isConnected, lastGitMessage, setGitDiff } = useAppState();
  const api = useDockview();

  const handleViewDiff = (path: string, staged: boolean) => {
    if (!api) return;
    setGitDiff({ path, diff: "", staged });
    send({ type: "git_diff", file: path, staged });
    const panelId = `diff:${path}`;
    const title = `Diff: ${path.split(/[/\\]/).pop() || path}`;
    openOrFocusPanel(api, "diffViewer", { id: panelId, title, params: { path, diff: "", staged } });
  };

  const handleViewCommitDiff = (hash: string, message: string) => {
    if (!api) return;
    const displayPath = `commit: ${hash.slice(0, 8)} \u2014 ${message}`;
    setGitDiff({ path: displayPath, diff: "", staged: false });
    send({ type: "git_show", hash });
    const panelId = `diff:commit:${hash}`;
    const title = `${hash.slice(0, 8)}: ${message.slice(0, 30)}`;
    openOrFocusPanel(api, "diffViewer", { id: panelId, title, params: { path: displayPath, diff: "", staged: false } });
  };

  return (
    <GitPanel
      send={send}
      isConnected={isConnected}
      onGitMessage={lastGitMessage}
      onViewDiff={handleViewDiff}
      onViewCommitDiff={handleViewCommitDiff}
    />
  );
};

// ── Diff Viewer ─────────────────────────────────────────────

export const DiffViewerWrapper: React.FC<IDockviewPanelProps> = (props) => {
  const { gitDiff } = useAppState();
  const params = props.params as { path?: string; diff?: string; staged?: boolean } | undefined;

  // Use gitDiff from context if it matches the panel's path, otherwise use params
  const path = params?.path ?? "";
  const diff = gitDiff?.path === path ? gitDiff.diff : (params?.diff ?? "");

  if (!path || !diff) {
    return (
      <div className="files-empty">
        <FileText size={40} strokeWidth={1.5} style={{ opacity: 0.2 }} />
        <p className="files-empty-text">Click a file to view diff</p>
      </div>
    );
  }

  return <DiffViewer filePath={path} diff={diff} />;
};

// ── Logs ────────────────────────────────────────────────────

export const LogsWrapper: React.FC<IDockviewPanelProps> = () => {
  const { logEntries, clearLogs } = useAppState();
  return <LogStreamPanel logEntries={logEntries} onClear={clearLogs} />;
};

// ── Registry ────────────────────────────────────────────────

export const RegistryWrapper: React.FC<IDockviewPanelProps> = () => {
  return <FlowRegistryPanel />;
};

// ── Settings ────────────────────────────────────────────────

export const SettingsWrapper: React.FC<IDockviewPanelProps> = () => {
  const { handleApiKeyChange, handleOpenRouterKeyChange, handleModelChange, handleAdoSettingsChange } = useAppState();
  return (
    <SettingsPanel
      onApiKeyChange={handleApiKeyChange}
      onOpenRouterKeyChange={handleOpenRouterKeyChange}
      onModelChange={handleModelChange}
      onAdoSettingsChange={handleAdoSettingsChange}
    />
  );
};

// ── Startup ─────────────────────────────────────────────────

export const StartupWrapper: React.FC<IDockviewPanelProps> = () => {
  const { recentProjects, handleStartupOpenFolder, handleOpenRecentProject, handleRemoveRecentProject } = useAppState();
  const api = useDockview();

  return (
    <StartupPage
      recentProjects={recentProjects}
      onOpenFolder={handleStartupOpenFolder}
      onOpenRecent={handleOpenRecentProject}
      onRemoveRecent={handleRemoveRecentProject}
      onGoToSettings={() => api && openOrFocusPanel(api, "settings")}
      onGoToFlows={() => api && openOrFocusPanel(api, "flows")}
    />
  );
};
