/**
 * GitHub API client for the Community Flow Registry.
 * Handles fetching the catalog, downloading flows, and publishing via fork+PR.
 */

import type { CommunityFlowMeta } from "./registry-types";
import type { FlowDefinition } from "./flow-types";

// ── Cache ────────────────────────────────────────────────────────

interface CatalogCache {
  data: CommunityFlowMeta[];
  fetchedAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let catalogCache: CatalogCache | null = null;

// ── Helpers ──────────────────────────────────────────────────────

function authHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function handleRateLimit(res: Response): void {
  const remaining = res.headers.get("X-RateLimit-Remaining");
  if (remaining === "0") {
    const resetEpoch = Number(res.headers.get("X-RateLimit-Reset")) * 1000;
    const minutesUntilReset = Math.ceil((resetEpoch - Date.now()) / 60000);
    throw new Error(
      `GitHub API rate limit exceeded. Try again in ${minutesUntilReset} minute(s), or add a GitHub token in Settings.`
    );
  }
}

async function handleResponse(res: Response): Promise<unknown> {
  if (res.status === 401) {
    throw new Error("Authentication failed. Check your GitHub Personal Access Token in Settings.");
  }
  if (res.status === 403) {
    handleRateLimit(res);
    throw new Error("GitHub API access forbidden. Your token may lack the required scope.");
  }
  if (res.status === 404) {
    throw new Error("Repository not found. Check the community repo owner/name in Settings.");
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub API error (HTTP ${res.status}): ${body}`);
  }
  return res.json();
}

// ── Read Operations ──────────────────────────────────────────────

/**
 * Fetch the community flow catalog (index.json).
 * Uses raw.githubusercontent.com first (no rate limit), falls back to Contents API.
 */
export async function fetchCatalog(
  repoOwner: string,
  repoName: string,
  token?: string,
  forceRefresh = false
): Promise<CommunityFlowMeta[]> {
  // Return cached if fresh
  if (!forceRefresh && catalogCache && Date.now() - catalogCache.fetchedAt < CACHE_TTL_MS) {
    return catalogCache.data;
  }

  // Primary: Contents API (always up to date, not affected by CDN caching)
  try {
    const apiUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/flows/index.json?ref=main`;
    const res = await fetch(apiUrl, { headers: authHeaders(token) });
    if (res.ok) {
      const json = (await res.json()) as { content?: string; encoding?: string };
      if (json.content && json.encoding === "base64") {
        const decoded = atob(json.content.replace(/\n/g, ""));
        const data = JSON.parse(decoded) as CommunityFlowMeta[];
        if (Array.isArray(data)) {
          catalogCache = { data, fetchedAt: Date.now() };
          return data;
        }
      }
    }
  } catch {
    // Fall through to raw URL
  }

  // Fallback: raw.githubusercontent.com (no rate limit, but may have CDN cache delay)
  const rawUrl = `https://raw.githubusercontent.com/${repoOwner}/${repoName}/main/flows/index.json`;
  try {
    const res = await fetch(rawUrl, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: "no-store",
    });
    if (res.ok) {
      const data = (await res.json()) as CommunityFlowMeta[];
      if (Array.isArray(data)) {
        catalogCache = { data, fetchedAt: Date.now() };
        return data;
      }
    }
  } catch {
    // Both methods failed
  }

  throw new Error("Failed to load community flows catalog. Check your network connection and repo settings.");
}

/**
 * Download a specific flow definition JSON from the community repo.
 */
export async function fetchFlowDefinition(
  repoOwner: string,
  repoName: string,
  flowPath: string,
  token?: string
): Promise<FlowDefinition> {
  // Try raw URL first (fast, no rate limit)
  const rawUrl = `https://raw.githubusercontent.com/${repoOwner}/${repoName}/main/${flowPath}`;
  let lastError: Error | null = null;

  // Attempt 1: raw.githubusercontent.com (may have CDN cache delay for recently merged files)
  try {
    const res = await fetch(rawUrl, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: "no-store",
    });
    if (res.ok) {
      const flow = (await res.json()) as FlowDefinition;
      if (flow.nodes && Array.isArray(flow.nodes) && flow.edges && Array.isArray(flow.edges)) {
        return flow;
      }
      throw new Error("Invalid flow JSON: missing nodes or edges array");
    }
    lastError = new Error(`HTTP ${res.status}`);
  } catch (err) {
    lastError = err instanceof Error ? err : new Error(String(err));
  }

  // Attempt 2: Contents API (more reliable for recently merged content)
  try {
    const apiUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${flowPath}?ref=main`;
    const res = await fetch(apiUrl, { headers: authHeaders(token) });
    if (res.ok) {
      const json = (await res.json()) as { content?: string; encoding?: string };
      if (json.content && json.encoding === "base64") {
        const decoded = atob(json.content.replace(/\n/g, ""));
        const flow = JSON.parse(decoded) as FlowDefinition;
        if (flow.nodes && Array.isArray(flow.nodes) && flow.edges && Array.isArray(flow.edges)) {
          return flow;
        }
        throw new Error("Invalid flow JSON: missing nodes or edges array");
      }
    }
    throw new Error(`GitHub API returned HTTP ${res.status}`);
  } catch (err) {
    // If both methods failed, throw the most helpful error
    const apiErr = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to download flow "${flowPath}". ` +
      `Raw: ${lastError?.message || "unknown"}. API: ${apiErr}. ` +
      `The file may not have propagated yet — try again in a moment.`
    );
  }
}

/** Clear the catalog cache (e.g., after publishing) */
export function clearCatalogCache(): void {
  catalogCache = null;
}

// ── Write Operations (Publish) ───────────────────────────────────

/** Get the authenticated GitHub user's login */
export async function getGitHubUsername(token: string): Promise<string> {
  const res = await fetch("https://api.github.com/user", { headers: authHeaders(token) });
  const user = (await handleResponse(res)) as { login: string };
  return user.login;
}

/** Fork the community repo. Returns the fork owner/name. */
export async function forkRepo(
  token: string,
  repoOwner: string,
  repoName: string
): Promise<{ owner: string; name: string }> {
  const res = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/forks`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ default_branch_only: true }),
  });
  // 202 = fork created, 200 = already exists
  if (res.status !== 202 && res.status !== 200) {
    await handleResponse(res); // will throw
  }
  const fork = (await res.json()) as { owner: { login: string }; name: string };
  return { owner: fork.owner.login, name: fork.name };
}

/** Get the SHA of the main branch's latest commit */
async function getMainBranchSha(token: string, owner: string, repo: string): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/main`, {
    headers: authHeaders(token),
  });
  const ref = (await handleResponse(res)) as { object: { sha: string } };
  return ref.object.sha;
}

/** Create a branch on the fork */
async function createBranch(token: string, owner: string, repo: string, branchName: string, sha: string): Promise<void> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha }),
  });
  if (res.status === 422) {
    // Branch already exists — acceptable
    return;
  }
  if (!res.ok) {
    await handleResponse(res);
  }
}

/** Create or update a file on a branch via the Contents API */
async function commitFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  content: string,
  message: string,
  branch: string,
  existingSha?: string
): Promise<void> {
  const body: Record<string, unknown> = {
    message,
    content: btoa(unescape(encodeURIComponent(content))), // UTF-8 safe base64
    branch,
  };
  if (existingSha) {
    body.sha = existingSha;
  }
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    method: "PUT",
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    await handleResponse(res);
  }
}

/** Get the SHA of an existing file (needed for updates) */
async function getFileSha(token: string, owner: string, repo: string, path: string, branch: string): Promise<string | undefined> {
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`, {
      headers: authHeaders(token),
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { sha: string };
    return data.sha;
  } catch {
    return undefined;
  }
}

/**
 * Publish a flow: create branch, commit flow + updated index, open PR.
 * Returns the PR URL.
 */
export async function publishFlow(
  token: string,
  repoOwner: string,
  repoName: string,
  forkOwner: string,
  slug: string,
  flowJson: string,
  meta: CommunityFlowMeta,
  onProgress?: (step: string) => void
): Promise<string> {
  const forkName = repoName;
  const branchName = `add-flow-${slug}-${Date.now()}`;

  // 1. Sync fork and get latest SHA
  onProgress?.("Getting latest commit...");
  const mainSha = await getMainBranchSha(token, forkOwner, forkName);

  // 2. Create branch
  onProgress?.("Creating branch...");
  await createBranch(token, forkOwner, forkName, branchName, mainSha);

  // 3. Commit flow.json
  onProgress?.("Committing flow...");
  const flowPath = `flows/${slug}/flow.json`;
  await commitFile(token, forkOwner, forkName, flowPath, flowJson, `Add flow: ${meta.name}`, branchName);

  // 4. Fetch current index.json from UPSTREAM repo (not fork — CDN caching on fork branches is unreliable)
  onProgress?.("Updating catalog...");
  let existingIndex: CommunityFlowMeta[] = [];
  const indexSha = await getFileSha(token, forkOwner, forkName, "flows/index.json", branchName);
  try {
    // Use Contents API for upstream — more reliable than raw.githubusercontent.com
    const idxRes = await fetch(
      `https://api.github.com/repos/${repoOwner}/${repoName}/contents/flows/index.json?ref=main`,
      { headers: authHeaders(token) }
    );
    if (idxRes.ok) {
      const idxJson = (await idxRes.json()) as { content?: string; encoding?: string };
      if (idxJson.content && idxJson.encoding === "base64") {
        const decoded = atob(idxJson.content.replace(/\n/g, ""));
        const parsed = JSON.parse(decoded);
        if (Array.isArray(parsed)) {
          existingIndex = parsed as CommunityFlowMeta[];
        }
      }
    }
  } catch {
    // If upstream fetch fails, try raw URL as fallback
    try {
      const rawRes = await fetch(
        `https://raw.githubusercontent.com/${repoOwner}/${repoName}/main/flows/index.json`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      );
      if (rawRes.ok) {
        const parsed = await rawRes.json();
        if (Array.isArray(parsed)) {
          existingIndex = parsed as CommunityFlowMeta[];
        }
      }
    } catch {
      // Start fresh only if both methods fail
    }
  }

  // Remove existing entry with same slug if present (update scenario)
  existingIndex = existingIndex.filter((f) => f.id !== slug);
  existingIndex.push(meta);

  await commitFile(
    token,
    forkOwner,
    forkName,
    "flows/index.json",
    JSON.stringify(existingIndex, null, 2),
    `Update index: add ${meta.name}`,
    branchName,
    indexSha
  );

  // 5. Create PR
  onProgress?.("Opening pull request...");
  const prRes = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/pulls`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      title: `Add flow: ${meta.name}`,
      body: `## New Community Flow\n\n**Name:** ${meta.name}\n**Description:** ${meta.description}\n**Tags:** ${meta.tags.join(", ")}\n**Nodes:** ${meta.nodeCount} (${meta.nodeTypes.join(", ")})\n\nSubmitted from ArchonIDE.`,
      head: `${forkOwner}:${branchName}`,
      base: "main",
    }),
  });

  if (!prRes.ok) {
    const errBody = await prRes.text().catch(() => "");
    throw new Error(`Failed to create pull request: HTTP ${prRes.status} - ${errBody}`);
  }

  const pr = (await prRes.json()) as { html_url: string };
  return pr.html_url;
}

// ── Utility ──────────────────────────────────────────────────────

/** Generate a URL-safe slug from a flow name */
export function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
