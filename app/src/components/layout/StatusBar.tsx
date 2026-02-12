import { Cpu, Coins, Hash, GitBranch, ArrowUp, ArrowDown } from "lucide-react";
import type { ChatMessage, GitStatusData } from "../../lib/types";
import "./StatusBar.css";

interface StatusBarProps {
  isConnected: boolean;
  connectionStatus: string;
  messages: ChatMessage[];
  activeModel?: string;
  sidecarLatency?: number | null;
  gitStatus?: GitStatusData | null;
}

export function StatusBar({ isConnected, connectionStatus, messages, activeModel, sidecarLatency, gitStatus }: StatusBarProps) {
  const assistantMsgs = messages.filter((m) => m.role === "assistant" && !m.isStreaming);
  const totalTokensIn = assistantMsgs.reduce((s, m) => s + (m.tokensIn ?? 0), 0);
  const totalTokensOut = assistantMsgs.reduce((s, m) => s + (m.tokensOut ?? 0), 0);
  const totalCost = assistantMsgs.reduce((s, m) => s + (m.costUsd ?? 0), 0);
  const turnCount = assistantMsgs.length;

  const streaming = messages.find((m) => m.isStreaming);
  const totalChanges = gitStatus
    ? gitStatus.staged.length + gitStatus.unstaged.length + gitStatus.untracked.length
    : 0;

  return (
    <footer className="status-bar">
      <div className="status-bar-left">
        <span className={`status-indicator ${isConnected ? "connected" : "disconnected"}`} />
        <span className="status-text">
          {isConnected
            ? sidecarLatency != null
              ? `Connected (${sidecarLatency}ms)`
              : "Connected"
            : connectionStatus}
        </span>
        {streaming && (
          <>
            <span className="status-divider" />
            <span className="status-streaming-dot" />
            <span className="status-text status-streaming">
              {streaming.model ?? activeModel ?? "Streaming"}
            </span>
          </>
        )}
        {gitStatus?.isRepo && (
          <>
            <span className="status-divider" />
            <span className="status-item status-git" title={`Branch: ${gitStatus.branch}`}>
              <GitBranch size={11} />
              <span>{gitStatus.branch}</span>
            </span>
            {gitStatus.ahead > 0 && (
              <span className="status-item status-git-ahead" title={`${gitStatus.ahead} commit(s) ahead`}>
                <ArrowUp size={10} />{gitStatus.ahead}
              </span>
            )}
            {gitStatus.behind > 0 && (
              <span className="status-item status-git-behind" title={`${gitStatus.behind} commit(s) behind`}>
                <ArrowDown size={10} />{gitStatus.behind}
              </span>
            )}
            {totalChanges > 0 && (
              <span className="status-item status-git-changes" title={`${totalChanges} changed file(s)`}>
                {totalChanges} changed
              </span>
            )}
          </>
        )}
      </div>
      <div className="status-bar-right">
        {activeModel && (
          <span className="status-item" title="Active model">
            <Cpu size={11} />
            <span>{activeModel}</span>
          </span>
        )}
        {turnCount > 0 && (
          <span className="status-item" title="Turns">
            <Hash size={11} />
            <span>{turnCount}</span>
          </span>
        )}
        {(totalTokensIn + totalTokensOut) > 0 && (
          <span className="status-item" title="Total tokens">
            <span>{(totalTokensIn + totalTokensOut).toLocaleString()} tok</span>
          </span>
        )}
        {totalCost > 0 && (
          <span className="status-item" title="Total cost">
            <Coins size={11} />
            <span>${totalCost.toFixed(4)}</span>
          </span>
        )}
        <span className="status-item">ArchonIDE v0.1.0</span>
      </div>
    </footer>
  );
}
