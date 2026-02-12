import { useEffect, useRef } from "react";
import { Copy, CopyCheck, MousePointerClick } from "lucide-react";
import "./ChatContextMenu.css";

interface ChatContextMenuProps {
  x: number;
  y: number;
  hasSelection: boolean;
  messageContent: string | null;
  onClose: () => void;
}

export function ChatContextMenu({ x, y, hasSelection, messageContent, onClose }: ChatContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Adjust position to keep menu within viewport
  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menuRef.current.style.left = `${window.innerWidth - rect.width - 8}px`;
    }
    if (rect.bottom > window.innerHeight) {
      menuRef.current.style.top = `${window.innerHeight - rect.height - 8}px`;
    }
  }, [x, y]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  const handleCopy = () => {
    const selection = window.getSelection();
    if (selection && selection.toString()) {
      navigator.clipboard.writeText(selection.toString());
    }
    onClose();
  };

  const handleCopyMessage = () => {
    if (messageContent) {
      navigator.clipboard.writeText(messageContent);
    }
    onClose();
  };

  const handleSelectAll = () => {
    const messagesEl = document.querySelector(".chat-messages");
    if (messagesEl) {
      const range = document.createRange();
      range.selectNodeContents(messagesEl);
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
    onClose();
  };

  return (
    <div ref={menuRef} className="chat-context-menu" style={{ top: y, left: x }}>
      {hasSelection && (
        <button className="chat-context-menu-item" onClick={handleCopy}>
          <Copy size={14} />
          Copy
          <span className="chat-context-menu-shortcut">Ctrl+C</span>
        </button>
      )}
      {messageContent && (
        <button className="chat-context-menu-item" onClick={handleCopyMessage}>
          <CopyCheck size={14} />
          Copy Message
        </button>
      )}
      {(hasSelection || messageContent) && (
        <div className="chat-context-menu-divider" />
      )}
      <button className="chat-context-menu-item" onClick={handleSelectAll}>
        <MousePointerClick size={14} />
        Select All
      </button>
    </div>
  );
}
