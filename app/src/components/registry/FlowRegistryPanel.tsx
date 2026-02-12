import { useState, useEffect, useMemo, useCallback } from "react";
import { Globe, Download, Star, Search, ExternalLink, RefreshCw, ArrowDownToLine } from "lucide-react";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { getSetting } from "../../lib/store";
import { saveFlow } from "../../lib/flow-storage";
import { fetchCatalog, fetchFlowDefinition, clearCatalogCache } from "../../lib/github-api";
import { trackInstall, getInstalledFlows } from "../../lib/registry-storage";
import type { CommunityFlowMeta, InstalledCommunityFlow } from "../../lib/registry-types";
import { TagFilter } from "./TagFilter";
import { FlowDetailModal } from "./FlowDetailModal";
import "./FlowRegistryPanel.css";

// Fallback data shown when GitHub API is unreachable
const FALLBACK_FLOWS: CommunityFlowMeta[] = [
  {
    id: "tdd-workflow",
    name: "TDD Workflow",
    description: "Write tests first, then implement code. Red-green-refactor cycle with automated test runner.",
    author: "archon-ide",
    version: "1.0.0",
    stars: 42,
    downloads: 89,
    tags: ["testing", "tdd", "quality"],
    nodeTypes: ["start", "project-context", "llm", "tool", "evaluator", "end"],
    nodeCount: 8,
    createdAt: "2026-01-20T00:00:00Z",
    updatedAt: "2026-02-05T00:00:00Z",
    flowPath: "flows/tdd-workflow/flow.json",
  },
  {
    id: "code-reviewer",
    name: "Code Review Agent",
    description: "Multi-pass code review: security audit, performance check, style compliance, then summary.",
    author: "archon-ide",
    version: "1.0.0",
    stars: 38,
    downloads: 67,
    tags: ["review", "security", "quality"],
    nodeTypes: ["start", "project-context", "parallel", "llm", "join", "human-review", "end"],
    nodeCount: 10,
    createdAt: "2026-01-25T00:00:00Z",
    updatedAt: "2026-02-08T00:00:00Z",
    flowPath: "flows/code-reviewer/flow.json",
  },
];

export function FlowRegistryPanel() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [installing, setInstalling] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CommunityFlowMeta[]>([]);
  const [installedMap, setInstalledMap] = useState<Map<string, InstalledCommunityFlow>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [registryOffline, setRegistryOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailFlow, setDetailFlow] = useState<CommunityFlowMeta | null>(null);
  const [repoOwner, setRepoOwner] = useState("newtro");
  const [repoName, setRepoName] = useState("Archon-Community");
  const [githubToken, setGithubToken] = useState<string | undefined>(undefined);

  const loadData = useCallback(async (forceRefresh = false) => {
    setIsLoading(true);
    setError(null);
    setRegistryOffline(false);

    try {
      const token = await getSetting<string>("githubToken", "");
      const owner = await getSetting<string>("communityRepoOwner", "newtro");
      const repo = await getSetting<string>("communityRepoName", "Archon-Community");
      setGithubToken(token || undefined);
      setRepoOwner(owner);
      setRepoName(repo);

      if (forceRefresh) clearCatalogCache();

      const [flows, installed] = await Promise.all([
        fetchCatalog(owner, repo, token || undefined, forceRefresh),
        getInstalledFlows(),
      ]);

      setCatalog(flows);
      setInstalledMap(new Map(installed.map((i) => [i.communityId, i])));
    } catch (err) {
      // Fall back to placeholder data
      setCatalog(FALLBACK_FLOWS);
      setRegistryOffline(true);
      setError(err instanceof Error ? err.message : "Failed to load community flows");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Extract unique tags from catalog
  const allTags = useMemo(
    () => Array.from(new Set(catalog.flatMap((f) => f.tags))).sort(),
    [catalog]
  );

  // Filter flows by search and tags
  const filtered = useMemo(() => {
    return catalog.filter((flow) => {
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        !searchQuery ||
        flow.name.toLowerCase().includes(q) ||
        flow.description.toLowerCase().includes(q) ||
        flow.tags.some((t) => t.includes(q));
      const matchesTags =
        selectedTags.length === 0 || selectedTags.some((tag) => flow.tags.includes(tag));
      return matchesSearch && matchesTags;
    });
  }, [catalog, searchQuery, selectedTags]);

  const handleToggleTag = useCallback((tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }, []);

  const handleInstall = useCallback(
    async (flow: CommunityFlowMeta) => {
      setInstalling(flow.id);
      setError(null);
      try {
        const flowDef = await fetchFlowDefinition(repoOwner, repoName, flow.flowPath, githubToken);
        const localFlow = {
          ...flowDef,
          id: crypto.randomUUID(),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        await saveFlow(localFlow);
        await trackInstall(flow.id, localFlow.id, flow.version);
        setInstalledMap((prev) => {
          const next = new Map(prev);
          next.set(flow.id, {
            communityId: flow.id,
            localFlowId: localFlow.id,
            installedVersion: flow.version,
            installedAt: Date.now(),
          });
          return next;
        });
        // Close detail modal after install
        setDetailFlow(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to install flow");
      } finally {
        setInstalling(null);
      }
    },
    [repoOwner, repoName, githubToken]
  );

  const getInstallState = useCallback(
    (flow: CommunityFlowMeta) => {
      const installed = installedMap.get(flow.id);
      if (!installed) return { isInstalled: false, hasUpdate: false, version: null };
      const hasUpdate = installed.installedVersion !== flow.version;
      return { isInstalled: true, hasUpdate, version: installed.installedVersion };
    },
    [installedMap]
  );

  return (
    <div className="registry-panel">
      <div className="registry-header">
        <div className="registry-title-group">
          <Globe size={18} />
          <h2 className="registry-title">Community Flows</h2>
          <button
            className="registry-refresh-btn"
            onClick={() => loadData(true)}
            title="Refresh catalog"
          >
            <RefreshCw size={14} />
          </button>
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

      <TagFilter
        allTags={allTags}
        selectedTags={selectedTags}
        onToggleTag={handleToggleTag}
        onClearAll={() => setSelectedTags([])}
      />

      {registryOffline && (
        <div className="registry-offline-notice">
          {error || "Showing example flows (registry offline)"}
        </div>
      )}

      {error && !registryOffline && (
        <div className="registry-error-notice">{error}</div>
      )}

      {isLoading ? (
        <div className="registry-loading">Loading community flows...</div>
      ) : (
        <div className="registry-grid">
          {filtered.map((flow) => {
            const { isInstalled, hasUpdate } = getInstallState(flow);
            return (
              <div
                key={flow.id}
                className="registry-card"
                onClick={() => setDetailFlow(flow)}
              >
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
                    <span key={tag} className="registry-tag">
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="registry-card-footer">
                  <span className="registry-card-author">by {flow.author}</span>
                  <div className="registry-card-stats">
                    <span className="registry-card-downloads">
                      <ArrowDownToLine size={10} />
                      {flow.downloads}
                    </span>
                    {isInstalled && !hasUpdate ? (
                      <span className="registry-installed-badge">
                        Installed
                      </span>
                    ) : hasUpdate ? (
                      <span className="registry-update-badge">Update</span>
                    ) : (
                      <button
                        className="registry-install-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleInstall(flow);
                        }}
                        disabled={installing === flow.id}
                      >
                        <Download size={12} />
                        {installing === flow.id ? "..." : "Install"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="registry-empty">No flows match your search</div>
          )}
        </div>
      )}

      <div className="registry-footer">
        <button
          className="registry-link"
          onClick={() => shellOpen(`https://github.com/${repoOwner}/${repoName}`)}
        >
          <ExternalLink size={12} />
          View on GitHub
        </button>
      </div>

      {detailFlow && (
        <FlowDetailModal
          flow={detailFlow}
          isInstalled={getInstallState(detailFlow).isInstalled}
          installedVersion={getInstallState(detailFlow).version}
          onInstall={() => handleInstall(detailFlow)}
          onClose={() => setDetailFlow(null)}
          installing={installing === detailFlow.id}
        />
      )}
    </div>
  );
}
