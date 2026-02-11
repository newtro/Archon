import { useState, useRef, useCallback, useEffect } from "react";
import { Send, Workflow, ChevronDown, MessageCircle } from "lucide-react";
import type { FlowSummary } from "../../lib/types";
import "./ChatInput.css";

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled: boolean;
  flows?: FlowSummary[];
  selectedFlowId?: string | null;
  onFlowSelect?: (flowId: string | null) => void;
  isFlowRunning?: boolean;
}

export function ChatInput({
  onSend,
  disabled,
  flows = [],
  selectedFlowId = null,
  onFlowSelect,
  isFlowRunning = false,
}: ChatInputProps) {
  const [text, setText] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedFlow = flows.find((f) => f.id === selectedFlowId);
  const effectiveDisabled = disabled || (isFlowRunning && selectedFlowId !== null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showDropdown) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showDropdown]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || effectiveDisabled) return;
    onSend(trimmed);
    setText("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [text, effectiveDisabled, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  return (
    <div className="chat-input-container">
      <div className={`chat-input-wrapper ${effectiveDisabled ? "disabled" : ""}`}>
        {/* Flow selector toolbar */}
        {flows.length > 0 && onFlowSelect && (
          <div className="chat-input-toolbar">
            <div className="flow-selector-wrapper" ref={dropdownRef}>
              <button
                className={`flow-selector-trigger ${selectedFlow ? "active" : ""}`}
                onClick={() => setShowDropdown(!showDropdown)}
                disabled={disabled || isFlowRunning}
              >
                <Workflow size={12} />
                <span>{selectedFlow ? selectedFlow.name : "Direct Chat"}</span>
                <ChevronDown size={10} className={showDropdown ? "chevron-up" : ""} />
              </button>
              {showDropdown && (
                <div className="flow-selector-dropdown">
                  <div
                    className={`flow-selector-option ${!selectedFlowId ? "selected" : ""}`}
                    onClick={() => { onFlowSelect(null); setShowDropdown(false); }}
                  >
                    <MessageCircle size={12} />
                    <span>Direct Chat</span>
                  </div>
                  {flows.map((f) => (
                    <div
                      key={f.id}
                      className={`flow-selector-option ${f.id === selectedFlowId ? "selected" : ""}`}
                      onClick={() => { onFlowSelect(f.id); setShowDropdown(false); }}
                    >
                      <Workflow size={12} />
                      <span>{f.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Input row */}
        <div className="chat-input-row">
          <textarea
            ref={textareaRef}
            className="chat-input"
            placeholder={
              effectiveDisabled
                ? isFlowRunning ? "Flow is running..." : "Waiting for sidecar connection..."
                : selectedFlow
                  ? `Message for ${selectedFlow.name}...`
                  : "Type a message... (Enter to send, Shift+Enter for newline)"
            }
            value={text}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            disabled={effectiveDisabled}
            rows={1}
          />
          <button
            className="chat-send-btn"
            onClick={handleSend}
            disabled={effectiveDisabled || !text.trim()}
            title={selectedFlow ? `Run ${selectedFlow.name}` : "Send message"}
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
