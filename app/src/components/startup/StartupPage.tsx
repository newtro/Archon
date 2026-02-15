import { FolderOpen, MessageSquare, Folder, X, Settings, Workflow } from "lucide-react";
import type { RecentProject } from "../../lib/types";
import "./StartupPage.css";

interface StartupPageProps {
  recentProjects: RecentProject[];
  onOpenFolder: () => void;
  onOpenRecent: (path: string) => void;
  onRemoveRecent: (path: string) => void;
  onGoToSettings: () => void;
  onGoToFlows: () => void;
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function StartupPage({
  recentProjects,
  onOpenFolder,
  onOpenRecent,
  onRemoveRecent,
  onGoToSettings,
  onGoToFlows,
}: StartupPageProps) {
  return (
    <div className="startup-page">
      <div className="startup-hero">
        <h1 className="startup-title">Archon</h1>
        <p className="startup-subtitle">AI Agent-First IDE</p>
      </div>

      <div className="startup-actions">
        <button className="startup-action-card" onClick={onOpenFolder}>
          <FolderOpen size={24} strokeWidth={1.5} />
          <span className="startup-action-label">Open Folder</span>
        </button>
        <button className="startup-action-card" onClick={onGoToFlows}>
          <Workflow size={24} strokeWidth={1.5} />
          <span className="startup-action-label">Flow Designer</span>
        </button>
      </div>

      {recentProjects.length > 0 && (
        <div className="startup-recents">
          <h3 className="startup-recents-title">Recent Projects</h3>
          <div className="startup-recents-list">
            {recentProjects.map((project) => (
              <div
                key={project.path}
                className="startup-recent-item"
                onClick={() => onOpenRecent(project.path)}
              >
                <Folder size={16} className="startup-recent-icon" />
                <div className="startup-recent-info">
                  <span className="startup-recent-name">{project.name}</span>
                  <span className="startup-recent-path">{project.path}</span>
                </div>
                <span className="startup-recent-time">{timeAgo(project.lastOpened)}</span>
                <button
                  className="startup-recent-remove"
                  title="Remove from recents"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveRecent(project.path);
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="startup-links">
        <button className="startup-link" onClick={onGoToSettings}>
          <Settings size={14} />
          Settings
        </button>
        <span className="startup-link-sep" />
        <button className="startup-link" onClick={onOpenFolder}>
          <MessageSquare size={14} />
          New Chat
        </button>
      </div>
    </div>
  );
}
