import { MessageSquare, Workflow, FolderOpen, Settings, ScrollText, Globe, GitBranch } from "lucide-react";
import type { GitStatusData } from "../../lib/types";
import "./Sidebar.css";

export type SidebarView = "startup" | "chat" | "flows" | "files" | "git" | "logs" | "registry" | "settings";

interface SidebarProps {
  activeView: SidebarView;
  onViewChange: (view: SidebarView) => void;
  gitStatus?: GitStatusData | null;
}

const NAV_ITEMS: Array<{ view: SidebarView; icon: typeof MessageSquare; label: string }> = [
  { view: "chat", icon: MessageSquare, label: "Chat" },
  { view: "flows", icon: Workflow, label: "Flows" },
  { view: "files", icon: FolderOpen, label: "Files" },
  { view: "git", icon: GitBranch, label: "Source Control" },
  { view: "logs", icon: ScrollText, label: "Logs" },
  { view: "registry", icon: Globe, label: "Registry" },
];

export function Sidebar({ activeView, onViewChange, gitStatus }: SidebarProps) {
  const gitChangeCount = gitStatus
    ? gitStatus.staged.length + gitStatus.unstaged.length + gitStatus.untracked.length
    : 0;

  return (
    <aside className="sidebar">
      <nav className="sidebar-nav">
        {NAV_ITEMS.map(({ view, icon: Icon, label }) => (
          <button
            key={view}
            className={`sidebar-btn ${activeView === view ? "active" : ""}`}
            title={view === "git" && gitStatus?.branch ? `${label} (${gitStatus.branch})` : label}
            onClick={() => onViewChange(view)}
          >
            <Icon size={20} />
            {view === "git" && gitChangeCount > 0 && (
              <span className="sidebar-badge">{gitChangeCount > 99 ? "99+" : gitChangeCount}</span>
            )}
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
