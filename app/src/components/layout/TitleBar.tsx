import { Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./TitleBar.css";

function windowAction(action: () => Promise<void>) {
  action().catch((err) => console.error("Window action failed:", err));
}

export function TitleBar() {
  const appWindow = getCurrentWindow();

  return (
    <div className="title-bar" data-tauri-drag-region>
      <div className="title-bar-label" data-tauri-drag-region>
        <img src="/logo.png" alt="" className="title-bar-icon" />
        Archon
      </div>
      <div className="title-bar-controls">
        <button
          className="title-bar-btn"
          onClick={() => windowAction(() => appWindow.minimize())}
          title="Minimize"
        >
          <Minus size={14} />
        </button>
        <button
          className="title-bar-btn"
          onClick={() => windowAction(() => appWindow.toggleMaximize())}
          title="Maximize"
        >
          <Square size={11} />
        </button>
        <button
          className="title-bar-btn title-bar-close"
          onClick={() => windowAction(() => appWindow.close())}
          title="Close"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
