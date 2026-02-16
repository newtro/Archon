import { useEffect } from "react";
import { Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./TitleBar.css";

function windowAction(action: () => Promise<void>) {
  action().catch((err) => console.error("Window action failed:", err));
}

export function TitleBar() {
  const appWindow = getCurrentWindow();

  // Intercept OS-level close (Alt+F4, taskbar close) — hide to tray instead
  useEffect(() => {
    const unlisten = appWindow.onCloseRequested(async (event) => {
      event.preventDefault();
      await appWindow.hide();
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [appWindow]);

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
          onClick={() => windowAction(() => appWindow.hide())}
          title="Minimize to tray"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
