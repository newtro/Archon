import { useState, useEffect, useCallback, useRef } from "react";
import {
  GitBranch,
  RefreshCw,
  Plus,
  Minus,
  ChevronDown,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  Undo2,
  FolderGit2,
  Sparkles,
  Loader2,
  Globe,
  Trash2,
  Check,
} from "lucide-react";
import type {
  WSMessageToSidecar,
  WSMessageFromSidecar,
  GitStatusData,
  GitLogData,
  GitBranchData,
  GitRemoteInfo,
  GitFileStatus,
  GitLogEntry,
} from "../../lib/types";
import "./GitPanel.css";

interface GitPanelProps {
  send: (msg: WSMessageToSidecar) => void;
  isConnected: boolean;
  onGitMessage?: WSMessageFromSidecar | null;
  onViewDiff?: (path: string, staged: boolean) => void;
  onViewCommitDiff?: (hash: string, message: string) => void;
}

const STATUS_LABELS: Record<string, string> = {
  M: "Modified",
  A: "Added",
  D: "Deleted",
  R: "Renamed",
  C: "Copied",
  "?": "Untracked",
  U: "Unmerged",
};

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d`;
  const diffMon = Math.floor(diffDay / 30);
  return `${diffMon}mo`;
}

export function GitPanel({ send, isConnected, onGitMessage, onViewDiff, onViewCommitDiff }: GitPanelProps) {
  const [status, setStatus] = useState<GitStatusData | null>(null);
  const [log, setLog] = useState<GitLogData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [commitMsg, setCommitMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Section collapsed state
  const [stagedOpen, setStagedOpen] = useState(true);
  const [unstagedOpen, setUnstagedOpen] = useState(true);
  const [untrackedOpen, setUntrackedOpen] = useState(true);

  // Branch selector state
  const [branches, setBranches] = useState<GitBranchData | null>(null);
  const [showBranchSelector, setShowBranchSelector] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [creatingBranch, setCreatingBranch] = useState(false);

  // Remote manager state
  const [remotes, setRemotes] = useState<GitRemoteInfo[]>([]);
  const [showRemotes, setShowRemotes] = useState(false);
  const [addRemoteName, setAddRemoteName] = useState("");
  const [addRemoteUrl, setAddRemoteUrl] = useState("");
  const [addingRemote, setAddingRemote] = useState(false);

  const hasFetchedRef = useRef(false);
  const branchSelectorRef = useRef<HTMLDivElement>(null);

  // Request status on mount and when connected
  const refresh = useCallback(() => {
    if (!isConnected) return;
    setLoading(true);
    setError(null);
    send({ type: "git_status" });
    send({ type: "git_log", page: 0, pageSize: 20 });
  }, [send, isConnected]);

  useEffect(() => {
    if (isConnected && !hasFetchedRef.current) {
      hasFetchedRef.current = true;
      refresh();
      send({ type: "git_start_watching" });
    }
  }, [isConnected, refresh, send]);

  // Close branch selector on outside click
  useEffect(() => {
    if (!showBranchSelector) return;
    const handleClick = (e: MouseEvent) => {
      if (branchSelectorRef.current && !branchSelectorRef.current.contains(e.target as Node)) {
        setShowBranchSelector(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showBranchSelector]);

  // Handle incoming git messages
  useEffect(() => {
    if (!onGitMessage) return;
    const msg = onGitMessage;

    switch (msg.type) {
      case "git_status_response":
        setStatus(msg.data);
        setLoading(false);
        break;
      case "git_status_update":
        setStatus(msg.data);
        break;
      case "git_log_response":
        setLog(msg.data);
        setLoading(false);
        break;
      case "git_branches_response":
        setBranches(msg.data);
        break;
      case "git_remotes_response":
        setRemotes(msg.data);
        break;
      case "git_error":
        setError(`${msg.command}: ${msg.error}`);
        setLoading(false);
        setCreatingBranch(false);
        setAddingRemote(false);
        break;
      case "git_operation_complete":
        if (!msg.success) {
          setError(`${msg.operation} failed`);
        }
        if (msg.operation === "checkout" || msg.operation === "create_branch") {
          setShowBranchSelector(false);
          setCreatingBranch(false);
          setNewBranchName("");
          send({ type: "git_branches" });
        }
        if (msg.operation === "add_remote" || msg.operation === "remove_remote") {
          setAddingRemote(false);
          setAddRemoteName("");
          setAddRemoteUrl("");
          send({ type: "git_remotes" });
        }
        break;
      case "git_commit_msg_response":
        setCommitMsg(msg.message);
        setGenerating(false);
        break;
    }
  }, [onGitMessage, send]);

  // Actions
  const handleStage = useCallback((files: string[]) => {
    send({ type: "git_stage", files });
  }, [send]);

  const handleUnstage = useCallback((files: string[]) => {
    send({ type: "git_unstage", files });
  }, [send]);

  const handleDiscard = useCallback((files: string[]) => {
    send({ type: "git_discard", files });
  }, [send]);

  const handleCommit = useCallback(() => {
    if (!commitMsg.trim()) return;
    send({ type: "git_commit", message: commitMsg.trim() });
    setCommitMsg("");
    setTimeout(() => send({ type: "git_log", page: 0, pageSize: 20 }), 500);
  }, [send, commitMsg]);

  const handlePush = useCallback(() => { send({ type: "git_push" }); }, [send]);
  const handlePull = useCallback(() => { send({ type: "git_pull" }); }, [send]);
  const handleInit = useCallback(() => { send({ type: "git_init" }); }, [send]);

  const handleGenerateMsg = useCallback(() => {
    setGenerating(true);
    send({ type: "git_generate_commit_msg" } as WSMessageToSidecar);
  }, [send]);

  const handleFileClick = useCallback((file: GitFileStatus, staged: boolean) => {
    onViewDiff?.(file.path, staged);
  }, [onViewDiff]);

  const handleLoadMore = useCallback(() => {
    if (!log) return;
    send({ type: "git_log", page: log.page + 1, pageSize: log.pageSize });
  }, [send, log]);

  const handleStageAll = useCallback(() => {
    if (!status) return;
    const files = [...status.unstaged.map(f => f.path), ...status.untracked.map(f => f.path)];
    if (files.length > 0) handleStage(files);
  }, [status, handleStage]);

  const handleUnstageAll = useCallback(() => {
    if (!status) return;
    const files = status.staged.map(f => f.path);
    if (files.length > 0) handleUnstage(files);
  }, [status, handleUnstage]);

  const handleOpenBranchSelector = useCallback(() => {
    send({ type: "git_branches" });
    setShowBranchSelector((prev) => !prev);
  }, [send]);

  const handleCheckout = useCallback((branch: string) => {
    send({ type: "git_checkout", branch });
  }, [send]);

  const handleCreateBranch = useCallback(() => {
    const name = newBranchName.trim();
    if (!name) return;
    setCreatingBranch(true);
    send({ type: "git_create_branch", name });
  }, [send, newBranchName]);

  const handleToggleRemotes = useCallback(() => {
    if (!showRemotes) send({ type: "git_remotes" });
    setShowRemotes((prev) => !prev);
  }, [send, showRemotes]);

  const handleAddRemote = useCallback(() => {
    const name = addRemoteName.trim();
    const url = addRemoteUrl.trim();
    if (!name || !url) return;
    setAddingRemote(true);
    send({ type: "git_add_remote", name, url });
  }, [send, addRemoteName, addRemoteUrl]);

  const handleRemoveRemote = useCallback((name: string) => {
    send({ type: "git_remove_remote", name });
  }, [send]);

  const handleCommitClick = useCallback((entry: GitLogEntry) => {
    onViewCommitDiff?.(entry.hash, entry.message);
  }, [onViewCommitDiff]);

  const isDetachedHead = status?.branch === "HEAD" || (status?.branch ?? "").startsWith("(HEAD");

  // Not a repo — show init screen
  if (status && !status.isRepo) {
    return (
      <div className="git-panel">
        <div className="git-header">
          <div className="git-header-left">
            <h2 className="git-title">Source Control</h2>
          </div>
        </div>
        <div className="git-no-repo">
          <FolderGit2 size={40} strokeWidth={1.5} style={{ opacity: 0.3 }} />
          <p className="git-no-repo-text">This folder is not a Git repository.</p>
          <button className="git-init-btn" onClick={handleInit}>
            <GitBranch size={14} /> Initialize Repository
          </button>
        </div>
      </div>
    );
  }

  const hasStagedChanges = (status?.staged.length ?? 0) > 0;
  const canCommit = hasStagedChanges && commitMsg.trim().length > 0;

  return (
    <div className="git-panel">
      {/* Header */}
      <div className="git-header">
        <div className="git-header-left">
          <h2 className="git-title">Source Control</h2>
          {status && (
            <>
              <span className={`git-branch-badge ${isDetachedHead ? "git-branch-badge--detached" : ""}`}>
                <GitBranch size={12} />
                {isDetachedHead ? "DETACHED" : status.branch}
              </span>
              {!status.tracking && !isDetachedHead && (
                <span className="git-sync-badge" title="No upstream set">no upstream</span>
              )}
              {(status.ahead > 0 || status.behind > 0) && (
                <span className="git-sync-badges">
                  {status.ahead > 0 && (
                    <span className="git-sync-badge git-sync-badge--ahead" title={`${status.ahead} ahead`}>
                      <ArrowUp size={10} />{status.ahead}
                    </span>
                  )}
                  {status.behind > 0 && (
                    <span className="git-sync-badge git-sync-badge--behind" title={`${status.behind} behind`}>
                      <ArrowDown size={10} />{status.behind}
                    </span>
                  )}
                </span>
              )}
            </>
          )}
        </div>
        <button
          className={`git-refresh-btn ${loading ? "spinning" : ""}`}
          onClick={refresh}
          title="Refresh"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="git-error" onClick={() => setError(null)} title="Click to dismiss">
          {error}
        </div>
      )}

      <div className="git-content">
        {/* Staged changes */}
        {status && (
          <FileSection
            label="Staged Changes"
            files={status.staged}
            open={stagedOpen}
            onToggle={() => setStagedOpen(!stagedOpen)}
            actionLabel="Unstage"
            actionIcon={<Minus size={12} />}
            onFileAction={(f) => handleUnstage([f.path])}
            onFileClick={(f) => handleFileClick(f, true)}
            onSectionAction={handleUnstageAll}
            sectionActionIcon={<Minus size={12} />}
            sectionActionTitle="Unstage All"
          />
        )}

        {/* Unstaged changes */}
        {status && (
          <FileSection
            label="Changes"
            files={status.unstaged}
            open={unstagedOpen}
            onToggle={() => setUnstagedOpen(!unstagedOpen)}
            actionLabel="Stage"
            actionIcon={<Plus size={12} />}
            onFileAction={(f) => handleStage([f.path])}
            onFileClick={(f) => handleFileClick(f, false)}
            onSectionAction={handleStageAll}
            sectionActionIcon={<Plus size={12} />}
            sectionActionTitle="Stage All"
            secondaryAction={(f) => handleDiscard([f.path])}
            secondaryIcon={<Undo2 size={12} />}
            secondaryTitle="Discard Changes"
          />
        )}

        {/* Untracked files */}
        {status && status.untracked.length > 0 && (
          <FileSection
            label="Untracked"
            files={status.untracked}
            open={untrackedOpen}
            onToggle={() => setUntrackedOpen(!untrackedOpen)}
            actionLabel="Stage"
            actionIcon={<Plus size={12} />}
            onFileAction={(f) => handleStage([f.path])}
            onSectionAction={() => handleStage(status.untracked.map(f => f.path))}
            sectionActionIcon={<Plus size={12} />}
            sectionActionTitle="Stage All Untracked"
          />
        )}

        {/* Empty state */}
        {status && status.staged.length === 0 && status.unstaged.length === 0 && status.untracked.length === 0 && (
          <div className="git-empty">No changes detected</div>
        )}

        {/* Commit section */}
        {status?.isRepo && (
          <div className="git-commit-section">
            <textarea
              className="git-commit-textarea"
              placeholder="Commit message..."
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && canCommit) {
                  e.preventDefault();
                  handleCommit();
                }
              }}
            />
            <div className="git-commit-actions">
              <button
                className="git-btn"
                disabled={!hasStagedChanges || generating}
                onClick={handleGenerateMsg}
                title="Generate commit message with AI"
              >
                {generating ? <Loader2 size={12} className="git-spinner" /> : <Sparkles size={12} />}
                {generating ? "Generating..." : "Generate"}
              </button>
              <button
                className="git-btn git-btn--primary"
                disabled={!canCommit}
                onClick={handleCommit}
                title="Commit staged changes (Ctrl+Enter)"
              >
                Commit
              </button>
            </div>
          </div>
        )}

        {/* Push / Pull / Branch / Remotes */}
        {status?.isRepo && (
          <div className="git-action-bar-wrapper">
            <div className="git-action-bar">
              <button className="git-btn" onClick={handlePush} title="Push to remote">
                <ArrowUp size={12} /> Push
              </button>
              <button className="git-btn" onClick={handlePull} title="Pull from remote">
                <ArrowDown size={12} /> Pull
              </button>
              <button
                className={`git-btn ${showBranchSelector ? "git-btn--active" : ""}`}
                onClick={handleOpenBranchSelector}
                title="Switch branch"
              >
                <GitBranch size={12} /> Branch
              </button>
              <button
                className={`git-btn ${showRemotes ? "git-btn--active" : ""}`}
                onClick={handleToggleRemotes}
                title="Manage remotes"
              >
                <Globe size={12} /> Remotes
              </button>
            </div>

            {/* Branch selector dropdown */}
            {showBranchSelector && (
              <div className="git-branch-dropdown" ref={branchSelectorRef}>
                <div className="git-branch-dropdown-header">Switch Branch</div>
                {branches ? (
                  <>
                    <div className="git-branch-list">
                      {branches.local.map((b) => (
                        <button
                          key={b.name}
                          className={`git-branch-item ${b.current ? "git-branch-item--current" : ""}`}
                          onClick={() => !b.current && handleCheckout(b.name)}
                          disabled={b.current}
                        >
                          <GitBranch size={12} />
                          <span className="git-branch-item-name">{b.name}</span>
                          {b.current && <span className="git-branch-item-badge">current</span>}
                        </button>
                      ))}
                      {branches.remote.length > 0 && (
                        <>
                          <div className="git-branch-dropdown-divider" />
                          <div className="git-branch-dropdown-subheader">Remote</div>
                          {branches.remote.map((name) => (
                            <button
                              key={name}
                              className="git-branch-item git-branch-item--remote"
                              onClick={() => handleCheckout(name)}
                            >
                              <Globe size={12} />
                              <span className="git-branch-item-name">{name}</span>
                            </button>
                          ))}
                        </>
                      )}
                    </div>
                    <div className="git-branch-dropdown-divider" />
                    <div className="git-branch-create">
                      <input
                        className="git-branch-create-input"
                        placeholder="New branch name..."
                        value={newBranchName}
                        onChange={(e) => setNewBranchName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleCreateBranch();
                          if (e.key === "Escape") setShowBranchSelector(false);
                        }}
                      />
                      <button
                        className="git-branch-create-btn"
                        onClick={handleCreateBranch}
                        disabled={!newBranchName.trim() || creatingBranch}
                        title="Create and switch to new branch"
                      >
                        {creatingBranch ? <Loader2 size={12} className="git-spinner" /> : <Check size={12} />}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="git-branch-loading">
                    <Loader2 size={14} className="git-spinner" /> Loading...
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Remote manager */}
        {showRemotes && status?.isRepo && (
          <div className="git-remotes-section">
            {remotes.length > 0 ? (
              <ul className="git-remote-list">
                {remotes.map((r) => (
                  <li key={r.name} className="git-remote-item">
                    <div className="git-remote-info">
                      <span className="git-remote-name">{r.name}</span>
                      <span className="git-remote-url" title={r.fetchUrl}>{r.fetchUrl}</span>
                    </div>
                    <button
                      className="git-file-action-btn"
                      onClick={() => handleRemoveRemote(r.name)}
                      title="Remove remote"
                    >
                      <Trash2 size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="git-empty">No remotes configured</div>
            )}
            <div className="git-remote-add">
              <input
                className="git-remote-add-input"
                placeholder="Name"
                value={addRemoteName}
                onChange={(e) => setAddRemoteName(e.target.value)}
              />
              <input
                className="git-remote-add-input git-remote-add-input--url"
                placeholder="URL"
                value={addRemoteUrl}
                onChange={(e) => setAddRemoteUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleAddRemote(); }}
              />
              <button
                className="git-remote-add-btn"
                onClick={handleAddRemote}
                disabled={!addRemoteName.trim() || !addRemoteUrl.trim() || addingRemote}
                title="Add remote"
              >
                {addingRemote ? <Loader2 size={12} className="git-spinner" /> : <Plus size={12} />}
              </button>
            </div>
          </div>
        )}

        {/* Commit history */}
        {log && log.entries.length > 0 && (
          <div className="git-history-section">
            <div className="git-history-header">Recent Commits</div>
            <ul className="git-commit-list">
              {log.entries.map((entry) => (
                <CommitEntry key={entry.hash} entry={entry} onClick={() => handleCommitClick(entry)} />
              ))}
            </ul>
            {log.entries.length >= log.pageSize && (
              <div className="git-load-more">
                <button className="git-load-more-btn" onClick={handleLoadMore}>Load more...</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Subcomponents ──────────────────────────────────────────────────────────

interface FileSectionProps {
  label: string;
  files: GitFileStatus[];
  open: boolean;
  onToggle: () => void;
  actionLabel: string;
  actionIcon: React.ReactNode;
  onFileAction: (file: GitFileStatus) => void;
  onFileClick?: (file: GitFileStatus) => void;
  onSectionAction: () => void;
  sectionActionIcon: React.ReactNode;
  sectionActionTitle: string;
  secondaryAction?: (file: GitFileStatus) => void;
  secondaryIcon?: React.ReactNode;
  secondaryTitle?: string;
}

function FileSection({
  label,
  files,
  open,
  onToggle,
  actionIcon,
  onFileAction,
  onFileClick,
  onSectionAction,
  sectionActionIcon,
  sectionActionTitle,
  secondaryAction,
  secondaryIcon,
  secondaryTitle,
}: FileSectionProps) {
  if (files.length === 0) return null;

  return (
    <div className="git-section">
      <div className="git-section-header" onClick={onToggle}>
        <span className="git-section-label">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {label}
          <span className="git-section-count">({files.length})</span>
        </span>
        <span className="git-section-actions" onClick={(e) => e.stopPropagation()}>
          <button className="git-section-btn" onClick={onSectionAction} title={sectionActionTitle}>
            {sectionActionIcon}
          </button>
        </span>
      </div>
      {open && (
        <ul className="git-file-list">
          {files.map((file) => (
            <li className="git-file-item" key={file.path} onClick={() => onFileClick?.(file)}>
              <span
                className={`git-file-status git-file-status--${file.status}`}
                title={STATUS_LABELS[file.status] ?? file.status}
              >
                {file.status}
              </span>
              <span className="git-file-path" title={file.path}>{file.path}</span>
              <span className="git-file-actions">
                {secondaryAction && (
                  <button
                    className="git-file-action-btn"
                    onClick={(e) => { e.stopPropagation(); secondaryAction(file); }}
                    title={secondaryTitle}
                  >
                    {secondaryIcon}
                  </button>
                )}
                <button
                  className="git-file-action-btn"
                  onClick={(e) => { e.stopPropagation(); onFileAction(file); }}
                  title={sectionActionTitle}
                >
                  {actionIcon}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface CommitEntryProps {
  entry: GitLogEntry;
  onClick?: () => void;
}

function CommitEntry({ entry, onClick }: CommitEntryProps) {
  const refs = entry.refs
    ? entry.refs.split(",").map((r) => r.trim()).filter(Boolean)
    : [];

  return (
    <li className="git-commit-entry" onClick={onClick}>
      <span className="git-commit-hash">{entry.hashShort}</span>
      <div className="git-commit-info">
        <div className="git-commit-message">
          {entry.message}
          {refs.length > 0 && (
            <span className="git-commit-refs">
              {refs.map((ref) => (
                <span key={ref} className="git-commit-ref">{ref}</span>
              ))}
            </span>
          )}
        </div>
        <div className="git-commit-meta">
          {entry.author} - {formatRelativeTime(entry.date)}
        </div>
      </div>
    </li>
  );
}
