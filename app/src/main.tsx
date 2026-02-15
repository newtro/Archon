import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { DensityProvider } from "./contexts/DensityContext";
import "./styles/global.css";
import "./styles/density.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <DensityProvider>
      <App />
    </DensityProvider>
  </React.StrictMode>,
);
