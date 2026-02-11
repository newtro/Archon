import { MessageSquare, Workflow, FolderOpen, Settings, ScrollText, Globe } from "lucide-react";
import "./Sidebar.css";

export type SidebarView = "startup" | "chat" | "flows" | "files" | "logs" | "registry" | "settings";

interface SidebarProps {
  activeView: SidebarView;
  onViewChange: (view: SidebarView) => void;
}

const NAV_ITEMS: Array<{ view: SidebarView; icon: typeof MessageSquare; label: string }> = [
  { view: "chat", icon: MessageSquare, label: "Chat" },
  { view: "flows", icon: Workflow, label: "Flows" },
  { view: "files", icon: FolderOpen, label: "Files" },
  { view: "logs", icon: ScrollText, label: "Logs" },
  { view: "registry", icon: Globe, label: "Registry" },
];

export function Sidebar({ activeView, onViewChange }: SidebarProps) {
  return (
    <aside className="sidebar">
      <nav className="sidebar-nav">
        {NAV_ITEMS.map(({ view, icon: Icon, label }) => (
          <button
            key={view}
            className={`sidebar-btn ${activeView === view ? "active" : ""}`}
            title={label}
            onClick={() => onViewChange(view)}
          >
            <Icon size={20} />
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <button
          className={`sidebar-btn ${activeView === "settings" ? "active" : ""}`}
          title="Settings"
          onClick={() => onViewChange("settings")}
        >
          <Settings size={20} />
        </button>
      </div>
    </aside>
  );
}
