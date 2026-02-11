import { useState, useCallback, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readDir, readTextFile, type DirEntry } from "@tauri-apps/plugin-fs";
import { FolderOpen, ChevronRight } from "lucide-react";
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

function FileTreeNode({
  node,
  onToggle,
  onSelect,
}: {
  node: FileNode;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}) {
  const icon = getFileIcon(node.name, node.isDirectory);

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
      >
        {node.isDirectory && (
          <ChevronRight size={14} className={`file-tree-chevron ${node.isExpanded ? "expanded" : ""}`} />
        )}
        {!node.isDirectory && <span className="file-tree-spacer" />}
        <span className={`file-tree-icon file-icon-${icon}`}>{icon}</span>
        <span className="file-tree-name">{node.name}</span>
      </div>
      {node.isDirectory && node.isExpanded && node.children?.map((child) => (
        <FileTreeNode
          key={child.path}
          node={child}
          onToggle={onToggle}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

export function FileTreePanel({ onFileSelect, onProjectRootChange, initialRootPath }: FileTreePanelProps) {
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [nodes, setNodes] = useState<FileNode[]>([]);

  // Auto-load tree when initialRootPath is provided (e.g. restored from previous session)
  useEffect(() => {
    if (initialRootPath && initialRootPath !== rootPath) {
      setRootPath(initialRootPath);
      buildTree(initialRootPath, 0).then(setNodes);
    }
  }, [initialRootPath]); // eslint-disable-line react-hooks/exhaustive-deps

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
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
