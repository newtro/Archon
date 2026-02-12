import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readDir, readTextFile, type DirEntry } from "@tauri-apps/plugin-fs";
import { FolderOpen, ChevronRight } from "lucide-react";
import type { GitStatusData, GitFileStatus } from "../../lib/types";
import "./FileTreePanel.css";

interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
  isExpanded?: boolean;
  depth: number;
}

interface FileTreePanelProps {
  onFileSelect: (path: string, content: string) => void;
  onProjectRootChange?: (path: string) => void;
  initialRootPath?: string | null;
  gitStatus?: GitStatusData | null;
  onGitStage?: (files: string[]) => void;
  onGitUnstage?: (files: string[]) => void;
  onGitDiscard?: (files: string[]) => void;
  onGitViewDiff?: (path: string, staged: boolean) => void;
}

/** Git file state for context menu decisions */
interface GitFileState {
  status: string;
  section: "staged" | "unstaged" | "untracked";
}

// Files/dirs to skip in the tree
const IGNORED = new Set([
  "node_modules", ".git", "target", "dist", ".next",
  "__pycache__", ".venv", "venv", ".DS_Store", "Thumbs.db",
]);

function sortNodes(nodes: FileNode[]): FileNode[] {
  return nodes.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

async function buildTree(dirPath: string, depth: number): Promise<FileNode[]> {
  try {
    const entries: DirEntry[] = await readDir(dirPath);
    const nodes: FileNode[] = [];

    for (const entry of entries) {
      if (IGNORED.has(entry.name)) continue;
      if (entry.name.startsWith(".") && entry.name !== ".archon") continue;

      const fullPath = `${dirPath}/${entry.name}`;
      nodes.push({
        name: entry.name,
        path: fullPath,
        isDirectory: entry.isDirectory,
        depth,
      });
    }

    return sortNodes(nodes);
  } catch (err) {
    console.error("Failed to read directory:", dirPath, err);
    return [];
  }
}

function getFileIcon(name: string, isDirectory: boolean): string {
  if (isDirectory) return "dir";
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const icons: Record<string, string> = {
    ts: "ts", tsx: "tsx", js: "js", jsx: "jsx",
    json: "json", md: "md", css: "css", html: "html",
    rs: "rs", toml: "toml", py: "py", go: "go",
  };
  return icons[ext] ?? "file";
}

/** Context menu state */
interface ContextMenuState {
  x: number;
  y: number;
  node: FileNode;
  gitState: GitFileState | null;
}

function FileTreeNode({
  node,
  onToggle,
  onSelect,
  onContextMenu,
  gitStatusMap,
}: {
  node: FileNode;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void;
  gitStatusMap: Map<string, GitFileState>;
}) {
  const icon = getFileIcon(node.name, node.isDirectory);
  const gitState = !node.isDirectory ? gitStatusMap.get(node.path) : undefined;

  return (
    <>
      <div
        className={`file-tree-node ${node.isDirectory ? "directory" : "file"}`}
        style={{ paddingLeft: `${12 + node.depth * 16}px` }}
        onClick={() => {
          if (node.isDirectory) {
            onToggle(node.path);
          } else {
            onSelect(node.path);
          }
        }}
        onContextMenu={(e) => onContextMenu(e, node)}
      >
        {node.isDirectory && (
          <ChevronRight size={14} className={`file-tree-chevron ${node.isExpanded ? "expanded" : ""}`} />
        )}
        {!node.isDirectory && <span className="file-tree-spacer" />}
        <span className={`file-tree-icon file-icon-${icon}`}>{icon}</span>
        <span className="file-tree-name">{node.name}</span>
        {gitState && (
          <span className={`file-tree-git-badge file-tree-git-badge--${gitState.status}`} title={`${gitState.status} (${gitState.section})`}>
            {gitState.status}
          </span>
        )}
      </div>
      {node.isDirectory && node.isExpanded && node.children?.map((child) => (
        <FileTreeNode
          key={child.path}
          node={child}
          onToggle={onToggle}
          onSelect={onSelect}
          onContextMenu={onContextMenu}
          gitStatusMap={gitStatusMap}
        />
      ))}
    </>
  );
}

/** Build a map from absolute file paths to their git state */
function buildGitStatusMap(
  gitStatus: GitStatusData | null | undefined,
  rootPath: string | null,
): Map<string, GitFileState> {
  const map = new Map<string, GitFileState>();
  if (!gitStatus || !rootPath) return map;

  const normalizedRoot = rootPath.replace(/\\/g, "/").replace(/\/$/, "");

  const addFiles = (files: GitFileStatus[], section: GitFileState["section"]) => {
    for (const f of files) {
      // Git paths are relative — make absolute by joining with root
      const absPath = `${normalizedRoot}/${f.path.replace(/\\/g, "/")}`;
      map.set(absPath, { status: f.status, section });
    }
  };

  addFiles(gitStatus.staged, "staged");
  addFiles(gitStatus.unstaged, "unstaged");
  addFiles(gitStatus.untracked, "untracked");

  return map;
}

export function FileTreePanel({
  onFileSelect,
  onProjectRootChange,
  initialRootPath,
  gitStatus,
  onGitStage,
  onGitUnstage,
  onGitDiscard,
  onGitViewDiff,
}: FileTreePanelProps) {
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [nodes, setNodes] = useState<FileNode[]>([]);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Build git status lookup map (memoized)
  const gitStatusMap = useMemo(
    () => buildGitStatusMap(gitStatus, rootPath),
    [gitStatus, rootPath],
  );

  // Auto-load tree when initialRootPath is provided (e.g. restored from previous session)
  useEffect(() => {
    if (initialRootPath && initialRootPath !== rootPath) {
      setRootPath(initialRootPath);
      buildTree(initialRootPath, 0).then(setNodes);
    }
  }, [initialRootPath]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close context menu on outside click or scroll
  useEffect(() => {
    if (!contextMenu) return;
    const handleClose = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    const handleScroll = () => setContextMenu(null);
    document.addEventListener("mousedown", handleClose);
    document.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleClose);
      document.removeEventListener("scroll", handleScroll, true);
    };
  }, [contextMenu]);

  const handleOpenFolder = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false });
    if (selected) {
      const path = typeof selected === "string" ? selected : selected;
      setRootPath(path);
      const tree = await buildTree(path, 0);
      setNodes(tree);
      onProjectRootChange?.(path);
    }
  }, []);

  const handleToggle = useCallback(async (path: string) => {
    setNodes((prev) => {
      const updateNode = (nodeList: FileNode[]): FileNode[] =>
        nodeList.map((node) => {
          if (node.path === path) {
            return { ...node, isExpanded: !node.isExpanded };
          }
          if (node.children) {
            return { ...node, children: updateNode(node.children) };
          }
          return node;
        });
      return updateNode(prev);
    });

    // Load children if not yet loaded
    setNodes((prev) => {
      const findNode = (nodeList: FileNode[]): FileNode | null => {
        for (const n of nodeList) {
          if (n.path === path) return n;
          if (n.children) {
            const found = findNode(n.children);
            if (found) return found;
          }
        }
        return null;
      };
      const target = findNode(prev);
      if (target && target.isDirectory && !target.children) {
        // Load async, then update
        buildTree(path, target.depth + 1).then((children) => {
          setNodes((current) => {
            const injectChildren = (nodeList: FileNode[]): FileNode[] =>
              nodeList.map((node) => {
                if (node.path === path) {
                  return { ...node, children, isExpanded: true };
                }
                if (node.children) {
                  return { ...node, children: injectChildren(node.children) };
                }
                return node;
              });
            return injectChildren(current);
          });
        });
      }
      return prev;
    });
  }, []);

  const handleFileSelect = useCallback(
    async (path: string) => {
      try {
        const content = await readTextFile(path);
        onFileSelect(path, content);
      } catch (err) {
        console.error("Failed to read file:", path, err);
        onFileSelect(path, `[Error reading file: ${err}]`);
      }
    },
    [onFileSelect],
  );

  const handleContextMenu = useCallback((e: React.MouseEvent, node: FileNode) => {
    e.preventDefault();
    e.stopPropagation();
    const gitState = gitStatusMap.get(node.path) ?? null;
    // Only show context menu if there are git actions available
    const hasGitActions = gitState !== null || !node.isDirectory;
    if (!hasGitActions && node.isDirectory) return;
    setContextMenu({ x: e.clientX, y: e.clientY, node, gitState });
  }, [gitStatusMap]);

  /** Convert an absolute path back to a git-relative path */
  const toGitRelativePath = useCallback((absPath: string): string => {
    if (!rootPath) return absPath;
    const normalizedRoot = rootPath.replace(/\\/g, "/").replace(/\/$/, "");
    const normalizedAbs = absPath.replace(/\\/g, "/");
    if (normalizedAbs.startsWith(normalizedRoot + "/")) {
      return normalizedAbs.slice(normalizedRoot.length + 1);
    }
    return absPath;
  }, [rootPath]);

  const handleCtxStage = useCallback(() => {
    if (!contextMenu) return;
    onGitStage?.([toGitRelativePath(contextMenu.node.path)]);
    setContextMenu(null);
  }, [contextMenu, onGitStage, toGitRelativePath]);

  const handleCtxUnstage = useCallback(() => {
    if (!contextMenu) return;
    onGitUnstage?.([toGitRelativePath(contextMenu.node.path)]);
    setContextMenu(null);
  }, [contextMenu, onGitUnstage, toGitRelativePath]);

  const handleCtxDiscard = useCallback(() => {
    if (!contextMenu) return;
    onGitDiscard?.([toGitRelativePath(contextMenu.node.path)]);
    setContextMenu(null);
  }, [contextMenu, onGitDiscard, toGitRelativePath]);

  const handleCtxViewDiff = useCallback(() => {
    if (!contextMenu) return;
    const staged = contextMenu.gitState?.section === "staged";
    onGitViewDiff?.(toGitRelativePath(contextMenu.node.path), staged);
    setContextMenu(null);
  }, [contextMenu, onGitViewDiff, toGitRelativePath]);

  const rootName = rootPath?.split(/[/\\]/).pop() ?? "";

  return (
    <div className="file-tree-panel">
      <div className="file-tree-header">
        <h2 className="file-tree-title">Files</h2>
        <button className="file-tree-open-btn" onClick={handleOpenFolder} title="Open folder">
          <FolderOpen size={16} />
        </button>
      </div>

      <div className="file-tree-content">
        {!rootPath ? (
          <div className="file-tree-empty">
            <FolderOpen size={32} strokeWidth={1.5} style={{ opacity: 0.3 }} />
            <p>No folder open</p>
            <button className="file-tree-open-action" onClick={handleOpenFolder}>
              Open Folder
            </button>
          </div>
        ) : (
          <>
            <div className="file-tree-root">
              <span className="file-tree-root-name">{rootName}</span>
            </div>
            <div className="file-tree-list">
              {nodes.map((node) => (
                <FileTreeNode
                  key={node.path}
                  node={node}
                  onToggle={handleToggle}
                  onSelect={handleFileSelect}
                  onContextMenu={handleContextMenu}
                  gitStatusMap={gitStatusMap}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Git context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="file-tree-ctx-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          {contextMenu.gitState ? (
            <>
              {/* Staged files: Unstage, View Diff */}
              {contextMenu.gitState.section === "staged" && (
                <>
                  <button className="file-tree-ctx-item" onClick={handleCtxUnstage}>Unstage</button>
                  <button className="file-tree-ctx-item" onClick={handleCtxViewDiff}>View Diff</button>
                </>
              )}
              {/* Unstaged files: Stage, Discard, View Diff */}
              {contextMenu.gitState.section === "unstaged" && (
                <>
                  <button className="file-tree-ctx-item" onClick={handleCtxStage}>Stage</button>
                  <button className="file-tree-ctx-item" onClick={handleCtxDiscard}>Discard Changes</button>
                  <button className="file-tree-ctx-item" onClick={handleCtxViewDiff}>View Diff</button>
                </>
              )}
              {/* Untracked files: Stage */}
              {contextMenu.gitState.section === "untracked" && (
                <button className="file-tree-ctx-item" onClick={handleCtxStage}>Stage</button>
              )}
            </>
          ) : (
            <div className="file-tree-ctx-empty">No git actions</div>
          )}
        </div>
      )}
    </div>
  );
}
