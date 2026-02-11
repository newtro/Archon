import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

export type WorkspacePreset = "chat" | "flow" | "review" | "custom";

export interface WorkspaceLayout {
  preset: WorkspacePreset;
  showChat: boolean;
  showFlow: boolean;
  chatWidth: number; // percentage 0-100
}

const PRESETS: Record<WorkspacePreset, Omit<WorkspaceLayout, "preset">> = {
  chat: { showChat: true, showFlow: false, chatWidth: 100 },
  flow: { showChat: false, showFlow: true, chatWidth: 0 },
  review: { showChat: true, showFlow: true, chatWidth: 40 },
  custom: { showChat: true, showFlow: true, chatWidth: 50 },
};

interface WorkspaceContextType {
  layout: WorkspaceLayout;
  setPreset: (preset: WorkspacePreset) => void;
  setChatWidth: (width: number) => void;
}

const WorkspaceContext = createContext<WorkspaceContextType>({
  layout: { preset: "chat", ...PRESETS.chat },
  setPreset: () => {},
  setChatWidth: () => {},
});

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [layout, setLayout] = useState<WorkspaceLayout>({
    preset: "chat",
    ...PRESETS.chat,
  });

  const setPreset = (preset: WorkspacePreset) => {
    setLayout({ preset, ...PRESETS[preset] });
  };

  const setChatWidth = (width: number) => {
    setLayout((prev) => ({ ...prev, preset: "custom", chatWidth: width }));
  };

  // Keyboard shortcuts: Ctrl+Shift+1/2/3 for workspace presets
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey || !e.shiftKey || e.altKey) return;
      switch (e.key) {
        case "!": // Ctrl+Shift+1
          e.preventDefault();
          setPreset("chat");
          break;
        case "@": // Ctrl+Shift+2
          e.preventDefault();
          setPreset("flow");
          break;
        case "#": // Ctrl+Shift+3
          e.preventDefault();
          setPreset("review");
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <WorkspaceContext.Provider value={{ layout, setPreset, setChatWidth }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}
