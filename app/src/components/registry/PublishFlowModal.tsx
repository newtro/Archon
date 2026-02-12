import { useState, useEffect } from "react";
import { X, Check, ExternalLink, AlertCircle, Loader } from "lucide-react";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { getSetting } from "../../lib/store";
import {
  forkRepo,
  publishFlow,
  getGitHubUsername,
  toSlug,
  clearCatalogCache,
} from "../../lib/github-api";
import type { FlowDefinition } from "../../lib/flow-types";
import type { CommunityFlowMeta } from "../../lib/registry-types";
import "./PublishFlowModal.css";

interface PublishFlowModalProps {
  flow: FlowDefinition;
  onClose: () => void;
}

type Step = "metadata" | "publishing" | "success" | "error";

export function PublishFlowModal({ flow, onClose }: PublishFlowModalProps) {
  const [step, setStep] = useState<Step>("metadata");
  const [name, setName] = useState(flow.name);
  const [description, setDescription] = useState(flow.description);
  const [tagsInput, setTagsInput] = useState("");
  const [progressMessage, setProgressMessage] = useState("");
  const [prUrl, setPrUrl] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [githubToken, setGithubToken] = useState<string | null>(null);
  const [repoOwner, setRepoOwner] = useState("newtro");
  const [repoName, setRepoName] = useState("Archon-Community");

  useEffect(() => {
    async function loadSettings() {
      const token = await getSetting<string>("githubToken", "");
      const owner = await getSetting<string>("communityRepoOwner", "newtro");
      const repo = await getSetting<string>("communityRepoName", "Archon-Community");
      setGithubToken(token || null);
      setRepoOwner(owner);
      setRepoName(repo);
    }
    loadSettings();
  }, []);

  const handlePublish = async () => {
    if (!githubToken) return;

    setStep("publishing");
    setProgressMessage("Authenticating...");

    try {
      const username = await getGitHubUsername(githubToken);
      const slug = toSlug(name);
      const tags = tagsInput
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);

      const meta: CommunityFlowMeta = {
        id: slug,
        name,
        description,
        author: username,
        version: "1.0.0",
        stars: 0,
        downloads: 0,
        tags,
        nodeTypes: [...new Set(flow.nodes.map((n) => n.kind))],
        nodeCount: flow.nodes.length,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        flowPath: `flows/${slug}/flow.json`,
      };

      // Strip local metadata before publishing
      const publishableFlow: FlowDefinition = {
        ...flow,
        id: slug,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      setProgressMessage("Forking repository...");
      const fork = await forkRepo(githubToken, repoOwner, repoName);

      // Brief delay for GitHub to process the fork
      await new Promise((r) => setTimeout(r, 2000));

      const url = await publishFlow(
        githubToken,
        repoOwner,
        repoName,
        fork.owner,
        slug,
        JSON.stringify(publishableFlow, null, 2),
        meta,
        setProgressMessage
      );

      clearCatalogCache();
      setPrUrl(url);
      setStep("success");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setStep("error");
    }
  };

  const isValid = name.trim() && description.trim() && tagsInput.trim();

  return (
    <div className="publish-backdrop" onClick={onClose}>
      <div className="publish-modal" onClick={(e) => e.stopPropagation()}>
        <div className="publish-header">
          <h2 className="publish-title">Share to Community</h2>
          <button className="publish-close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {!githubToken ? (
          <div className="publish-body">
            <div className="publish-no-token">
              <AlertCircle size={24} />
              <p>GitHub token not configured.</p>
              <p className="publish-no-token-hint">
                Go to Settings and add a GitHub Personal Access Token
                with <code>public_repo</code> scope to publish flows.
              </p>
            </div>
          </div>
        ) : step === "metadata" ? (
          <div className="publish-body">
            <div className="publish-field">
              <label className="publish-label">Flow Name</label>
              <input
                className="publish-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Awesome Flow"
              />
            </div>
            <div className="publish-field">
              <label className="publish-label">Description</label>
              <textarea
                className="publish-textarea"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this flow do?"
                rows={3}
              />
            </div>
            <div className="publish-field">
              <label className="publish-label">Tags (comma-separated)</label>
              <input
                className="publish-input"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="testing, automation, quality"
              />
            </div>
            <div className="publish-summary">
              <span>{flow.nodes.length} nodes</span>
              <span>{flow.edges.length} connections</span>
              <span>Slug: {toSlug(name)}</span>
            </div>
            <p className="publish-note">
              This will create a pull request on{" "}
              <strong>{repoOwner}/{repoName}</strong>. The community can
              review your flow before it appears in the registry.
            </p>
          </div>
        ) : step === "publishing" ? (
          <div className="publish-body">
            <div className="publish-progress">
              <Loader size={20} className="publish-spinner" />
              <p className="publish-progress-text">{progressMessage}</p>
            </div>
          </div>
        ) : step === "success" ? (
          <div className="publish-body">
            <div className="publish-success">
              <Check size={24} />
              <p>Pull request created successfully!</p>
              <button
                className="publish-pr-link"
                onClick={() => shellOpen(prUrl)}
              >
                <ExternalLink size={14} />
                View Pull Request
              </button>
            </div>
          </div>
        ) : (
          <div className="publish-body">
            <div className="publish-error">
              <AlertCircle size={24} />
              <p>{errorMessage}</p>
              <button
                className="publish-retry-btn"
                onClick={() => setStep("metadata")}
              >
                Try Again
              </button>
            </div>
          </div>
        )}

        {step === "metadata" && githubToken && (
          <div className="publish-footer">
            <button className="publish-cancel-btn" onClick={onClose}>
              Cancel
            </button>
            <button
              className="publish-submit-btn"
              disabled={!isValid}
              onClick={handlePublish}
            >
              Publish Flow
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
