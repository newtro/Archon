import { Cpu, Coins, Hash } from "lucide-react";
import type { ChatMessage } from "../../lib/types";
import "./StatusBar.css";

interface StatusBarProps {
  isConnected: boolean;
  connectionStatus: string;
  messages: ChatMessage[];
  activeModel?: string;
  sidecarLatency?: number | null;
}

export function StatusBar({ isConnected, connectionStatus, messages, activeModel, sidecarLatency }: StatusBarProps) {
  const assistantMsgs = messages.filter((m) => m.role === "assistant" && !m.isStreaming);
  const totalTokensIn = assistantMsgs.reduce((s, m) => s + (m.tokensIn ?? 0), 0);
  const totalTokensOut = assistantMsgs.reduce((s, m) => s + (m.tokensOut ?? 0), 0);
  const totalCost = assistantMsgs.reduce((s, m) => s + (m.costUsd ?? 0), 0);
  const turnCount = assistantMsgs.length;

  const streaming = messages.find((m) => m.isStreaming);

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
