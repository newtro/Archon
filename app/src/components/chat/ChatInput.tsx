import { useState, useRef, useCallback, useEffect } from "react";
import { Send, Square, Workflow, ChevronDown, MessageCircle, Paperclip, X } from "lucide-react";
import type { FlowSummary, ImageAttachment } from "../../lib/types";
import "./ChatInput.css";

interface ChatInputProps {
  onSend: (text: string, images?: ImageAttachment[]) => void;
  disabled: boolean;
  flows?: FlowSummary[];
  selectedFlowId?: string | null;
  onFlowSelect?: (flowId: string | null) => void;
  isFlowRunning?: boolean;
  /** Whether the AI is currently streaming a response */
  isStreaming?: boolean;
  /** Callback to cancel the current operation */
  onCancel?: () => void;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function ChatInput({
  onSend,
  disabled,
  flows = [],
  selectedFlowId = null,
  onFlowSelect,
  isFlowRunning = false,
  isStreaming = false,
  onCancel,
}: ChatInputProps) {
  const [text, setText] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [attachedImages, setAttachedImages] = useState<ImageAttachment[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const addImageFiles = useCallback(async (files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    const newAttachments: ImageAttachment[] = [];
    for (const file of imageFiles) {
      const dataUrl = await readFileAsDataUrl(file);
      newAttachments.push({
        id: crypto.randomUUID(),
        dataUrl,
        mimeType: file.type,
        name: file.name,
      });
    }
    if (newAttachments.length > 0) {
      setAttachedImages((prev) => [...prev, ...newAttachments]);
    }
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        const file = items[i].getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      addImageFiles(imageFiles);
    }
  }, [addImageFiles]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      addImageFiles(Array.from(files));
    }
    // Reset so the same file can be selected again
    e.target.value = "";
  }, [addImageFiles]);

  const removeImage = useCallback((id: string) => {
    setAttachedImages((prev) => prev.filter((img) => img.id !== id));
  }, []);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    const hasContent = trimmed || attachedImages.length > 0;
    if (!hasContent || effectiveDisabled) return;
    onSend(trimmed, attachedImages.length > 0 ? attachedImages : undefined);
    setText("");
    setAttachedImages([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [text, attachedImages, effectiveDisabled, onSend]);

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

        {/* Image previews */}
        {attachedImages.length > 0 && (
          <div className="chat-image-previews">
            {attachedImages.map((img) => (
              <div key={img.id} className="chat-image-preview">
                <img src={img.dataUrl} alt={img.name} />
                <button
                  className="chat-image-remove"
                  onClick={() => removeImage(img.id)}
                  title="Remove image"
                >
                  <X size={10} />
                </button>
              </div>
            ))}
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
            onPaste={handlePaste}
            disabled={effectiveDisabled}
            rows={1}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: "none" }}
            onChange={handleFileSelect}
          />
          <button
            className="chat-attach-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={effectiveDisabled}
            title="Attach image"
          >
            <Paperclip size={16} />
          </button>
          {isStreaming || isFlowRunning ? (
            <button
              className="chat-stop-btn"
              onClick={onCancel}
              title="Stop generation"
            >
              <Square size={14} />
            </button>
          ) : (
            <button
              className="chat-send-btn"
              onClick={handleSend}
              disabled={effectiveDisabled || (!text.trim() && attachedImages.length === 0)}
              title={selectedFlow ? `Run ${selectedFlow.name}` : "Send message"}
            >
              <Send size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
