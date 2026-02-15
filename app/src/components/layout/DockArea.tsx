import { useRef, useCallback, useMemo, useEffect } from "react";
import { DockviewReact, type DockviewApi, type DockviewReadyEvent } from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import "../../styles/dockview-theme.css";
import { useAppState } from "../../contexts/AppStateContext";
import { saveLayout, restoreLayout, createDefaultLayout, applyPreset, openOrFocusPanel } from "../../lib/layout-persistence";
import {
  ChatPanelWrapper,
  FlowDesignerWrapper,
  FlowExecWrapper,
  FileTreeWrapper,
  CodeViewerWrapper,
  GitPanelWrapper,
  DiffViewerWrapper,
  LogsWrapper,
  RegistryWrapper,
  SettingsWrapper,
  StartupWrapper,
} from "./DockPanelWrappers";

interface DockAreaProps {
  onApiReady: (api: DockviewApi) => void;
}

export function DockArea({ onApiReady }: DockAreaProps) {
  const apiRef = useRef<DockviewApi | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { setOpenPanelFn, setApplyLayoutPresetFn, projectRoot } = useAppState();

  const components = useMemo(() => ({
    chat: ChatPanelWrapper,
    flows: FlowDesignerWrapper,
    flowExec: FlowExecWrapper,
    fileTree: FileTreeWrapper,
    codeViewer: CodeViewerWrapper,
    git: GitPanelWrapper,
    diffViewer: DiffViewerWrapper,
    logs: LogsWrapper,
    registry: RegistryWrapper,
    settings: SettingsWrapper,
    startup: StartupWrapper,
  }), []);

  // Wire up navigation functions for AppStateContext
  useEffect(() => {
    setOpenPanelFn((component, options) => {
      if (apiRef.current) {
        openOrFocusPanel(apiRef.current, component, options);
      }
    });
    setApplyLayoutPresetFn((preset) => {
      if (apiRef.current) {
        applyPreset(apiRef.current, preset);
      }
    });
  }, [setOpenPanelFn, setApplyLayoutPresetFn]);

  const onReady = useCallback(async (event: DockviewReadyEvent) => {
    apiRef.current = event.api;
    onApiReady(event.api);

    // Debounced layout persistence
    event.api.onDidLayoutChange(() => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        if (apiRef.current) saveLayout(apiRef.current);
      }, 1000);
    });

    // Try to restore saved layout, or create default
    const restored = await restoreLayout(event.api);
    if (!restored) {
      if (projectRoot) {
        createDefaultLayout(event.api);
      } else {
        // No project open — show startup
        event.api.addPanel({
          id: "startup",
          component: "startup",
          title: "Welcome",
          renderer: "onlyWhenVisible",
        });
      }
    }
  }, [projectRoot, onApiReady]);

  // Keyboard shortcuts for layout presets (Ctrl+Shift+1/2/3)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey || !e.shiftKey || e.altKey || !apiRef.current) return;
      switch (e.key) {
        case "!": // Ctrl+Shift+1
          e.preventDefault();
          applyPreset(apiRef.current, "chat");
          break;
        case "@": // Ctrl+Shift+2
          e.preventDefault();
          applyPreset(apiRef.current, "flow");
          break;
        case "#": // Ctrl+Shift+3
          e.preventDefault();
          applyPreset(apiRef.current, "review");
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <DockviewReact
      className="dockview-theme-archon"
      components={components}
      onReady={onReady}
    />
  );
}
