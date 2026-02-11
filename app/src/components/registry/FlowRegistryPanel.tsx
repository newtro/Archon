import { useState, useEffect } from "react";
import { Globe, Download, Star, Search, ExternalLink } from "lucide-react";
import { saveFlow } from "../../lib/flow-storage";
import type { FlowDefinition } from "../../lib/flow-types";
import "./FlowRegistryPanel.css";

interface CommunityFlow {
  id: string;
  name: string;
  description: string;
  author: string;
  stars: number;
  tags: string[];
  downloadUrl: string;
}

// Placeholder community flows - used as fallback when GitHub API is unavailable
const COMMUNITY_FLOWS: CommunityFlow[] = [
  {
    id: "tdd-flow",
    name: "TDD Workflow",
    description: "Write tests first, then implement code. Red-green-refactor cycle with automated test runner.",
    author: "archon-community",
    stars: 42,
    tags: ["testing", "tdd", "quality"],
    downloadUrl: "",
  },
  {
    id: "code-review",
    name: "Code Review Agent",
    description: "Multi-pass code review: security audit, performance check, style compliance, then summary.",
    author: "archon-community",
    stars: 38,
    tags: ["review", "security", "quality"],
    downloadUrl: "",
  },
  {
    id: "refactor-safe",
    name: "Safe Refactor",
    description: "Refactor code with test coverage check before and after. Rolls back if tests fail.",
    author: "archon-community",
    stars: 31,
    tags: ["refactoring", "safety"],
    downloadUrl: "",
  },
  {
    id: "doc-generator",
    name: "Documentation Generator",
    description: "Analyze codebase structure and generate comprehensive documentation with examples.",
    author: "archon-community",
    stars: 27,
    tags: ["documentation", "automation"],
    downloadUrl: "",
  },
  {
    id: "bug-hunter",
    name: "Bug Hunter",
    description: "Intent-classified bug analysis: reproduce, identify root cause, generate fix, verify with tests.",
    author: "archon-community",
    stars: 55,
    tags: ["debugging", "testing"],
    downloadUrl: "",
  },
];

const GITHUB_INDEX_URL =
  "https://api.github.com/repos/archon-ide/community-flows/contents/flows/index.json";

export function FlowRegistryPanel() {
  const [searchQuery, setSearchQuery] = useState("");
  const [installing, setInstalling] = useState<string | null>(null);
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const [flows, setFlows] = useState<CommunityFlow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [registryOffline, setRegistryOffline] = useState(false);

  // Attempt to fetch community flows from GitHub API
  useEffect(() => {
    let cancelled = false;

    async function fetchFlows() {
      try {
        const res = await fetch(GITHUB_INDEX_URL, {
          headers: { Accept: "application/vnd.github.v3+json" },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        // GitHub API returns { content: base64, encoding: "base64" }
        if (data.content && data.encoding === "base64") {
          const decoded = atob(data.content.replace(/\n/g, ""));
          const parsed = JSON.parse(decoded) as CommunityFlow[];
          if (!cancelled && Array.isArray(parsed)) {
            setFlows(parsed);
            setIsLoading(false);
            return;
          }
        }
        throw new Error("Unexpected response format");
      } catch {
        // Fall back to placeholder data
        if (!cancelled) {
          setFlows(COMMUNITY_FLOWS);
          setRegistryOffline(true);
          setIsLoading(false);
        }
      }
    }

    fetchFlows();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = flows.filter((flow) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      flow.name.toLowerCase().includes(q) ||
      flow.description.toLowerCase().includes(q) ||
      flow.tags.some((t) => t.includes(q))
    );
  });

  const handleInstall = async (flow: CommunityFlow) => {
    setInstalling(flow.id);
    // In production, this would fetch the flow JSON from the download URL
    // For now, create a minimal flow with the metadata
    const newFlow: FlowDefinition = {
      id: crypto.randomUUID(),
      name: flow.name,
      description: flow.description,
      nodes: [
        { id: "start_1", kind: "start", label: "Start", x: 300, y: 50, config: { kind: "start", config: {} } },
        { id: "end_1", kind: "end", label: "End", x: 300, y: 400, config: { kind: "end", config: {} } },
      ],
      edges: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveFlow(newFlow);
    setInstalled((prev) => new Set([...prev, flow.id]));
    setInstalling(null);
  };

  return (
    <div className="registry-panel">
      <div className="registry-header">
        <div className="registry-title-group">
          <Globe size={18} />
          <h2 className="registry-title">Community Flows</h2>
        </div>
        <p className="registry-subtitle">
          Browse and install community-created agent flows
        </p>
      </div>

      <div className="registry-toolbar">
        <div className="registry-search">
          <Search size={14} />
          <input
            className="registry-search-input"
            placeholder="Search flows..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {registryOffline && (
        <div className="registry-offline-notice">
          Showing example flows (registry offline)
        </div>
      )}

      {isLoading ? (
        <div className="registry-loading">Loading...</div>
      ) : (
        <div className="registry-grid">
          {filtered.map((flow) => (
            <div key={flow.id} className="registry-card">
              <div className="registry-card-header">
                <span className="registry-card-name">{flow.name}</span>
                <span className="registry-card-stars">
                  <Star size={12} />
                  {flow.stars}
                </span>
              </div>
              <p className="registry-card-desc">{flow.description}</p>
              <div className="registry-card-tags">
                {flow.tags.map((tag) => (
                  <span key={tag} className="registry-tag">{tag}</span>
                ))}
              </div>
              <div className="registry-card-footer">
                <span className="registry-card-author">by {flow.author}</span>
                {installed.has(flow.id) ? (
                  <span className="registry-installed-badge">Installed</span>
                ) : (
                  <button
                    className="registry-install-btn"
                    onClick={() => handleInstall(flow)}
                    disabled={installing === flow.id}
                  >
                    <Download size={12} />
                    {installing === flow.id ? "Installing..." : "Install"}
                  </button>
                )}
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="registry-empty">
              No flows match your search
            </div>
          )}
        </div>
      )}

      <div className="registry-footer">
        <a className="registry-link" href="https://github.com/archon-ide/community-flows" target="_blank" rel="noopener noreferrer">
          <ExternalLink size={12} />
          View on GitHub
        </a>
      </div>
    </div>
  );
}
