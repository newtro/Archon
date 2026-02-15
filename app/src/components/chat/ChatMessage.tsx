import { useState } from "react";
import { AlertCircle, Brain, ChevronDown } from "lucide-react";
import { ToolCallCard } from "./ToolCallCard";
import { Markdown } from "../../lib/markdown";
import type { ChatMessage as ChatMessageType, ContentBlock, ToolCall } from "../../lib/types";
import "./ChatMessage.css";

interface ChatMessageProps {
  message: ChatMessageType;
}

/** Render a single text content block */
function TextBlock({ text, isLast, isStreaming }: { text: string; isLast: boolean; isStreaming: boolean }) {
  if (!text) return null;
  return (
    <div className="message-content">
      <div className="message-text">
        <Markdown content={text} />
        {isLast && isStreaming && <span className="cursor-blink">|</span>}
      </div>
    </div>
  );
}

/** Render interleaved content blocks (text + tool calls) in order */
function InlineContentBlocks({
  blocks,
  toolCalls,
  isStreaming,
}: {
  blocks: ContentBlock[];
  toolCalls: ToolCall[];
  isStreaming: boolean;
}) {
  const toolCallMap = new Map(toolCalls.map((tc) => [tc.id, tc]));

  return (
    <>
      {blocks.map((block, idx) => {
        const isLast = idx === blocks.length - 1;
        if (block.type === "text") {
          return (
            <TextBlock
              key={`text-${idx}`}
              text={block.text}
              isLast={isLast}
              isStreaming={isStreaming}
            />
          );
        }
        // tool_call block
        const tc = toolCallMap.get(block.toolCallId);
        if (!tc) return null;
        return (
          <div key={tc.id} className="message-tools">
            <ToolCallCard toolCall={tc} />
          </div>
        );
      })}
    </>
  );
}

export function ChatMessage({ message }: ChatMessageProps) {
  const [showThinking, setShowThinking] = useState(false);

  if (message.role === "system") {
    return (
      <div className="message message-system" data-message-id={message.id}>
        <div className="message-system-icon">
          <AlertCircle size={14} />
        </div>
        <span className="message-system-text">{message.content}</span>
      </div>
    );
  }

  const hasContentBlocks = message.contentBlocks && message.contentBlocks.length > 0;

  return (
    <div className={`message message-${message.role}`} data-message-id={message.id}>
      <div className="message-header">
        <span className="message-role">
          {message.role === "user" ? "You" : "Archon"}
        </span>
        {message.model && (
          <span className="message-model">{message.model}</span>
        )}
        {message.isStreaming && (
          <span className="message-streaming">
            <span className="streaming-dot" />
            <span className="streaming-dot" />
            <span className="streaming-dot" />
          </span>
        )}
      </div>

      {/* Thinking blocks */}
      {message.thinking && message.thinking.length > 0 && (
        <div className="message-thinking">
          <button
            className="thinking-toggle"
            onClick={() => setShowThinking(!showThinking)}
          >
            <Brain size={14} />
            <span>Thinking{message.thinking.some((t) => t.isStreaming) ? "..." : ""}</span>
            <ChevronDown size={12} className={`thinking-chevron ${showThinking ? "open" : ""}`} />
          </button>
          {showThinking && (
            <div className="thinking-content">
              {message.thinking.map((block) => (
                <pre key={block.id} className="thinking-text">
                  {block.content}
                  {block.isStreaming && <span className="cursor-blink">|</span>}
                </pre>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Image attachments */}
      {message.images && message.images.length > 0 && (
        <div className="message-images">
          {message.images.map((img) => (
            <img key={img.id} src={img.dataUrl} alt={img.name} />
          ))}
        </div>
      )}

      {/* Inline content blocks: interleaved text + tool calls */}
      {hasContentBlocks ? (
        <InlineContentBlocks
          blocks={message.contentBlocks!}
          toolCalls={message.toolCalls || []}
          isStreaming={!!message.isStreaming}
        />
      ) : (
        <>
          {/* Legacy fallback: tool calls above text */}
          {message.toolCalls && message.toolCalls.length > 0 && (
            <div className="message-tools">
              {message.toolCalls.map((toolCall) => (
                <ToolCallCard key={toolCall.id} toolCall={toolCall} />
              ))}
            </div>
          )}
          {message.content && (
            <div className="message-content">
              <div className="message-text">
                <Markdown content={message.content} />
                {message.isStreaming && <span className="cursor-blink">|</span>}
              </div>
            </div>
          )}
        </>
      )}

      {/* Metadata footer */}
      {!message.isStreaming && message.role === "assistant" && (message.tokensIn || message.costUsd) && (
        <div className="message-meta">
          {message.tokensIn != null && (
            <span className="meta-item">{message.tokensIn.toLocaleString()} in / {(message.tokensOut ?? 0).toLocaleString()} out</span>
          )}
          {message.costUsd != null && (
            <span className="meta-item">${message.costUsd.toFixed(4)}</span>
          )}
        </div>
      )}
    </div>
  );
}
