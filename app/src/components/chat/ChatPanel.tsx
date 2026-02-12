import React, { useState, useRef, useEffect, useCallback } from "react";
import { MessageCircle, Layers, SquarePen, History, Trash2, Bug } from "lucide-react";
import { ChatMessage as ChatMessageComponent } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { useDensity, type DensityMode } from "../../contexts/DensityContext";
import { listSessions } from "../../lib/chat-storage";
import type { ChatMessage, ChatSession, FlowSummary, ImageAttachment } from "../../lib/types";
import "./ChatPanel.css";

interface ChatPanelProps {
  messages: ChatMessage[];
  onSendMessage: (text: string, images?: ImageAttachment[]) => void;
  isConnected: boolean;
  flows?: FlowSummary[];
  selectedFlowId?: string | null;
  onFlowSelect?: (flowId: string | null) => void;
  isFlowRunning?: boolean;
  onNewChat?: () => void;
  sessionId?: string | null;
  onLoadSession?: (id: string) => void;
  onDeleteSession?: (id: string) => void;
  debugActive?: boolean;
  onToggleDebug?: () => void;
}

const DENSITY_LABELS: Record<DensityMode, string> = {
  minimal: "Minimal",
  normal: "Normal",
  verbose: "Verbose",
};

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function ChatPanel({ messages, onSendMessage, isConnected, flows, selectedFlowId, onFlowSelect, isFlowRunning, onNewChat, sessionId, onLoadSession, onDeleteSession, debugActive, onToggleDebug }: ChatPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const { density, cycleDensity } = useDensity();

  // History dropdown state
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const historyRef = useRef<HTMLDivElement>(null);

  // Load sessions when dropdown opens
  useEffect(() => {
    if (historyOpen) {
      listSessions(30).then(setSessions).catch(() => {});
    }
  }, [historyOpen]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!historyOpen) return;
    const handler = (e: MouseEvent) => {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
        setHistoryOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [historyOpen]);

  const handleSelectSession = useCallback((id: string) => {
    onLoadSession?.(id);
    setHistoryOpen(false);
  }, [onLoadSession]);

  const handleDeleteSession = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    onDeleteSession?.(id);
    setSessions((prev) => prev.filter((s) => s.id !== id));
  }, [onDeleteSession]);

  // Deduplicate streaming messages (keep latest version of each id)
  const deduped = messages.reduce<ChatMessage[]>((acc, msg) => {
    const existingIdx = acc.findIndex((m) => m.id === msg.id);
    if (existingIdx >= 0) {
      acc[existingIdx] = msg;
    } else {
      acc.push(msg);
    }
    return acc;
  }, []);

  useEffect(() => {
    if (autoScroll) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [deduped, autoScroll]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
    setAutoScroll(isNearBottom);
  };

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <h2 className="chat-title">Chat</h2>
        <span className="chat-model-badge">Claude Sonnet 4.5</span>
        <span className="chat-spacer" />
        <div className="chat-history-wrapper" ref={historyRef}>
          <button
            className={`chat-header-btn ${historyOpen ? "active" : ""}`}
            onClick={() => setHistoryOpen(!historyOpen)}
            title="Chat history"
          >
            <History size={14} />
          </button>
          {historyOpen && (
            <div className="chat-history-dropdown">
              <div className="chat-history-header">Recent Chats</div>
              {sessions.length === 0 ? (
                <div className="chat-history-empty">No previous sessions</div>
              ) : (
                <div className="chat-history-list">
                  {sessions.map((s) => (
                    <button
                      key={s.id}
                      className={`chat-history-item ${s.id === sessionId ? "active" : ""}`}
                      onClick={() => handleSelectSession(s.id)}
                    >
                      <div className="chat-history-item-title">{s.title}</div>
                      <div className="chat-history-item-meta">
                        <span>{timeAgo(s.updatedAt)}</span>
                        {s.messageCount != null && (
                          <span>{s.messageCount} msgs</span>
                        )}
                      </div>
                      {s.preview && (
                        <div className="chat-history-item-preview">{s.preview}</div>
                      )}
                      <button
                        className="chat-history-item-delete"
                        onClick={(e) => handleDeleteSession(e, s.id)}
                        title="Delete session"
                      >
                        <Trash2 size={12} />
                      </button>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        {onNewChat && (
          <button
            className="chat-header-btn"
            onClick={onNewChat}
            title="New chat"
          >
            <SquarePen size={14} />
          </button>
        )}
        {onToggleDebug && (
          <button
            className={`chat-header-btn ${debugActive ? "active" : ""}`}
            onClick={onToggleDebug}
            title="Toggle debug log panel"
          >
            <Bug size={14} />
          </button>
        )}
        <button
          className="chat-density-btn"
          onClick={cycleDensity}
          title={`Density: ${DENSITY_LABELS[density]} (Ctrl+1/2/3)`}
        >
          <Layers size={14} />
          <span>{DENSITY_LABELS[density]}</span>
        </button>
      </div>
      <div
        className="chat-messages"
        ref={containerRef}
        onScroll={handleScroll}
      >
        {deduped.length === 0 && (
          <div className="chat-empty">
            <div className="chat-empty-icon">
              <MessageCircle size={40} strokeWidth={1.5} />
            </div>
            <h3 className="chat-empty-title">Welcome to ArchonIDE</h3>
            <p className="chat-empty-text">
              Start a conversation to begin coding with AI agents.
            </p>
          </div>
        )}
        {deduped.map((msg, idx) => {
          // Show node divider when consecutive assistant messages have different models
          let divider: React.ReactNode = null;
          if (idx > 0 && msg.role === "assistant") {
            const prev = deduped[idx - 1];
            if (
              prev.role === "assistant" &&
              prev.model !== msg.model &&
              (prev.model || msg.model)
            ) {
              divider = (
                <div className="node-divider">
                  <span className="node-divider-line" />
                  <span className="node-divider-text">{msg.model ?? "Agent"}</span>
                  <span className="node-divider-line" />
                </div>
              );
            }
          }
          return (
            <React.Fragment key={msg.id}>
              {divider}
              <ChatMessageComponent message={msg} />
            </React.Fragment>
          );
        })}
        <div ref={messagesEndRef} />
      </div>
      <ChatInput
        onSend={onSendMessage}
        disabled={!isConnected}
        flows={flows}
        selectedFlowId={selectedFlowId}
        onFlowSelect={onFlowSelect}
        isFlowRunning={isFlowRunning}
      />
    </div>
  );
}
