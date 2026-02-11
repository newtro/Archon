import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { DensityProvider } from "./contexts/DensityContext";
import { WorkspaceProvider } from "./contexts/WorkspaceContext";
import "./styles/global.css";
import "./styles/density.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <DensityProvider>
      <WorkspaceProvider>
        <App />
      </WorkspaceProvider>
    </DensityProvider>
  </React.StrictMode>,
);
