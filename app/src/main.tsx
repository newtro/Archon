import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { DensityProvider } from "./contexts/DensityContext";
import { restoreWindowState } from "./lib/window-persistence";
import "./styles/global.css";
import "./styles/density.css";

// Restore window position/size then show it (window starts hidden to avoid flash).
// Render React in parallel — the window content will paint as components mount.
restoreWindowState().catch(() => {});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <DensityProvider>
      <App />
    </DensityProvider>
  </React.StrictMode>,
);
