import { useState, useEffect, useCallback } from "react";
import { MessageSquare, Workflow, FolderOpen, Settings, ScrollText, Globe, GitBranch } from "lucide-react";
import { useDockview } from "../../contexts/DockviewContext";
import { useAppState } from "../../contexts/AppStateContext";
import { openOrFocusPanel } from "../../lib/layout-persistence";
import "./Sidebar.css";

export type SidebarView = "startup" | "chat" | "flows" | "files" | "git" | "logs" | "registry" | "settings";

const NAV_ITEMS: Array<{ view: SidebarView; icon: typeof MessageSquare; label: string; component: string }> = [
  { view: "chat", icon: MessageSquare, label: "Chat", component: "chat" },
  { view: "flows", icon: Workflow, label: "Flows", component: "flows" },
  { view: "files", icon: FolderOpen, label: "Files", component: "fileTree" },
  { view: "git", icon: GitBranch, label: "Source Control", component: "git" },
  { view: "logs", icon: ScrollText, label: "Logs", component: "logs" },
  { view: "registry", icon: Globe, label: "Registry", component: "registry" },
];

export function Sidebar() {
  const api = useDockview();
  const { gitStatus } = useAppState();
  // Track open component names and active panel id for re-renders
  const [openComponents, setOpenComponents] = useState<Set<string>>(new Set());
  const [activePanelId, setActivePanelId] = useState<string | null>(null);

  // Track which panels are open and which is active
  useEffect(() => {
    if (!api) return;

    const updatePanels = () => {
      const components = new Set<string>();
      for (const panel of api.panels) {
        components.add(panel.view.contentComponent);
      }
      setOpenComponents(components);
    };

    const updateActive = () => {
      setActivePanelId(api.activePanel?.id ?? null);
    };

    // Initial state
    updatePanels();
    updateActive();

    const d1 = api.onDidAddPanel(() => updatePanels());
    const d2 = api.onDidRemovePanel(() => updatePanels());
    const d3 = api.onDidActivePanelChange(() => updateActive());

    return () => {
      d1.dispose();
      d2.dispose();
      d3.dispose();
    };
  }, [api]);

  const gitChangeCount = gitStatus
    ? gitStatus.staged.length + gitStatus.unstaged.length + gitStatus.untracked.length
    : 0;

  const handleNavClick = useCallback((component: string) => {
    if (!api) return;

    // Chat: also ensure FlowExecutionPanel is open alongside
    if (component === "chat") {
      openOrFocusPanel(api, "chat");
      // Open flowExec to the right if it doesn't exist yet
      if (!api.getPanel("flowExec")) {
        openOrFocusPanel(api, "flowExec", { referencePanel: "chat", direction: "right" });
      }
      return;
    }

    openOrFocusPanel(api, component);
  }, [api]);

  // Check if a given component is currently active
  const isPanelActive = useCallback((component: string): boolean => {
    if (!api || !activePanelId) return false;
    const activePanel = api.activePanel;
    if (!activePanel) return false;
    return activePanel.view.contentComponent === component;
  }, [api, activePanelId]);

  // Check if a given component has any open panel
  const isPanelOpen = useCallback((component: string): boolean => {
    return openComponents.has(component);
  }, [openComponents]);

  return (
    <aside className="sidebar">
      <nav className="sidebar-nav">
        {NAV_ITEMS.map(({ view, icon: Icon, label, component }) => {
          const isActive = isPanelActive(component);
          const isOpen = isPanelOpen(component);
          return (
            <button
              key={view}
              className={`sidebar-btn ${isActive ? "active" : isOpen ? "open" : ""}`}
              title={view === "git" && gitStatus?.branch ? `${label} (${gitStatus.branch})` : label}
              onClick={() => handleNavClick(component)}
            >
              <Icon size={20} />
              {view === "git" && gitChangeCount > 0 && (
                <span className="sidebar-badge">{gitChangeCount > 99 ? "99+" : gitChangeCount}</span>
              )}
            </button>
          );
        })}
      </nav>
      <div className="sidebar-bottom">
        <button
          className={`sidebar-btn ${isPanelActive("settings") ? "active" : isPanelOpen("settings") ? "open" : ""}`}
          title="Settings"
          onClick={() => handleNavClick("settings")}
        >
          <Settings size={20} />
        </button>
      </div>
    </aside>
  );
}
